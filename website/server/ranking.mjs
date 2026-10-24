// Ранжирование новых материалов. Баллы демо-бэкенда сохраняются отдельно.
const catalog = [
  [
    'RATE',
    0.8,
    /(?<![а-яё])ставк[а-яё]*|денежно.кредит|кредитован/u,
    (p) => p.bankProducts?.hasLoans === 1 || p.bankProducts?.hasDeposit === 1,
    'У компании есть кредитные или депозитные продукты; условия и сроки требуют проверки.',
    ['Кредит', 'Депозит'],
  ],
  [
    'INFL_COSTS',
    0.5,
    /инфляц|потребительск.{0,25}цен|индекс.{0,15}цен|себестоим|фот|зарплат/u,
    () => true,
    'Изменение цен может влиять на расходы; состав затрат компании неизвестен.',
    ['Оборотный кредит'],
  ],
  [
    'PMI_ORDERS',
    0.75,
    /pmi|промышлен|производств|делов.{0,12}актив|спрос|заказ/u,
    (p) => division(p) === 46 || between(division(p), 10, 33),
    'Производство или оптовая торговля: оцените связь события с заказами и оборачиваемостью.',
    ['Факторинг'],
  ],
  [
    'SANCTIONS',
    0.9,
    /санкц|эмбарго|ограничен.{0,30}(экспорт|импорт)|запрет.{0,25}(экспорт|импорт)/u,
    (p) => p.ved?.hasVed === 1,
    'Есть признаки ВЭД; применимость ограничений к конкретным сделкам не установлена.',
    ['Сопровождение ВЭД'],
  ],
  [
    'CUSTOMS',
    0.85,
    /пошлин|тамож|импорт|экспорт|внешн.{0,10}торгов/u,
    (p) => p.ved?.hasVed === 1,
    'Есть признаки ВЭД; проверьте товары, направления и условия контрактов.',
    ['Таможенная гарантия'],
  ],
  [
    'FUEL',
    0.85,
    /топлив|дизел|бензин|гсм|нефтепродукт/u,
    (p) =>
      between(division(p), 1, 3) || between(division(p), 41, 43) || between(division(p), 49, 53),
    'Для отрасли может быть значима стоимость топлива; изменение экспорта не означает изменение цен.',
    ['Лизинг'],
  ],
  [
    'GOV_PROCUREMENT',
    0.6,
    /госзакуп|44.фз|223.фз|госконтракт|тендер/u,
    (p) => p.bankProducts?.hasGuarantees === 1,
    'Есть банковские гарантии; участие в госзаказе остаётся гипотезой.',
    ['Гарантия'],
  ],
  [
    'OIL',
    0.8,
    /нефт|газ|brent|urals|добыч/u,
    (p) => [6, 9, 19].includes(division(p)),
    'Нефтегазовая отрасль: проверьте применимость изменения к продукции и рынкам компании.',
    ['Оборотный кредит'],
  ],
  [
    'TECH_SECURITY',
    0.7,
    /кибер|цифров.{0,20}безопасн|уязвим|утечк.{0,20}данн|программ.{0,20}обеспеч/u,
    (p) => [62, 63].includes(division(p)),
    'ИТ-профиль: проверьте затронутые продукты, версии и обязательства перед заказчиками.',
    [],
  ],
];
const division = (p) => Number.parseInt(p.okvedCode, 10);
const between = (n, a, b) => n >= a && n <= b;
export function classify(text) {
  const normalized = String(text).toLowerCase();
  return catalog.filter(([, , pattern]) => pattern.test(normalized)).map(([code]) => code);
}
export function rankDocument(profile, document) {
  const tags = classify(document.title + ' ' + document.text);
  const hits = catalog
    .filter(([code, , , applies]) => tags.includes(code) && applies(profile))
    .map(([rule, weight, , , explanation, bankProducts]) => ({
      rule,
      weight,
      explanation,
      bankProducts,
    }));
  const score = hits.length
    ? Math.min(0.99, 1 - hits.reduce((rest, hit) => rest * (1 - hit.weight), 1))
    : 0;
  return {
    news: {
      id: document.id,
      title: document.title,
      content: document.text.slice(0, 12000),
      source: document.url,
      publishedAt: document.publishedAt,
      category: document.publisher,
      tags,
      origin: 'collected',
      contentHash: document.contentHash,
      collectedAt: document.collectedAt,
      sourceId: document.sourceId,
    },
    score: Number(score.toFixed(6)),
    tier: score === 0 ? 'Hidden' : score >= 0.6 ? 'Focus' : 'All',
    hits,
    rankingOrigin: 'source-rules-v1',
  };
}
export function rankDocuments(profile, documents) {
  return documents
    .filter((d) => d.kind === 'news' && d.status === 'ready')
    .map((d) => rankDocument(profile, d))
    .filter((row) => row.tier !== 'Hidden')
    .sort((a, b) => b.score - a.score || b.news.publishedAt.localeCompare(a.news.publishedAt));
}
const stop = new Set([
  'что',
  'как',
  'для',
  'это',
  'при',
  'или',
  'его',
  'она',
  'они',
  'банк',
  'банка',
  'альфа',
  'новость',
  'компания',
  'компании',
  'россии',
  'года',
  'будет',
  'которые',
  'может',
]);
export function terms(text) {
  return [
    ...new Set(
      (
        String(text)
          .toLowerCase()
          .match(/[а-яёa-z]{4,}/gu) || []
      )
        .map((s) => s.slice(0, 7))
        .filter((s) => !stop.has(s))
    ),
  ].slice(0, 80);
}
export function searchDocuments(documents, query, { kind, limit = 4 } = {}) {
  const tokens = terms(query);
  const requestedTopics = classify(query);
  return documents
    .filter((d) => d.status === 'ready' && (!kind || d.kind === kind))
    .map((d) => {
      const body = terms(d.title + ' ' + d.text).join(' ');
      const overlap = tokens.reduce((sum, t) => sum + (body.includes(t) ? 1 : 0), 0);
      const topic = requestedTopics.filter((t) => (d.topics || []).includes(t)).length * 3;
      return { document: d, match: overlap + topic };
    })
    .filter((row) => row.match > 0)
    .sort(
      (a, b) => b.match - a.match || b.document.publishedAt.localeCompare(a.document.publishedAt)
    )
    .slice(0, limit)
    .map((row) => ({ ...row.document, match: row.match }));
}
