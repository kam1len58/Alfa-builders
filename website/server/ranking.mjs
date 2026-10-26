// Ранжирование новых материалов. Баллы демо-бэкенда сохраняются отдельно.
const catalog = [
  [
    'RATE',
    0.8,
    /ключев.{0,15}ставк|процентн.{0,15}ставк|ставк.{0,30}(?:цб|кредит|депозит)|денежно.кредит|кредитован/u,
    (p) => p.bankProducts?.hasLoans === 1 || p.bankProducts?.hasDeposit === 1,
    'У компании есть кредитные или депозитные продукты; условия и сроки требуют проверки.',
    ['Кредит', 'Депозит'],
  ],
  [
    'INFL_COSTS',
    0.5,
    /инфляц|потребительск.{0,25}цен|индекс.{0,15}цен|себестоим|(?<![а-яё])фот(?![а-яё])|зарплат|фонд.{0,12}оплат.{0,8}труд|расход.{0,12}на персонал|(?:рост|повышен|снижен).{0,15}цен|материал.{0,15}дорожа/u,
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
    /санкц|эмбарго|ограничен.{0,45}(?:экспорт|импорт|международн.{0,12}торгов|внешн.{0,12}постав)|запрет.{0,25}(?:экспорт|импорт)/u,
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
    /госзакуп|государственн.{0,12}закуп|44.фз|223.фз|госконтракт|тендер/u,
    (p) => p.bankProducts?.hasGuarantees === 1,
    'Есть банковские гарантии; участие в госзаказе остаётся гипотезой.',
    ['Гарантия'],
  ],
  [
    'OIL',
    0.8,
    /нефт|(?<![а-яё])газ(?:а|у|ом|е|овый|овая|овые|одобыч[а-яё]*)?(?![а-яё])|brent|urals|добыч/u,
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
  // Remove explicitly negated topics and cultural uses before matching business events.
  const title = String(text)
    .split(/[.!?\n]/u)[0]
    .toLowerCase();
  if (
    /ставк.{0,30}(?:матч|финал|чемпионат)|(?:фильм|музе[йяе]|кинофестивал|роман|спектакл)/u.test(
      title
    )
  )
    return [];
  const normalized = String(text)
    .toLowerCase()
    .replace(
      /(?:а не|не касается|не затрагивает|не связан[а-яё]* с|не тарифов|без сообщения об)[^.;!?]*/gu,
      ' '
    );
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
  hits.push(
    ...relationshipHits(
      profile,
      tags,
      hits.map((h) => h.rule)
    )
  );
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
      contentScope: document.contentScope || 'source_text',
    },
    score: Number(score.toFixed(6)),
    tier: score < 0.4 ? 'Hidden' : score >= 0.6 ? 'Focus' : 'All',
    hits,
    rankingOrigin: 'source-rules-v3',
  };
}
export function relationshipHits(profile, tags, directRules = []) {
  const sectorRules = new Set(['PMI_ORDERS', 'FUEL', 'OIL', 'TECH_SECURITY']);
  const relevant = (p) =>
    catalog
      .filter(
        ([code, , , applies]) =>
          sectorRules.has(code) && tags.includes(code) && !directRules.includes(code) && applies(p)
      )
      .map(([code]) => code);
  const hits = [];
  for (const [direction, partners] of [
    ['outgoing', profile.counterparties?.topSuppliers],
    ['incoming', profile.counterparties?.topCustomers],
  ]) {
    for (const [i, p] of (partners || []).slice(0, 3).entries()) {
      if (!Number.isFinite(p.share) || p.share < 0.1) continue;
      for (const code of relevant({ okvedCode: p.okvedCode }))
        hits.push({
          rule: 'PARTNER_SECTOR',
          relation: direction + ':' + i + ':' + code,
          weight: 0.42,
          companyFeature: 'partners.' + direction + '.partner' + (i + 1) + '.industry',
          bankProducts: [],
          explanation: `Крупный ${direction === 'outgoing' ? 'получатель' : 'отправитель'} платежей (${Math.round(p.share * 100)}% этого направления) относится к отрасли «${p.okvedName || p.okvedCode}». Событие может затронуть расчёты с ним; назначение платежей и роль контрагента требуется проверить.`,
        });
    }
  }
  for (const [i, p] of (profile.affiliation?.groupContext?.industries || [])
    .slice(0, 5)
    .entries()) {
    for (const code of relevant({ okvedCode: p.okved }))
      hits.push({
        rule: 'GROUP_SECTOR',
        relation: 'group:' + i + ':' + code,
        weight: 0.4,
        companyFeature: 'group.industries.industry' + (i + 1) + '.name',
        bankProducts: [],
        explanation: `В наблюдаемой группе по GROUP_ID есть отрасль «${p.name || p.okved}». Проверьте, связан ли эффект с вашей компанией: принадлежность к группе не подтверждает общие обязательства.`,
      });
  }
  // Several indirect links are one hypothesis, not independent evidence that can inflate priority.
  return hits.slice(0, 1);
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
      (a, b) =>
        b.match - a.match ||
        String(b.document.publishedAt || '').localeCompare(a.document.publishedAt || '')
    )
    .slice(0, limit)
    .map((row) => ({ ...row.document, match: row.match }));
}
