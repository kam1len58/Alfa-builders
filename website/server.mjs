import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLlmClient, AiError } from './server/llm-client.mjs';
import { createInsightsService } from './server/insights.mjs';
const publicDirectory = resolve(fileURLToPath(new URL('./dist/', import.meta.url)));
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};
const port = Number(process.env.PORT || 4173);
const backendUrl = new URL(process.env.BACKEND_URL || 'http://127.0.0.1:5194');
const insights = createInsightsService({ llm: createLlmClient(), backendUrl });

function sendJson(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  if (!request.headers['content-type']?.startsWith('application/json'))
    throw new AiError('INVALID_CONTENT_TYPE', 'Ожидается JSON-запрос.', 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65536) throw new AiError('REQUEST_TOO_LARGE', 'Запрос слишком большой.', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AiError('INVALID_JSON', 'Не удалось прочитать запрос.', 400);
  }
}

async function handleAi(url, request, response) {
  try {
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!allowedHosts.includes(request.headers.host))
      throw new AiError('INVALID_HOST', 'Недопустимый адрес запроса.', 403);
    if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`)
      throw new AiError('INVALID_ORIGIN', 'Запрос разрешён только со страницы сайта.', 403);
    if (url.pathname === '/api/ai/status' && request.method === 'GET')
      return sendJson(response, 200, insights.status());
    if (!['/api/ai/analysis', '/api/ai/chat'].includes(url.pathname))
      return sendJson(response, 404, { message: 'Метод анализа не найден.' });
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return sendJson(response, 405, { message: 'Используйте POST.' });
    }
    const input = await readJson(request);
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new AiError('INVALID_INPUT', 'Некорректный запрос.', 400);
    const result =
      url.pathname === '/api/ai/analysis'
        ? await insights.analysisFor(input.companyId, input.newsId)
        : await insights.chat(input);
    if (!response.destroyed) sendJson(response, 200, result);
  } catch (error) {
    if (!response.destroyed)
      sendJson(response, error instanceof AiError ? error.status : 500, {
        code: error instanceof AiError ? error.code : 'AI_INTERNAL_ERROR',
        message:
          error instanceof AiError
            ? error.message
            : 'Не удалось подготовить ответ. Повторите запрос.',
      });
  }
}

async function forwardApiRequest(url, request, response) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }
  try {
    const upstream = await fetch(new URL(url.pathname + url.search, backendUrl), {
      method: request.method,
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
      headers: { Accept: 'application/json' },
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      throw new Error('Unexpected backend redirect');
    }
    const body = Buffer.from(await upstream.arrayBuffer());
    response.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(body);
  } catch {
    response.writeHead(503, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify({ message: 'Сервис данных временно недоступен.' }));
  }
}

http
  .createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname.startsWith('/api/ai/')) {
        await handleAi(url, request, response);
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        await forwardApiRequest(url, request, response);
        return;
      }
      const filePath = resolve(
        publicDirectory,
        '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
      );

      if (filePath !== publicDirectory && !filePath.startsWith(publicDirectory + sep)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }

      const file = await readFile(filePath);
      response.writeHead(200, {
        'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(file);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  })
  .listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}`));
