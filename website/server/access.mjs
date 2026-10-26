import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { AiError } from './llm-client.mjs';
import { demoIds } from './public-demo.mjs';
const permissions = {
  owner: ['read', 'analyze', 'feedback', 'sources', 'quality', 'review'],
  editor: ['read', 'analyze', 'feedback', 'sources', 'quality'],
  analyst: ['read', 'analyze', 'feedback'],
  expert: ['read', 'analyze', 'feedback', 'quality', 'review'],
  viewer: ['read'],
  demo: ['read', 'analyze'],
};
export function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return 'scrypt$' + salt + '$' + scryptSync(password, salt, 64).toString('hex');
}
function equal(a, b) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export async function createAccess({
  port,
  usersFile = process.env.AUTH_USERS_FILE,
  now = Date.now,
  publicDemo = process.env.PUBLIC_DEMO === '1',
  publicOrigin = process.env.APP_PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL,
} = {}) {
  if (publicDemo) usersFile = null;
  let external;
  if (publicOrigin) {
    external = new URL(publicOrigin);
    if (
      external.protocol !== 'https:' ||
      external.username ||
      external.password ||
      external.pathname !== '/' ||
      external.search ||
      external.hash
    )
      throw new Error('APP_PUBLIC_ORIGIN must be an HTTPS origin');
  }
  const users = publicDemo
    ? [{ id: 'public-demo', name: 'Гость демоверсии', role: 'demo', companies: demoIds }]
    : usersFile
      ? JSON.parse(await readFile(usersFile, 'utf8')).users
      : [{ id: 'local-owner', name: 'Локальный пользователь', role: 'owner', companies: ['*'] }];
  if (
    !Array.isArray(users) ||
    !users.length ||
    users.some(
      (u) =>
        !u.id ||
        !permissions[u.role] ||
        !Array.isArray(u.companies) ||
        (usersFile && !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(u.passwordHash))
    )
  )
    throw new Error('Некорректный AUTH_USERS_FILE');
  const sessions = new Map(),
    attempts = new Map(),
    limits = new Map();
  function boundary(request) {
    const externalHost = external && request.headers.host === external.host;
    if (
      !['127.0.0.1:' + port, 'localhost:' + port, external?.host]
        .filter(Boolean)
        .includes(request.headers.host)
    )
      throw new AiError('ACCESS_HOST', 'Недопустимый адрес запроса.', 403);
    if (
      (request.headers.origin &&
        request.headers.origin !==
          (externalHost ? external.origin : 'http://' + request.headers.host)) ||
      request.headers['sec-fetch-site'] === 'cross-site'
    )
      throw new AiError('ACCESS_ORIGIN', 'Запрос с другого сайта отклонён.', 403);
  }
  function issue(user, response, request) {
    const token = randomBytes(32).toString('hex'),
      csrf = randomBytes(24).toString('hex');
    const session = { user, csrf, expires: now() + 8 * 3600000 };
    sessions.set(token, session);
    if (sessions.size > 1000) {
      for (const [id, s] of sessions) if (s.expires < now()) sessions.delete(id);
      if (sessions.size > 1000) sessions.delete(sessions.keys().next().value);
    }
    response.setHeader(
      'Set-Cookie',
      'alfa_session=' +
        token +
        '; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800' +
        (external && request.headers.host === external.host ? '; Secure' : '')
    );
    return session;
  }
  function session(request, response, { optional = false } = {}) {
    boundary(request);
    const token = /alfa_session=([a-f0-9]{64})/.exec(request.headers.cookie || '')?.[1];
    let found = token && sessions.get(token);
    if (found && found.expires < now()) {
      sessions.delete(token);
      found = null;
    }
    if (!found && !usersFile) found = issue(users[0], response, request);
    if (!found && !optional) throw new AiError('AUTH_REQUIRED', 'Войдите в сервис.', 401);
    return found;
  }
  function requirePermission(active, permission) {
    if (!active || !permissions[active.user.role].includes(permission))
      throw new AiError('ACCESS_DENIED', 'Недостаточно прав для действия.', 403);
  }
  function company(active, id) {
    if (!active.user.companies.includes('*') && !active.user.companies.includes(id))
      throw new AiError('COMPANY_DENIED', 'Компания недоступна этому пользователю.', 403);
  }
  function csrf(request, active) {
    if (!active || !equal(String(request.headers['x-csrf-token'] || ''), active.csrf))
      throw new AiError('CSRF_REJECTED', 'Обновите страницу перед повтором действия.', 403);
  }
  function limit(active, operation, max = 12, windowMs = 60000) {
    const key = active.user.id + ':' + operation;
    const recent = (limits.get(key) || []).filter((t) => now() - t < windowMs);
    if (recent.length >= max)
      throw new AiError('USER_RATE_LIMIT', 'Лимит запросов. Повторите позже.', 429);
    limits.set(key, [...recent, now()]);
    if (limits.size > 3000) limits.delete(limits.keys().next().value);
  }
  function login(request, response, input) {
    boundary(request);
    const key = request.socket.remoteAddress || 'local';
    const count = (attempts.get(key) || []).filter((t) => now() - t < 300000);
    if (count.length >= 8)
      throw new AiError(
        'LOGIN_RATE_LIMIT',
        'Слишком много попыток входа. Повторите через пять минут.',
        429
      );
    const user = users.find((u) => u.id === input.username);
    const hash = user?.passwordHash;
    const calculated = passwordHash(
      String(input.password || '').slice(0, 256),
      hash?.split('$')[1] || '00000000000000000000000000000000'
    );
    if (!usersFile || !hash || !equal(hash, calculated)) {
      attempts.set(key, [...count, now()]);
      throw new AiError('LOGIN_FAILED', 'Неверные данные для входа.', 401);
    }
    attempts.delete(key);
    return issue(user, response, request);
  }
  const publicSession = (active) =>
    active
      ? {
          authenticated: true,
          user: {
            id: active.user.id,
            name: active.user.name,
            role: active.user.role,
            companies: active.user.companies,
          },
          csrfToken: active.csrf,
          mode: publicDemo ? 'public-demo' : usersFile ? 'accounts' : 'local',
          permissions: permissions[active.user.role],
        }
      : { authenticated: false, mode: 'accounts' };
  return {
    boundary,
    session,
    requirePermission,
    company,
    csrf,
    limit,
    login,
    publicSession,
    logout(request, response) {
      const token = /alfa_session=([a-f0-9]{64})/.exec(request.headers.cookie || '')?.[1];
      sessions.delete(token);
      response.setHeader(
        'Set-Cookie',
        'alfa_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'
      );
    },
  };
}
