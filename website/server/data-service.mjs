import { readFileSync } from 'node:fs';
import { groupEvents } from './events.mjs';
const preparedSources = JSON.parse(
  readFileSync(new URL('../config/prepared-news.json', import.meta.url), 'utf8')
);
import { AiError } from './llm-client.mjs';
import { rankDocument, rankDocuments, relationshipHits, classify } from './ranking.mjs';
export function createDataService({
  backendUrl,
  collector,
  profiles = null,
  eventStore = null,
  fetcher = fetch,
}) {
  async function backend(path) {
    try {
      const response = await fetcher(new URL(path, backendUrl), {
        headers: { Accept: 'application/json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      });
      if (response.status === 404) throw new AiError('DATA_NOT_FOUND', 'Данные не найдены.', 404);
      if (!response.ok) throw new Error('Backend response');
      return await response.json();
    } catch (error) {
      if (error instanceof AiError) throw error;
      throw new AiError('DATA_UNAVAILABLE', 'Сервис данных компании временно недоступен.', 503);
    }
  }
  const companies = () => (profiles ? Promise.resolve(profiles.rows) : backend('/api/Companies'));
  const company = (id) =>
    profiles?.byId.has(id)
      ? Promise.resolve(profiles.byId.get(id))
      : backend('/api/Companies/' + encodeURIComponent(id));
  async function existingFeed(id, profile) {
    try {
      return await backend('/api/Companies/' + encodeURIComponent(id) + '/feed');
    } catch (error) {
      if (error.code !== 'DATA_NOT_FOUND' || !profiles?.byId.has(id)) throw error;
      const items = await backend('/api/News');
      return items
        .map((news) =>
          rankDocument(profile, {
            id: news.id,
            title: news.title,
            text: news.content,
            url: news.source,
            publisher: news.category,
            publishedAt: news.publishedAt,
          })
        )
        .filter((row) => row.tier !== 'Hidden');
    }
  }
  let newsCache,
    newsExpires = 0;
  async function originalNews() {
    if (newsCache && Date.now() < newsExpires) return newsCache;
    let value;
    try {
      value = await backend('/api/News');
    } catch (error) {
      if (error.code === 'DATA_NOT_FOUND') value = [];
      else throw error;
    }
    newsCache = Array.isArray(value) ? value : [];
    newsExpires = Date.now() + 30000;
    return newsCache;
  }
  function normalizeNews(news) {
    const checked = preparedSources[news.id];
    return checked
      ? {
          ...news,
          inputContent: news.content,
          title: checked.title || news.title,
          content: checked.content,
          source: checked.source,
          publishedAt: checked.publishedAt,
          contentScope: 'reviewed_summary',
          sourceStatus: 'reviewed_summary',
          sourceLinks: checked.sources,
          sourceWarnings: checked.warnings,
          originalExcerpt: checked.originalExcerpt,
          reviewedAt: checked.reviewedAt,
        }
      : news;
  }
  async function feed(id) {
    const profile = await company(id);
    const existing = await existingFeed(id, profile);
    const fresh = rankDocuments(profile, collector.news());
    const cautiousExplanations = {
      SUPPLIER_CONCENTRATION:
        'В профиле есть концентрация исходящих платежей. Назначение платежей и роль получателя неизвестны; зависимость поставок и связь с событием требуют проверки.',
      FUEL: 'Для отрасли могут быть значимы топливные расходы. Изменение экспорта или предложения само по себе не доказывает изменение закупочных цен; проверьте собственные затраты.',
      PMI_ORDERS:
        'Событие относится к активности в производстве и оптовой торговле. Проверьте направление изменения заказов и спроса в своём сегменте; рост индекса не всегда означает рост выпуска.',
    };
    const prepared = existing.map((row) => ({
      ...row,
      rankingOrigin: row.rankingOrigin || 'backend',
      hits: row.hits.map((hit) =>
        cautiousExplanations[hit.rule]
          ? {
              ...hit,
              explanation: cautiousExplanations[hit.rule],
              explanationOrigin: 'profile_safety_note',
            }
          : hit
      ),
    }));
    const known = new Set(prepared.map((row) => row.news.id));
    const missing = (await originalNews())
      .filter((news) => !known.has(news.id))
      .map((news) => ({ news, score: 0, tier: 'Hidden', hits: [] }));
    const candidates = [...prepared, ...missing, ...fresh].map((row) => {
      const news = normalizeNews(row.news);
      const extra = row.hits.some((h) => ['PARTNER_SECTOR', 'GROUP_SECTOR'].includes(h.rule))
        ? []
        : relationshipHits(
            profile,
            classify(news.title + ' ' + news.content),
            row.hits.map((h) => h.rule)
          );
      return {
        ...row,
        news,
        hits: [...row.hits, ...extra],
        score: Math.max(row.score, ...extra.map((h) => h.weight)),
        tier: row.score >= 0.6 ? 'Focus' : row.score >= 0.4 || extra.length ? 'All' : 'Hidden',
      };
    });
    const eventIndex = eventStore?.snapshot().eventIndex || {};
    const { events, assignments } = groupEvents(candidates, eventIndex);
    if (eventStore && Object.entries(assignments).some(([key, value]) => eventIndex[key] !== value))
      await eventStore.update((state) => {
        state.eventIndex = { ...state.eventIndex, ...assignments };
      });
    return events
      .filter((row) => row.score >= 0.4 && row.tier !== 'Hidden')
      .sort(
        (a, b) => b.score - a.score || String(b.news.publishedAt).localeCompare(a.news.publishedAt)
      );
  }
  async function news(id, companyId) {
    if (companyId) {
      const item = (await feed(companyId)).find(
        (row) => row.news.id === id || row.news.memberIds?.includes(id)
      );
      if (item) return item.news;
    }
    const collected = collector.news().find((row) => row.id === id);
    if (collected)
      return {
        id: collected.id,
        title: collected.title,
        content: collected.text,
        source: collected.url,
        publishedAt: collected.publishedAt,
        contentHash: collected.contentHash,
      };
    return backend('/api/News/' + encodeURIComponent(id));
  }
  async function context(companyId, newsId) {
    const [profile, rows] = await Promise.all([company(companyId), feed(companyId)]);
    const item = rows.find(
      (row) =>
        (row.news.id === newsId || row.news.memberIds?.includes(newsId)) && row.tier !== 'Hidden'
    );
    if (!item)
      throw new AiError('AI_EVENT_UNAVAILABLE', 'Событие недоступно для выбранной компании.', 404);
    return { company: profile, item };
  }
  return { companies, company, feed, news, context };
}
