import { createHash } from 'node:crypto';
const hash = (text) => createHash('sha256').update(text).digest('hex');
const stop = new Set([
  'россии',
  'россия',
  'новости',
  'сообщил',
  'сообщили',
  'заявил',
  'заявили',
  'года',
  'году',
  'этого',
  'после',
  'будет',
  'стали',
  'стало',
]);
function tokens(text) {
  return new Set(
    (
      String(text)
        .toLowerCase()
        .replace(/ё/g, 'е')
        .match(/[а-яa-z]{3,}/g) || []
    )
      .filter((t) => !stop.has(t))
      .map((t) =>
        t
          .replace(
            /(?:иями|ение|ения|ов|ами|ях|ах|ого|ому|ый|ий|ая|ые|ой|ом|ам|ям|ы|и|а|я|у|е)$/u,
            ''
          )
          .slice(0, 8)
      )
  );
}
const overlap = (a, b) => [...a].filter((t) => b.has(t)).length;
function urlKey(value) {
  try {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    for (const key of [...u.searchParams.keys()])
      if (/^utm_|^(?:ref|from|yclid)$/i.test(key)) u.searchParams.delete(key);
    u.hash = '';
    return u.href.replace(/\/$/, '');
  } catch {
    return null;
  }
}
function signature(news) {
  const text = (news.title + ' ' + news.content.slice(0, 250)).toLowerCase();
  const foreign = /турц|казахстан|еврозон|европейск.{0,12}банк|фрс|бразил|китай/u.test(text);
  const country = text.match(/турц|казахстан|еврозон|фрс|бразил|китай/u)?.[0] || 'RU';
  const policy = !foreign && /ключев.{0,12}ставк|ставк.{0,20}(?:цб|банка россии)/u.test(text);
  const forecast = /(?:прогноз|ожида|может|вероят|планиру)/u.test(news.title.toLowerCase());
  const action = /(?:сниз|снижен)/u.test(text)
    ? 'снижение'
    : /(?:повыс|повышен)/u.test(text)
      ? 'повышение'
      : /(?:сохран|остав|неизмен)/u.test(text)
        ? 'сохранение'
        : null;
  const numbers = [...news.title.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map((x) =>
    Number(x[1].replace(',', '.'))
  );
  if (policy && !numbers.length) {
    const first = /(\d+(?:[.,]\d+)?)\s*%/.exec(news.content.slice(0, 250));
    if (first) numbers.push(Number(first[1].replace(',', '.')));
  }
  return {
    topic: policy ? 'policy-rate' : null,
    foreign,
    country,
    forecast,
    action,
    numbers,
    tokens: tokens(news.title),
    time: Date.parse(news.publishedAt),
    url: urlKey(news.source),
  };
}
function related(a, b) {
  if (a.url && a.url === b.url) return true;
  if (
    !Number.isFinite(a.time) ||
    !Number.isFinite(b.time) ||
    Math.abs(a.time - b.time) > 48 * 3600000
  )
    return false;
  if (a.country !== b.country || a.forecast !== b.forecast) return false;
  if (a.topic && a.topic === b.topic && a.forecast === b.forecast) return true;
  const common = overlap(a.tokens, b.tokens),
    union = new Set([...a.tokens, ...b.tokens]).size;
  return common >= 4 && common / union >= 0.58;
}
function publication(news) {
  return {
    id: news.id,
    title: news.title,
    text: news.content,
    url: urlKey(news.source),
    date: news.publishedAt,
    publisher: news.category || 'Публикация',
    contentHash: news.contentHash || hash(news.content),
    scope: news.contentScope || 'source_text',
    sourceStatus: news.sourceStatus || 'source_available',
    links: news.sourceLinks || [],
    originalExcerpt: news.originalExcerpt || null,
    warnings: news.sourceWarnings || [],
  };
}
export function groupEvents(rows, index = {}) {
  const unique = [...new Map(rows.map((row) => [row.news.id, row])).values()];
  const groups = [];
  for (const row of unique.sort(
    (a, b) =>
      String(a.news.publishedAt).localeCompare(b.news.publishedAt) ||
      a.news.id.localeCompare(b.news.id)
  )) {
    const sig = signature(row.news);
    const group = groups.find((g) => related(g.signature, sig));
    if (group) group.members.push({ row, sig });
    else groups.push({ signature: sig, members: [{ row, sig }] });
  }
  const assignments = {},
    events = groups.map((group) => {
      const members = group.members,
        ids = members.map((m) => m.row.news.id);
      const persisted = [...new Set(ids.map((id) => index[id]).filter(Boolean))].sort();
      const id =
        persisted[0] ||
        [...ids].sort(
          (a, b) => Number(!/^N\d+$/.test(a)) - Number(!/^N\d+$/.test(b)) || a.localeCompare(b)
        )[0];
      const aliases = Object.entries(index)
        .filter(([, canonical]) => canonical === id || persisted.includes(canonical))
        .map(([alias]) => alias);
      for (const memberId of [...ids, ...persisted, ...aliases]) assignments[memberId] = id;
      const weight = (n) =>
        n.sourceStatus === 'reviewed_summary' ? 3 : n.contentScope === 'rss_excerpt' ? 1 : 2;
      const representative = [...members].sort(
        (a, b) =>
          weight(b.row.news) - weight(a.row.news) ||
          b.row.news.content.length - a.row.news.content.length ||
          a.row.news.id.localeCompare(b.row.news.id)
      )[0].row;
      const scored = [...members].sort((a, b) => b.row.score - a.row.score)[0].row;
      const sources = members.map((m) => publication(m.row.news));
      const discrepancies = [];
      if (members.length > 1) {
        const metrics = [...new Set(members.flatMap((m) => m.sig.numbers))];
        const actions = [...new Set(members.map((m) => m.sig.action).filter(Boolean))];
        if (metrics.length > 1 || actions.length > 1)
          discrepancies.push({
            type: 'check_figures',
            text: 'В публикациях различаются числовые значения или направление изменения. Они могут относиться к разным показателям; сверяйте даты и формулировки по источникам.',
            values: metrics,
            actions,
            sourceIds: sources.map((s) => s.id),
          });
      }
      return {
        ...scored,
        news: {
          ...representative.news,
          id,
          // Keep publisher texts separate: a quote must point to the publication it actually came from.
          content: representative.news.content.slice(0, 12000),
          contentHash: hash(
            sources
              .map((s) => s.contentHash)
              .sort()
              .join(':')
          ),
          memberIds: [...new Set([...ids, ...persisted, ...aliases])],
          sourceRecords: sources,
          discrepancies,
          sourceWarnings: [...new Set(sources.flatMap((s) => s.warnings))],
          sourceCount: new Set(sources.map((s) => s.url || s.id)).size,
          eventSummary: {
            text: representative.news.content.slice(0, 600),
            method: 'extractive_primary_publication',
            sourceId: representative.news.id,
          },
        },
        score: scored.score,
        tier: scored.score >= 0.6 ? 'Focus' : scored.score >= 0.4 ? 'All' : 'Hidden',
        hits: [
          ...new Map(
            members
              .flatMap((m) => m.row.hits)
              .map((hit) => [hit.rule + ':' + (hit.relation || ''), hit])
          ).values(),
        ],
      };
    });
  return { events, assignments };
}
