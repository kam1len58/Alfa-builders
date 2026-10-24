import { AiError } from './llm-client.mjs';
import { rankDocuments } from './ranking.mjs';
export function createDataService({ backendUrl, collector, fetcher = fetch }) {
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
  const companies = () => backend('/api/Companies');
  const company = (id) => backend('/api/Companies/' + encodeURIComponent(id));
  async function feed(id) {
    const [profile, existing] = await Promise.all([
      company(id),
      backend('/api/Companies/' + encodeURIComponent(id) + '/feed'),
    ]);
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
      rankingOrigin: 'backend',
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
    return [...prepared, ...fresh].sort(
      (a, b) => b.score - a.score || String(b.news.publishedAt).localeCompare(a.news.publishedAt)
    );
  }
  async function news(id) {
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
    const item = rows.find((row) => row.news.id === newsId && row.tier !== 'Hidden');
    if (!item)
      throw new AiError('AI_EVENT_UNAVAILABLE', 'Событие недоступно для выбранной компании.', 404);
    return { company: profile, item };
  }
  return { companies, company, feed, news, context };
}
