import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createAccess } from '../server/access.mjs';
test(
  'Public demo only exposes invented profiles and prepared examples; private configuration is ignored',
  { timeout: 30000 },
  async () => {
    const reservation = createServer();
    await new Promise((r) => reservation.listen(0, '127.0.0.1', r));
    const port = reservation.address().port;
    await new Promise((r) => reservation.close(r));
    const child = spawn(process.execPath, ['scripts/public-demo.mjs'], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: {
        ...process.env,
        PORT: String(port),
        LLM_API_KEY: 'synthetic-never-use',
        PROFILES_FILE: 'must-not-load',
        AUTH_USERS_FILE: 'must-not-load',
        APP_PUBLIC_ORIGIN: '',
      },
      stdio: 'pipe',
      windowsHide: true,
    });
    let logs = '';
    child.stdout.on('data', (b) => (logs += b));
    child.stderr.on('data', (b) => (logs += b));
    const base = 'http://127.0.0.1:' + port;
    try {
      let response;
      for (let i = 0; i < 100; i++) {
        try {
          response = await fetch(base + '/api/session');
          if (response.ok) break;
        } catch {}
        if (child.exitCode !== null) throw new Error(logs);
        await new Promise((r) => setTimeout(r, 100));
      }
      const session = await response.json(),
        cookie = response.headers.get('set-cookie').split(';')[0];
      assert.equal(session.mode, 'public-demo');
      assert.deepEqual(session.permissions, ['read', 'analyze']);
      const headers = {
        Cookie: cookie,
        'X-CSRF-Token': session.csrfToken,
        'Content-Type': 'application/json',
      };
      const call = async (path, body) => {
        const r = await fetch(base + path, {
          headers,
          method: body ? 'POST' : 'GET',
          body: body ? JSON.stringify(body) : undefined,
        });
        return { status: r.status, value: await r.json() };
      };
      const companies = (await call('/api/companies')).value;
      assert.equal(companies.length, 4);
      assert.ok(companies.every((p) => /^U_90000[1-4]$/.test(p.id)));
      assert.equal((await call('/api/company?id=U_9250')).status, 403);
      assert.equal((await call('/api/quality')).status, 403);
      assert.equal((await call('/api/sources/refresh', {})).status, 403);
      for (const company of companies) {
        const feed = (await call('/api/feed?company_id=' + company.id)).value;
        assert.ok(feed.length);
        assert.ok(feed.every((c) => c.analysis_payload.demo === true));
        assert.ok(!JSON.stringify(feed).includes('U_9250'));
      }
      const card = (await call('/api/feed?company_id=' + companies[0].id)).value[0];
      const reply = await call('/api/chat', {
        company_id: companies[0].id,
        news_id: card.news_id,
        question: 'Что проверить?',
      });
      assert.equal(reply.status, 200);
      assert.match(reply.value.answer, /без вызова нейросети/);
      assert.equal(
        (
          await call('/api/feedback', {
            companyId: companies[0].id,
            newsId: card.news_id,
            rating: 'useful',
          })
        ).status,
        403
      );
    } finally {
      child.kill();
    }
  }
);
test('Configured cloud origin keeps HTTPS cookies and rejects forged origins/hosts', async () => {
  const access = await createAccess({
    port: 10000,
    publicDemo: true,
    publicOrigin: 'https://alfahack.onrender.com',
  });
  const request = {
    headers: { host: 'alfahack.onrender.com', origin: 'https://alfahack.onrender.com' },
  };
  const values = {};
  const response = { setHeader: (k, v) => (values[k] = v) };
  access.session(request, response);
  assert.match(values['Set-Cookie'], /; Secure/);
  assert.throws(
    () => access.boundary({ headers: { host: 'unrelated.example' } }),
    (e) => e.status === 403
  );
  assert.throws(
    () =>
      access.boundary({
        headers: { host: 'alfahack.onrender.com', origin: 'https://unrelated.example' },
      }),
    (e) => e.status === 403
  );
});
