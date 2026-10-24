const normalize = (text) => String(text).replace(/\s+/g, ' ').trim();
export function profileValue(data, path) {
  if (
    typeof path !== 'string' ||
    !/^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*){0,4}$/.test(path) ||
    /__proto__|constructor|prototype/.test(path)
  )
    return undefined;
  return path
    .split('.')
    .reduce((value, key) => (value && Object.hasOwn(value, key) ? value[key] : undefined), data);
}
export function inspectEvidence(analysis, sources, { requireBank = true } = {}) {
  const registry = new Map(sources.map((source) => [source.id, source]));
  const issues = [],
    entries = [
      ['summary', analysis?.summary],
      ['whyImportant', analysis?.whyImportant],
      ...(analysis?.risks || []).map((c, i) => ['risks[' + i + ']', c]),
      ...(analysis?.opportunities || []).map((c, i) => ['opportunities[' + i + ']', c]),
      ...(analysis?.actions || []).map((c, i) => ['actions[' + i + ']', c]),
    ].filter(([, c]) => c),
    claims = entries.map(([, c]) => c);
  let cited = 0;
  for (const [index, claim] of claims.entries()) {
    const path = entries[index][0];
    if (!Array.isArray(claim.evidence) || !claim.evidence.length || claim.evidence.length > 8) {
      issues.push('Вывод ' + (index + 1) + ': нет точных оснований.');
      continue;
    }
    const valid = [];
    for (const e of claim.evidence) {
      const source = registry.get(e.sourceId);
      if (
        !source ||
        !claim.sourceIds?.includes(e.sourceId) ||
        typeof e.quote !== 'string' ||
        e.quote.length > 300 ||
        !normalize(e.quote)
      ) {
        issues.push('Вывод ' + (index + 1) + ': некорректная ссылка или цитата.');
        continue;
      }
      if (source.kind === 'company' || (source.kind === 'ranking' && e.feature)) {
        const value = profileValue(source.data, e.feature);
        if (
          value === undefined ||
          typeof value === 'object' ||
          normalize(value) !== normalize(e.quote)
        ) {
          issues.push('Вывод ' + (index + 1) + ': признак профиля не совпадает.');
          continue;
        }
      } else {
        const text =
          source.kind === 'news'
            ? [source.data.title, source.data.content].join(' ')
            : source.data.text || source.data.note || '';
        if (normalize(e.quote).length < 6 || !normalize(text).includes(normalize(e.quote))) {
          issues.push(
            path +
              ': цитата «' +
              e.quote.slice(0, 180) +
              '» не найдена дословно в ' +
              e.sourceId +
              '. Замените её точным фрагментом из data.quotes или data.content/text.'
          );
          continue;
        }
      }
      valid.push(e.sourceId);
    }
    if (valid.length === claim.evidence.length && claim.sourceIds.every((id) => valid.includes(id)))
      cited++;
    else issues.push('Вывод ' + (index + 1) + ': не для всех ссылок есть проверенное основание.');
  }
  const important = analysis?.whyImportant;
  if (
    !important?.evidence?.some((e) => registry.get(e.sourceId)?.kind === 'company') ||
    !important?.evidence?.some((e) => registry.get(e.sourceId)?.kind === 'news')
  )
    issues.push('Связь с компанией требует новости и конкретного признака профиля.');
  const banks = sources.filter((s) => s.kind === 'bank' && s.verified);
  if (
    requireBank &&
    banks.length &&
    !claims.some((claim) => claim.evidence?.some((e) => banks.some((b) => b.id === e.sourceId)))
  )
    issues.push('Релевантный материал банка не использован в выводах.');
  const bankClaims = claims.filter((claim) =>
    /альфа.банк.{0,70}(счита|ожида|прогноз|рекоменд|гарант)/iu.test(claim.text || '')
  );
  if (bankClaims.some((claim) => !claim.sourceIds?.some((id) => registry.get(id)?.kind === 'bank')))
    issues.push('Банковская оценка приведена без материала банка.');
  return {
    valid: issues.length === 0,
    issues: [...new Set(issues)].slice(0, 8),
    claims: claims.length,
    citedClaims: cited,
    bankUsed: claims.some((c) => c.sourceIds?.some((id) => registry.get(id)?.kind === 'bank')),
  };
}
