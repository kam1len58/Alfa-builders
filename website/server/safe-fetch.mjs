import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AiError } from './llm-client.mjs';

export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 168].includes(b)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && [18, 19].includes(b))
    );
  }
  if (isIP(address) === 6) {
    const ip = address.toLowerCase();
    return !(/^(::|fc|fd|fe[89ab]|ff)/.test(ip) || ip.includes('ffff:'));
  }
  return false;
}
export function assertSourceUrl(value, allowedHosts) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AiError('SOURCE_URL', 'Некорректный адрес источника.', 400);
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !allowedHosts.includes(url.hostname.toLowerCase()) ||
    isIP(url.hostname)
  )
    throw new AiError('SOURCE_URL', 'Источник не входит в разрешённый список.', 400);
  url.hash = '';
  return url;
}
export async function safeFetch(
  value,
  {
    allowedHosts,
    maxBytes = 2500000,
    redirects = 3,
    headers = {},
    timeoutMs = 20000,
    resolver = lookup,
    requester = https.request,
  }
) {
  let url = assertSourceUrl(value, allowedHosts);
  for (let hop = 0; hop <= redirects; hop++) {
    const addresses = await resolver(url.hostname, { all: true });
    if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address)))
      throw new AiError('SOURCE_NETWORK', 'Адрес источника отклонён.', 502);
    const response = await new Promise((resolve, reject) => {
      let timer, stream;
      const fail = (error) => {
        clearTimeout(timer);
        reject(error);
      };
      const req = requester(
        url,
        {
          headers: {
            'User-Agent': 'AlfaBusinessResearch/1.0 (+local prototype)',
            Accept: 'application/rss+xml, application/atom+xml, application/pdf, text/html',
            'Accept-Encoding': 'identity',
            ...headers,
          },
          // IP закреплён после проверки DNS; TLS проверяет исходное имя хоста.
          lookup: (_host, options, callback) =>
            options.all
              ? callback(null, addresses)
              : callback(null, addresses[0].address, addresses[0].family),
        },
        (res) => {
          stream = res;
          const chunks = [];
          let length = 0;
          res.on('data', (chunk) => {
            length += chunk.length;
            if (length > maxBytes) {
              const error = new Error('SOURCE_TOO_LARGE');
              fail(error);
              res.destroy(error);
              req.destroy(error);
            } else chunks.push(chunk);
          });
          res.on('error', fail);
          res.on('aborted', () => fail(new Error('SOURCE_INCOMPLETE')));
          res.on('close', () => {
            if (!res.complete) fail(new Error('SOURCE_INCOMPLETE'));
          });
          res.on('end', () => {
            clearTimeout(timer);
            resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) });
          });
        }
      );
      timer = setTimeout(() => {
        const error = new Error('SOURCE_TIMEOUT');
        fail(error);
        stream?.destroy(error);
        req.destroy(error);
      }, timeoutMs);
      req.on('error', fail);
      req.end();
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      url = assertSourceUrl(new URL(response.headers.location, url).href, allowedHosts);
      continue;
    }
    if (![200, 304].includes(response.status))
      throw new AiError('SOURCE_HTTP', 'Источник временно недоступен.', 502);
    return { ...response, url: url.href };
  }
  throw new AiError('SOURCE_REDIRECT', 'Слишком много перенаправлений источника.', 502);
}
