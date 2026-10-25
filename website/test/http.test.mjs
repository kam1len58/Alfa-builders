import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { passwordHash } from '../server/access.mjs';
const listen = (server) =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
test(
  'HTTP: вход, права компаний, CSRF/CSP, запрещённый прокси, отзывы и перезапуск',
  { timeout: 60000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'alfa-http-'));
    const profile = (id) => ({
      syntheticU: id,
      industry: 'Синтетическая компания',
      okvedCode: '46.3',
      bankProducts: {},
      ved: {},
      counterparties: {},
      affiliation: {},
      industryPosition: {},
    });
    const news = {
      id: 'N',
      title: 'Синтетическая инфляция',
      content: 'Инфляция изменилась',
      publishedAt: '2026-10-01',
      source: 'synthetic',
      tags: ['INFL_COSTS'],
    };
    const backend = http.createServer((request, response) => {
      let value;
      const path = new URL(request.url, 'http://localhost').pathname;
      if (path === '/api/Companies') value = [profile('C1'), profile('C2')];
      if (/^\/api\/Companies\/C[12]$/.test(path)) value = profile(path.split('/').at(-1));
      if (/^\/api\/Companies\/C[12]\/feed$/.test(path))
        value = [{ news, score: 0.5, tier: 'All', hits: [] }];
      response.writeHead(value ? 200 : 404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(value || {}));
    });
    let child;
    try {
      const backendPort = await listen(backend);
      const reservation = http.createServer();
      const port = await listen(reservation);
      await new Promise((r) => reservation.close(r));
      const users = join(root, 'access.json');
      await writeFile(
        users,
        JSON.stringify({
          users: [
            {
              id: 'owner',
              role: 'owner',
              name: 'Владелец теста',
              companies: ['*'],
              passwordHash: passwordHash('test-owner-password'),
            },
            {
              id: 'viewer',
              role: 'viewer',
              name: 'Читатель теста',
              companies: ['C1'],
              passwordHash: passwordHash('test-viewer-password'),
            },
          ],
        })
      );
      const base = 'http://127.0.0.1:' + port;
      async function start() {
        child = spawn(process.execPath, ['server.mjs'], {
          cwd: fileURLToPath(new URL('../', import.meta.url)),
          env: {
            ...process.env,
            PORT: String(port),
            BACKEND_URL: 'http://127.0.0.1:' + backendPort,
            APP_DATA_DIR: join(root, 'state'),
            AUTH_USERS_FILE: users,
            LLM_API_KEY: '',
            PROFILES_FILE: '',
            APP_BIND_ADDRESS: '127.0.0.1',
            SOURCE_REFRESH_MINUTES: '0',
          },
          stdio: 'pipe',
          windowsHide: true,
        });
        let output = '';
        child.stderr.on('data', (chunk) => {
          output += chunk;
        });
        child.stdout.on('data', (chunk) => {
          output += chunk;
        });
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
          try {
            if ((await fetch(base + '/api/session', { signal: AbortSignal.timeout(1000) })).ok)
              return;
          } catch {}
          if (child.exitCode !== null) throw new Error(output);
          await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error('Server did not start');
      }
      async function stop() {
        if (child && child.exitCode === null) {
          const exited = new Promise((r) => child.once('exit', r));
          child.kill();
          await exited;
        }
      }
      async function call(
        path,
        { session, body, headers = {}, method = body ? 'POST' : 'GET' } = {}
      ) {
        const response = await fetch(base + path, {
          method,
          headers: {
            ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}),
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...headers,
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        const text = await response.text();
        let value;
        try {
          value = JSON.parse(text);
        } catch {}
        return { response, status: response.status, value, text };
      }
      async function login(username, password) {
        const result = await call('/api/login', { body: { username, password } });
        assert.equal(result.status, 200);
        return {
          cookie: result.response.headers.get('set-cookie').split(';')[0],
          csrf: result.value.csrfToken,
        };
      }
      await start();
      assert.equal((await call('/api/Companies')).status, 401);
      assert.equal(
        (await call('/api/login', { body: { username: 'viewer', password: 'wrong' } })).status,
        401
      );
      const viewer = await login('viewer', 'test-viewer-password');
      assert.equal((await call('/api/Companies', { session: viewer })).value.length, 1);
      assert.equal((await call('/api/Companies/C1/feed', { session: viewer })).status, 200);
      assert.equal((await call('/api/Companies/C2/feed', { session: viewer })).status, 403);
      assert.equal(
        (
          await call('/api/ai/analysis', {
            session: viewer,
            body: { companyId: 'C1', newsId: 'N' },
          })
        ).status,
        403
      );
      assert.equal((await call('/api/sources/refresh', { session: viewer, body: {} })).status, 403);
      const owner = await login('owner', 'test-owner-password');
      const common = await call('/api/feed?company_id=C1', { session: viewer });
      assert.equal(common.status, 200);
      assert.equal(common.value[0].news_id, 'N');
      assert.equal(common.value[0].ai_conclusion, null);
      assert.equal(common.value[0].facts.text, null);
      assert.equal((await call('/api/companies', { session: viewer })).value[0].id, 'C1');
      assert.equal((await call('/api/company?id=C2', { session: viewer })).status, 403);
      assert.equal((await call('/api/feed?company_id=C2', { session: viewer })).status, 403);
      assert.equal(
        (
          await call('/api/trace?id=' + encodeURIComponent(common.value[0].trace_id), {
            session: viewer,
          })
        ).value.status,
        'ranking_only'
      );
      const other = await call('/api/feed?company_id=C2', { session: owner });
      assert.equal(
        (
          await call('/api/trace?id=' + encodeURIComponent(other.value[0].trace_id), {
            session: viewer,
          })
        ).status,
        403
      );
      assert.equal(
        (
          await call('/analyze', {
            session: viewer,
            body: { company: { id: 'C1' }, news: { id: 'N' } },
          })
        ).status,
        403
      );
      assert.equal(
        (
          await call('/api/chat', {
            session: owner,
            headers: { 'X-CSRF-Token': '' },
            body: { company_id: 'C1', news_id: 'N', question: 'Что произошло?' },
          })
        ).status,
        403
      );
      assert.equal(
        (
          await call('/api/feedback', {
            session: owner,
            headers: { 'X-CSRF-Token': '' },
            body: { companyId: 'C1', newsId: 'N', rating: 'useful' },
          })
        ).status,
        403
      );
      assert.equal(
        (
          await call('/api/Companies', {
            session: owner,
            headers: { Origin: 'https://unrelated.example' },
          })
        ).status,
        403
      );
      const badHost = await new Promise((resolve, reject) => {
        const request = http.get(
          base + '/api/Companies',
          { headers: { Host: 'unrelated.example', Cookie: owner.cookie } },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          }
        );
        request.on('error', reject);
      });
      assert.equal(badHost, 403);
      assert.equal(
        (await call('/api/NewsInterpretation/C1/news/N', { session: owner })).status,
        404
      );
      assert.equal((await call('/api/News', { session: owner, body: [] })).status, 404);
      assert.equal(
        (
          await call('/api/sources/import', {
            session: owner,
            body: { kind: 'news', url: 'https://127.0.0.1/private' },
          })
        ).status,
        400
      );
      const feedback = {
        companyId: 'C1',
        newsId: 'N',
        rating: 'useful',
        comment: 'Synthetic private feedback',
      };
      assert.equal((await call('/api/feedback', { session: owner, body: feedback })).status, 200);
      assert.equal((await call('/api/quality', { session: owner })).value.counts.feedback, 1);
      const audit = await call('/api/audit', { session: owner });
      assert.ok(!audit.text.includes(feedback.comment));
      assert.ok(!audit.text.includes('test-owner-password'));
      const page = await call('/');
      assert.ok(
        page.response.headers.get('content-security-policy').includes("frame-ancestors 'none'")
      );
      for (const path of ['/server/access.mjs', '/.env.local', '/data/demo_profiles.json'])
        assert.equal((await call(path)).status, 404);
      await stop();
      await start();
      assert.equal((await call('/api/Companies', { session: owner })).status, 401);
      const after = await login('owner', 'test-owner-password');
      assert.equal(
        (await call('/api/feedback?companyId=C1&newsId=N', { session: after })).value.feedback
          .comment,
        feedback.comment
      );
      await stop();
    } finally {
      if (child && child.exitCode === null) child.kill();
      await new Promise((r) => backend.close(r));
      await rm(root, { recursive: true, force: true });
    }
  }
);
