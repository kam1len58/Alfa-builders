import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAccess, passwordHash } from '../server/access.mjs';
import { openState } from '../server/state.mjs';
const request = (headers = {}) => ({
  headers: { host: '127.0.0.1:4173', ...headers },
  socket: { remoteAddress: '127.0.0.1' },
});
const response = () => ({
  headers: {},
  setHeader(k, v) {
    this.headers[k] = v;
  },
});
test('Локальная сессия: HttpOnly cookie, CSRF, Origin, Host и лимиты', async () => {
  const access = await createAccess({ port: 4173 }),
    res = response(),
    active = access.session(request(), res);
  assert.match(res.headers['Set-Cookie'], /HttpOnly; SameSite=Strict/);
  assert.throws(
    () => access.csrf(request(), active),
    (e) => e.status === 403
  );
  access.csrf(request({ 'x-csrf-token': active.csrf }), active);
  for (const headers of [
    { host: 'evil.test' },
    { origin: 'https://evil.test' },
    { 'sec-fetch-site': 'cross-site' },
  ])
    assert.throws(
      () => access.boundary(request(headers)),
      (e) => e.status === 403
    );
  access.limit(active, 'test', 1);
  assert.throws(
    () => access.limit(active, 'test', 1),
    (e) => e.status === 429
  );
});
test('Учётные записи ограничивают компании и действия; пароль не раскрывается', async () => {
  const root = await mkdtemp(join(tmpdir(), 'alfa-auth-'));
  try {
    const path = join(root, 'users.json');
    await writeFile(
      path,
      JSON.stringify({
        users: [
          {
            id: 'viewer',
            name: 'Тест',
            role: 'viewer',
            companies: ['C1'],
            passwordHash: passwordHash('synthetic-test-password'),
          },
        ],
      })
    );
    const access = await createAccess({ port: 4173, usersFile: path }),
      res = response();
    assert.equal(
      access.publicSession(access.session(request(), res, { optional: true })).authenticated,
      false
    );
    assert.throws(
      () => access.login(request(), res, { username: 'viewer', password: 'wrong' }),
      (e) => e.status === 401
    );
    const active = access.login(request(), res, {
      username: 'viewer',
      password: 'synthetic-test-password',
    });
    access.company(active, 'C1');
    assert.throws(
      () => access.company(active, 'C2'),
      (e) => e.status === 403
    );
    assert.throws(
      () => access.requirePermission(active, 'analyze'),
      (e) => e.status === 403
    );
    assert.ok(!JSON.stringify(access.publicSession(active)).includes('password'));
    const cookie = res.headers['Set-Cookie'].split(';')[0];
    assert.equal(access.session(request({ cookie }), response()).user.id, 'viewer');
    access.logout(request({ cookie }), res);
    assert.throws(
      () => access.session(request({ cookie }), res),
      (e) => e.status === 401
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('Атомарное хранилище сохраняет параллельные изменения и переживает перезапуск', async () => {
  const root = await mkdtemp(join(tmpdir(), 'alfa-store-'));
  try {
    const store = await openState(root);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.audit({ operation: 'test', count: i, secret: 'must-not-be-saved' })
      )
    );
    const reopened = await openState(root);
    assert.equal(reopened.snapshot().audit.length, 20);
    assert.ok(!JSON.stringify(reopened.snapshot()).includes('must-not-be-saved'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
