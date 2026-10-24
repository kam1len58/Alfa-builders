import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { safeFetch, assertSourceUrl } from './safe-fetch.mjs';
import { parseFeed, parseArticle, parsePdf } from './source-parser.mjs';
import { classify, searchDocuments } from './ranking.mjs';
const hash = (text) => createHash('sha256').update(text).digest('hex');

export async function createCollector({
  store,
  configPath = new URL('../config/sources.json', import.meta.url),
  excerptsPath = new URL('../config/bank-excerpts.json', import.meta.url),
  download = safeFetch,
}) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const excerpts = JSON.parse(await readFile(excerptsPath, 'utf8'));
  let current,
    lastStarted = 0;
  function document(item, source, extras = {}) {
    if (!item.title || !item.text || !item.publishedAt) return null;
    assertSourceUrl(item.url, config.allowedHosts);
    const text = item.text.trim().slice(0, 18000);
    const keyFacts = (text.match(/[^.!?]+[.!?](?:\s|$)/g) || [text])
      .map((s) => s.trim())
      .filter((s) => s.length > 30)
      .sort((a, b) => Number(/\d/.test(b)) - Number(/\d/.test(a)))
      .slice(0, 5)
      .map((s) => s.slice(0, 300));
    return {
      id: 'S_' + hash(item.url).slice(0, 20),
      pipelineVersion: 2,
      kind: source.kind,
      title: item.title.slice(0, 240),
      text,
      keyFacts,
      url: item.url,
      publishedAt: item.publishedAt,
      publisher: source.publisher,
      sourceId: source.id,
      collectedAt: new Date().toISOString(),
      contentHash: hash(text),
      status: 'ready',
      topics: classify(item.title + ' ' + text),
      ...extras,
    };
  }
  async function collect(source, previous) {
    const known = store.snapshot().documents.filter((d) => d.sourceId === source.id);
    const response = await download(source.url, {
      allowedHosts: config.allowedHosts,
      maxBytes: source.format === 'pdf' ? 12000000 : 2500000,
      timeoutMs: source.format === 'pdf' ? 45000 : 20000,
      headers: previous?.etag ? { 'If-None-Match': previous.etag } : {},
    });
    if (response.status === 304 && known.length)
      return { documents: known, etag: previous.etag, unchanged: true };
    const mime = String(response.headers['content-type'] || '').toLowerCase();
    let documents = [],
      pendingReview = false;
    if (source.format === 'rss') {
      const xml = new TextDecoder(/charset=([^;]+)/i.exec(mime)?.[1] || 'utf-8').decode(
        response.bytes
      );
      const items = parseFeed(xml, response.url);
      for (const item of items.slice(0, source.maxItems || 15)) {
        try {
          assertSourceUrl(item.url, config.allowedHosts);
          if (
            source.articlePaths &&
            !source.articlePaths.some((path) =>
              new URL(item.url).pathname.toLowerCase().startsWith(path)
            )
          )
            continue;
          if (item.text.length < 120) {
            const articleResponse = await download(item.url, { allowedHosts: config.allowedHosts });
            const article = parseArticle(
              new TextDecoder().decode(articleResponse.bytes),
              articleResponse.url
            );
            item.text = article.text || item.text;
            item.title = article.title || item.title;
          }
          const result = document(item, source);
          if (result && result.text.length >= 80) documents.push(result);
        } catch {
          /* Один непригодный материал не отменяет остальные записи RSS. */
        }
      }
    } else if (source.format === 'html') {
      if (!mime.includes('html')) throw new Error('SOURCE_TYPE');
      const item = parseArticle(new TextDecoder().decode(response.bytes), response.url);
      const result = document(item, source, {
        verification: 'official_publication',
        verified: source.kind === 'bank',
      });
      if (result) documents.push(result);
    } else if (source.format === 'pdf') {
      if (!response.bytes.subarray(0, 5).toString().startsWith('%PDF-'))
        throw new Error('SOURCE_TYPE');
      const documentHash = hash(response.bytes);
      const approved = excerpts.find(
        (item) => item.id === source.excerptId && item.sha256 === documentHash
      );
      // Хеш связывает вручную проверенные цитаты со скачанным сканом; другой файл не наследует доверие.
      if (approved) {
        const item = {
          title: approved.title,
          text: approved.excerpts
            .map((excerpt) => 'Страница ' + excerpt.page + ': ' + excerpt.text)
            .join('\n'),
          url: approved.documentUrl,
          publishedAt: approved.publishedAt,
        };
        documents.push(
          document(item, source, {
            verification: 'case_excerpt_hash_matched',
            verified: true,
            documentHash,
            excerpts: approved.excerpts,
            historical: true,
            caveat: approved.caveat,
            topics: [
              ...new Set([
                ...classify(item.title + ' ' + item.text),
                ...approved.topics.map((t) => (t === 'KEY_RATE' ? 'RATE' : t)),
              ]),
            ],
            reviewedAt: approved.reviewedAt,
          })
        );
      } else {
        const pdf = await parsePdf(response.bytes);
        pendingReview = true;
        // Автоматически извлечённый банковский текст требует проверки атрибуции и даты.
        documents.push({
          id: 'S_' + hash(source.url).slice(0, 20),
          kind: source.kind,
          title: source.title || source.id,
          url: source.url,
          publisher: source.publisher,
          sourceId: source.id,
          publishedAt: null,
          collectedAt: new Date().toISOString(),
          text: pdf.pages
            .map((p) => p.text)
            .join('\n')
            .slice(0, 18000),
          documentHash,
          status: 'review_required',
          scanned: pdf.scanned,
          topics: [],
          contentHash: documentHash,
        });
      }
    }
    if (!documents.length) throw new Error('SOURCE_EMPTY');
    return { documents: documents.filter(Boolean), etag: response.headers.etag, pendingReview };
  }
  async function refresh({ actor = 'scheduler', force = false } = {}) {
    if (current) return current;
    if (!force && Date.now() - lastStarted < 300000)
      return { status: 'throttled', sources: status() };
    lastStarted = Date.now();
    current = (async () => {
      for (const source of config.sources.filter((s) => s.enabled !== false)) {
        const started = Date.now();
        try {
          const result = await collect(source, store.snapshot().sources[source.id]);
          await store.update((state) => {
            state.documents = state.documents.filter(
              (d) =>
                d.sourceId !== source.id || (source.format !== 'pdf' && d.pipelineVersion === 2)
            );
            for (const item of result.documents) {
              const duplicate = state.documents.find(
                (d) =>
                  d.id !== item.id &&
                  d.kind === item.kind &&
                  d.contentHash === item.contentHash &&
                  d.status === 'ready'
              );
              if (duplicate) continue;
              const index = state.documents.findIndex((d) => d.id === item.id);
              if (index >= 0) state.documents[index] = item;
              else state.documents.push(item);
            }
            state.documents = state.documents
              .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))
              .slice(0, 1000);
            state.sources[source.id] = {
              lastAttempt: new Date().toISOString(),
              lastSuccess: new Date().toISOString(),
              status: result.pendingReview ? 'review_required' : 'ready',
              count: result.documents.length,
              etag: result.etag || null,
              durationMs: Date.now() - started,
            };
          });
          await store.audit({
            actor,
            operation: 'source_refresh',
            tool: source.id,
            status: result.pendingReview ? 'review_required' : 'completed',
            count: result.documents.length,
            durationMs: Date.now() - started,
          });
        } catch (error) {
          const code = /^(SOURCE_|PDF_|INVALID_XML)/.test(error.code || error.message)
            ? String(error.code || error.message).slice(0, 60)
            : 'SOURCE_UNAVAILABLE';
          await store.update((state) => {
            state.sources[source.id] = {
              ...state.sources[source.id],
              lastAttempt: new Date().toISOString(),
              status: 'error',
              code,
            };
          });
          await store.audit({
            actor,
            operation: 'source_refresh',
            tool: source.id,
            status: 'failed',
            code,
          });
        }
      }
      return { status: 'completed', sources: status() };
    })().finally(() => {
      current = null;
    });
    return current;
  }
  function status() {
    const state = store.snapshot();
    return config.sources.map((source) => ({
      id: source.id,
      name: source.title || source.publisher,
      kind: source.kind,
      url: source.documentUrl || source.url,
      format: source.format,
      ...(state.sources[source.id] || { status: 'not_collected', count: 0 }),
    }));
  }
  function documents() {
    return store
      .snapshot()
      .documents.filter(
        (d) =>
          d.sourceId.startsWith('manual-') ||
          config.sources.some((s) => s.id === d.sourceId && s.enabled !== false)
      );
  }
  function news() {
    return documents().filter((d) => d.kind === 'news' && d.status === 'ready');
  }
  function search(query, options = {}) {
    return searchDocuments(documents(), query, options);
  }
  function bankFor(item) {
    const matches = search(item.title + ' ' + item.content, { kind: 'bank', limit: 3 }).filter(
      (d) => d.verified === true
    );
    return {
      items: matches.map((d) => ({
        id: d.id,
        title: d.title,
        expertStance: d.text,
        sourceUrl: d.url,
        publishedAt: d.publishedAt,
        verified: true,
        documentHash: d.documentHash,
        excerpts: d.excerpts,
        historical: d.historical,
        caveat: d.caveat,
        contentHash: d.contentHash,
      })),
      note: matches.length
        ? 'Банковские материалы — исторический контекст на дату публикации, а не актуальная позиция по новой новости.'
        : 'Связанный подтверждённый материал банка не найден.',
    };
  }
  async function importUrl(value, { actor, kind = 'news' } = {}) {
    const url = assertSourceUrl(value, config.allowedHosts);
    if (kind === 'bank' && !['alfabank.ru', 'www.alfabank.ru'].includes(url.hostname))
      throw new Error('SOURCE_BANK_ORIGIN');
    const source = {
      id: 'manual-' + hash(url.href).slice(0, 12),
      url: url.href,
      kind,
      format: 'html',
      publisher: kind === 'bank' ? 'Альфа-Банк' : 'Официальная публикация',
    };
    const result = await collect(source);
    await store.update((state) => {
      for (const item of result.documents) {
        const index = state.documents.findIndex((d) => d.id === item.id);
        if (index >= 0) state.documents[index] = item;
        else state.documents.push(item);
      }
    });
    await store.audit({
      actor,
      operation: 'source_import',
      tool: source.id,
      status: 'completed',
      count: result.documents.length,
    });
    return result.documents.map(({ text, ...document }) => document);
  }
  const byId = (id) => documents().find((d) => d.id === id && d.status === 'ready');
  const fingerprint = () =>
    hash(
      JSON.stringify(
        documents()
          .map((d) => [d.id, d.contentHash, d.status, d.publishedAt])
          .sort((a, b) => a[0].localeCompare(b[0]))
      )
    );
  return {
    refresh,
    status,
    news,
    documents,
    search,
    bankFor,
    byId,
    fingerprint,
    importUrl,
    allowedHosts: config.allowedHosts,
  };
}
