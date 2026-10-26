import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLlmClient, AiError } from './llm-client.mjs';
import { createInsightsService } from './insights.mjs';
import { openState } from './state.mjs';
import { createCollector } from './collector.mjs';
import { createAccess } from './access.mjs';
import { createDataService } from './data-service.mjs';
import { createQuality, evaluateBenchmark } from './quality.mjs';
import { loadProfiles } from './profiles.mjs';
import { createContractApi } from './contract-api.mjs';
import { createMeter } from './meter.mjs';
import { createDemoInsights, demoCatalogue } from './public-demo.mjs';
import { createMlBridge } from './ml-bridge.mjs';
const publicDemo = process.env.PUBLIC_DEMO === '1';

const publicDirectory = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
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
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Некорректный PORT');
const backendUrl = new URL(process.env.BACKEND_URL || 'http://127.0.0.1:5194');
if (
  !['127.0.0.1', 'localhost', 'backend'].includes(backendUrl.hostname) ||
  !['http:', 'https:'].includes(backendUrl.protocol) ||
  backendUrl.username ||
  backendUrl.password
)
  throw new Error('BACKEND_URL должен указывать на локальный API или сервис backend в compose.');
const store = await openState();
const collector = await createCollector({ store });
const access = await createAccess({ port });
const quality = createQuality({ store });
const profiles = publicDemo ? demoCatalogue() : await loadProfiles();
const data = createDataService({ backendUrl, collector, profiles, eventStore: store });
const meter = createMeter({
  store,
  prices: JSON.parse(process.env.LLM_PRICES_RUB_PER_MILLION || '{}'),
  budget: Number(process.env.LLM_DAILY_BUDGET_RUB || 500),
});
const ml =
  process.env.ML_ENABLED === '1' && !publicDemo
    ? await createMlBridge({ createClient: (model) => createLlmClient({ model, meter }) })
    : null;
const insights = publicDemo
  ? createDemoInsights({ data })
  : createInsightsService({
      llm: createLlmClient({ meter }),
      reviewer: createLlmClient({
        model: process.env.LLM_REVIEW_MODEL || 'qwen/qwen3.6-35b-a3b',
        meter,
      }),
      backendUrl,
      dataService: data,
      collector,
      ml,
      onAnalysis: quality.recordAnalysis,
      onAudit: store.audit,
    });
if (ml) process.on('exit', () => ml.close());
const benchmark = JSON.parse(
  await readFile(new URL('../data/quality-benchmark.json', import.meta.url), 'utf8')
);
await store.update((state) => {
  state.evaluation = evaluateBenchmark(benchmark, { usedForTuning: true });
});

function send(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}
async function readJson(request) {
  if (!String(request.headers['content-type']).toLowerCase().startsWith('application/json'))
    throw new AiError('INVALID_CONTENT_TYPE', 'Ожидается JSON-запрос.', 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65536) throw new AiError('REQUEST_TOO_LARGE', 'Запрос слишком большой.', 413);
    chunks.push(chunk);
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AiError('INVALID_JSON', 'Не удалось прочитать запрос.', 400);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AiError('INVALID_INPUT', 'Некорректный запрос.', 400);
  return value;
}
function method(request, expected) {
  if (request.method !== expected)
    throw new AiError('METHOD_NOT_ALLOWED', 'Метод не поддерживается.', 405);
}
function validatePair(input) {
  if (
    ![input.companyId, input.newsId].every(
      (value) =>
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= 100 &&
        !/[\u0000-\u001f]/.test(value)
    )
  )
    throw new AiError('INVALID_INPUT', 'Не указаны компания или событие.', 400);
}
const contractApi = createContractApi({
  data,
  insights,
  quality,
  access,
  send,
  readJson,
  validatePair,
});
async function api(url, request, response) {
  access.boundary(request);
  if (url.pathname === '/api/session') {
    method(request, 'GET');
    return send(
      response,
      200,
      access.publicSession(access.session(request, response, { optional: true }))
    );
  }
  if (url.pathname === '/api/login') {
    method(request, 'POST');
    const input = await readJson(request);
    return send(response, 200, access.publicSession(access.login(request, response, input)));
  }
  const session = access.session(request, response);
  access.requirePermission(session, 'read');
  if (!['GET', 'HEAD'].includes(request.method)) access.csrf(request, session);
  if (await contractApi(url, request, response, session)) return;
  if (url.pathname === '/api/logout') {
    method(request, 'POST');
    access.logout(request, response);
    return send(response, 200, { ok: true });
  }
  if (url.pathname === '/api/Companies') {
    method(request, 'GET');
    const rows = await data.companies();
    return send(
      response,
      200,
      rows.filter(
        (row) =>
          session.user.companies.includes('*') || session.user.companies.includes(row.syntheticU)
      )
    );
  }
  const companyRoute = /^\/api\/Companies\/([^/]+)(\/feed)?$/.exec(url.pathname);
  if (companyRoute) {
    method(request, 'GET');
    const id = decodeURIComponent(companyRoute[1]);
    access.company(session, id);
    return send(response, 200, companyRoute[2] ? await data.feed(id) : await data.company(id));
  }
  if (url.pathname === '/api/ai/status') {
    method(request, 'GET');
    return send(response, 200, insights.status());
  }
  if (['/api/ai/analysis', '/api/ai/chat'].includes(url.pathname)) {
    method(request, 'POST');
    access.requirePermission(session, 'analyze');
    access.limit(session, 'ai', 10);
    const input = await readJson(request);
    validatePair(input);
    access.company(session, input.companyId);
    await store.audit({
      actor: session.user.id,
      operation: url.pathname.endsWith('chat') ? 'chat_request' : 'analysis_request',
      companyId: input.companyId,
      newsId: input.newsId,
      status: 'started',
    });
    return send(
      response,
      200,
      url.pathname.endsWith('chat')
        ? await insights.chat(input)
        : await insights.analysisFor(input.companyId, input.newsId)
    );
  }
  if (url.pathname === '/api/sources') {
    method(request, 'GET');
    return send(response, 200, {
      sources: collector.status(),
      documents: collector.documents().map(({ text, ...document }) => document),
    });
  }
  if (url.pathname === '/api/sources/refresh') {
    method(request, 'POST');
    access.requirePermission(session, 'sources');
    access.limit(session, 'source_refresh', 1, 300000);
    collector.refresh({ actor: session.user.id }).catch(() => {});
    return send(response, 202, { message: 'Обновление источников начато.' });
  }
  if (url.pathname === '/api/sources/import') {
    method(request, 'POST');
    access.requirePermission(session, 'sources');
    access.limit(session, 'source_import', 5);
    const input = await readJson(request);
    if (
      typeof input.url !== 'string' ||
      input.url.length > 1500 ||
      !['news', 'bank'].includes(input.kind)
    )
      throw new AiError('SOURCE_INPUT', 'Укажите URL и тип материала.', 400);
    try {
      return send(response, 201, {
        documents: await collector.importUrl(input.url, {
          actor: session.user.id,
          kind: input.kind,
        }),
      });
    } catch (error) {
      if (error instanceof AiError) throw error;
      throw new AiError(
        'SOURCE_IMPORT_FAILED',
        'Материал не загружен: проверьте источник, дату публикации и формат.',
        422
      );
    }
  }
  if (url.pathname === '/api/feedback') {
    if (request.method === 'GET') {
      const companyId = url.searchParams.get('companyId'),
        newsId = url.searchParams.get('newsId');
      access.company(session, companyId);
      if (newsId === null)
        return send(response, 200, {
          feedback: store
            .snapshot()
            .feedback.filter(
              (row) => row.userId === session.user.id && row.companyId === companyId
            ),
        });
      return send(response, 200, {
        feedback:
          store
            .snapshot()
            .feedback.find(
              (row) =>
                row.userId === session.user.id &&
                row.companyId === companyId &&
                row.newsId === newsId
            ) || null,
      });
    }
    method(request, 'POST');
    access.requirePermission(session, 'feedback');
    access.limit(session, 'feedback', 30);
    const input = await readJson(request);
    validatePair(input);
    access.company(session, input.companyId);
    if (input.rating !== null) await data.context(input.companyId, input.newsId);
    await quality.feedback(session.user, input);
    await store.audit({
      actor: session.user.id,
      operation: 'feedback',
      companyId: input.companyId,
      newsId: input.newsId,
      status: 'saved',
    });
    return send(response, 200, { ok: true });
  }
  if (url.pathname === '/api/quality') {
    method(request, 'GET');
    access.requirePermission(session, 'quality');
    return send(response, 200, {
      ...quality.overview(session.user),
      usage: session.user.companies.includes('*') ? meter.overview() : null,
    });
  }
  if (url.pathname === '/api/quality/evaluate') {
    method(request, 'POST');
    access.requirePermission(session, 'quality');
    access.limit(session, 'evaluate', 2);
    const evaluation = evaluateBenchmark(benchmark, { usedForTuning: true });
    await store.update((state) => {
      state.evaluation = evaluation;
    });
    return send(response, 200, evaluation);
  }
  if (url.pathname === '/api/quality/review') {
    method(request, 'POST');
    access.requirePermission(session, 'review');
    await quality.review(session.user, await readJson(request));
    await store.audit({ actor: session.user.id, operation: 'expert_review', status: 'saved' });
    return send(response, 200, { ok: true });
  }
  if (url.pathname === '/api/audit') {
    method(request, 'GET');
    access.requirePermission(session, 'quality');
    return send(response, 200, {
      entries: store
        .snapshot()
        .audit.filter(
          (row) =>
            !row.companyId ||
            session.user.companies.includes('*') ||
            session.user.companies.includes(row.companyId)
        )
        .slice(-100)
        .reverse(),
    });
  }
  throw new AiError('NOT_FOUND', 'Метод не найден.', 404);
}
const server = http.createServer(async (request, response) => {
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  );
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname.startsWith('/api/') || ['/analyze', '/chat'].includes(url.pathname)) {
      await api(url, request, response);
      return;
    }
    access.boundary(request);
    if (!['GET', 'HEAD'].includes(request.method))
      throw new AiError('METHOD_NOT_ALLOWED', 'Метод не поддерживается.', 405);
    const path = resolve(
      publicDirectory,
      '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
    );
    if (!path.startsWith(publicDirectory + sep)) throw new AiError('NOT_FOUND', 'Не найдено.', 404);
    const file = await readFile(path);
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(path)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : file);
  } catch (error) {
    if (response.destroyed) return;
    if (error instanceof AiError)
      send(response, error.status, { code: error.code, message: error.message });
    else {
      console.error(
        JSON.stringify({
          operation: 'request_failure',
          name: error.name,
          frames: String(error.stack || '')
            .split('\n')
            .slice(1, 4),
        })
      );
      send(response, request.url.startsWith('/api/') ? 500 : 404, {
        code: request.url.startsWith('/api/') ? 'SERVICE_ERROR' : 'NOT_FOUND',
        message: request.url.startsWith('/api/')
          ? 'Не удалось выполнить запрос. Повторите позже.'
          : 'Не найдено.',
      });
    }
  }
});
server.requestTimeout = 300000;
server.headersTimeout = 15000;
const bindAddress = process.env.APP_BIND_ADDRESS || '127.0.0.1';
if (
  bindAddress !== '127.0.0.1' &&
  !(bindAddress === '0.0.0.0' && (process.env.AUTH_USERS_FILE || publicDemo))
)
  throw new Error(
    'Сетевой режим требует AUTH_USERS_FILE. Для локального запуска используйте 127.0.0.1.'
  );
server.listen(port, bindAddress, () => console.log('Local: http://127.0.0.1:' + port));
const refreshMinutes = Number(process.env.SOURCE_REFRESH_MINUTES ?? 60);
if (Number.isFinite(refreshMinutes) && refreshMinutes >= 5) {
  collector.refresh().catch(() => {});
  const timer = setInterval(
    () => collector.refresh().catch(() => {}),
    Math.min(refreshMinutes, 1440) * 60000
  );
  timer.unref();
}
const qualityTimer = setInterval(
  () =>
    store
      .update((state) => {
        state.evaluation = evaluateBenchmark(benchmark, { usedForTuning: true });
      })
      .catch(() => {}),
  24 * 3600000
);
qualityTimer.unref();
