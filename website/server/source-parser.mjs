import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { parseHTML } from 'linkedom';
import { Worker } from 'node:worker_threads';

export function cleanText(html) {
  const { document } = parseHTML(
    '<html><body>' + String(html).slice(0, 1000000) + '</body></html>'
  );
  document
    .querySelectorAll('script,style,iframe,form,nav,footer,header,noscript,svg')
    .forEach((node) => node.remove());
  document.querySelectorAll('p,li,h1,h2,h3,br').forEach((node) => {
    if (node.parentNode) node.before('\n');
  });
  return document.body.textContent
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .slice(0, 30000);
}
export function normalizeDate(value) {
  const russian = /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(
    String(value).trim()
  );
  const normalized = russian
    ? russian[3] +
      '-' +
      russian[2] +
      '-' +
      russian[1] +
      (russian[4]
        ? 'T' + russian[4] + ':' + russian[5] + ':' + (russian[6] || '00') + '+03:00'
        : 'T00:00:00Z')
    : value;
  const stamp = Date.parse(normalized);
  if (!Number.isFinite(stamp) || stamp > Date.now() + 86400000) return null;
  return new Date(stamp).toISOString();
}
export function canonicalUrl(value, base) {
  try {
    const url = new URL(value, base);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()])
      if (/^utm_|^(yclid|gclid|fbclid)$/i.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch {
    return null;
  }
}
const string = (value) =>
  typeof value === 'object' && value ? String(value['#text'] || '') : String(value || '');
const array = (value) => (value == null ? [] : Array.isArray(value) ? value : [value]);
export function parseFeed(xml, sourceUrl) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw new Error('INVALID_XML');
  const parsed = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    processEntities: true,
  }).parse(xml.replace(/^\uFEFF/, ''));
  const rss = parsed.rss?.channel?.item || parsed.RDF?.item;
  const atom = parsed.feed?.entry;
  return array(rss || atom)
    .slice(0, 100)
    .map((item) => {
      const link = array(item.link).find((l) => typeof l === 'string' || l['@_rel'] !== 'self');
      const url = canonicalUrl(typeof link === 'object' ? link['@_href'] : string(link), sourceUrl);
      const title = cleanText(string(item.title));
      const body = cleanText(
        string(item.encoded || item.content || item.description || item.summary)
      );
      const publishedAt = normalizeDate(
        string(item.pubDate || item.published || item.updated || item.date)
      );
      return { title, url, text: body, publishedAt };
    })
    .filter((item) => item.url && item.title && item.publishedAt);
}
export function parseArticle(html, sourceUrl) {
  const { document } = parseHTML(html);
  const meta = (name) =>
    document
      .querySelector('meta[property="' + name + '"],meta[name="' + name + '"]')
      ?.getAttribute('content');
  let schema = {};
  for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const value = JSON.parse(node.textContent);
      const entries = Array.isArray(value) ? value : value['@graph'] || [value];
      const article = entries.find((v) => /Article|NewsArticle|Report/.test(String(v['@type'])));
      if (article) schema = article;
    } catch {
      /* Некорректная разметка не заменяет содержание статьи. */
    }
  }
  const title = cleanText(
    schema.headline || meta('og:title') || document.querySelector('h1')?.textContent || ''
  );
  const root = document.querySelector(
    'article,[itemprop="articleBody"],.article__text,.landing-text,.article,.news-content,main'
  );
  const text = cleanText(schema.articleBody || root?.innerHTML || '');
  const cbrDate = new URL(sourceUrl).hostname.endsWith('cbr.ru')
    ? [...document.querySelectorAll('p.note')]
        .map((node) => node.textContent.trim())
        .find((value) => /^\d{2}\.\d{2}\.\d{4}(\s|$)/.test(value))
    : null;
  return {
    title,
    text,
    url: canonicalUrl(sourceUrl),
    publishedAt: normalizeDate(
      schema.datePublished ||
        meta('article:published_time') ||
        meta('date') ||
        document.querySelector('time')?.getAttribute('datetime') ||
        cbrDate
    ),
  };
}
export function parsePdf(bytes, options = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pdf-worker.mjs', import.meta.url), {
      workerData: { bytes: Uint8Array.from(bytes), options },
      resourceLimits: { maxOldGenerationSizeMb: 384 },
    });
    const timer = setTimeout(
      () => {
        worker.terminate();
        reject(new Error('PDF_TIMEOUT'));
      },
      Math.min(options.timeoutMs || 120000, 180000)
    );
    worker.once('message', (result) => {
      clearTimeout(timer);
      worker.terminate();
      result.error ? reject(new Error(result.error)) : resolve(result);
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error('PDF_WORKER_EXIT'));
    });
  });
}
