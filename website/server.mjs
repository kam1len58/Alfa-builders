import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
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

http
  .createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
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
