export function scoreReviewPacket(packet) {
  const reviewed = packet.entries.filter(
    (e) => typeof e.reviewer === 'string' && e.reviewer.trim()
  );
  const metric = (rows, key) => {
    const labelled = rows.filter((e) => typeof e[key] === 'boolean');
    return {
      n: labelled.length,
      value: labelled.length ? labelled.filter((e) => e[key]).length / labelled.length : null,
    };
  };
  const cohorts = new Map();
  for (const e of packet.entries.filter((e) => e.cohort === 'top5')) {
    const id = e.company.syntheticU;
    cohorts.set(id, [...(cohorts.get(id) || []), e]);
  }
  const complete = [...cohorts.values()].filter(
    (rows) =>
      rows.length === 5 &&
      new Set(rows.map((r) => r.position)).size === 5 &&
      rows.every((e) => e.reviewer?.trim() && typeof e.relevant === 'boolean')
  );
  return {
    humanReviews: reviewed.length,
    precisionAt5: {
      companies: complete.length,
      n: complete.length * 5,
      value: complete.length
        ? complete.reduce((s, rows) => s + rows.filter((e) => e.relevant).length / 5, 0) /
          complete.length
        : null,
    },
    partialRelevance: metric(
      reviewed.filter((e) => e.cohort === 'top5'),
      'relevant'
    ),
    factsCorrect: metric(
      reviewed.filter((e) => e.analysis),
      'factsCorrect'
    ),
    actionsUseful: metric(
      reviewed.filter((e) => e.analysis),
      'actionsUseful'
    ),
    bankAttributionCorrect: metric(
      reviewed.filter((e) => e.analysis),
      'bankAttributionCorrect'
    ),
    hiddenAuditRelevant: metric(
      reviewed.filter((e) => e.cohort === 'hidden-audit'),
      'relevant'
    ),
    note: 'Precision@5 требует полностью размеченной пятёрки. Неполная выборка и добровольные оценки могут быть смещены. Скрытая подвыборка не даёт recall всего потока. Строка reviewer сама по себе не подтверждает независимость.',
  };
}
