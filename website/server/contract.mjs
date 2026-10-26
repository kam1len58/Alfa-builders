import { companyContext } from './company-context.mjs';
import { profileValue } from './evidence.mjs';
export function rankingTraceId(companyId, row) {
  return 'rank:' + companyId + ':' + row.news.id + ':' + row.news.contentHash.slice(0, 24);
}
export function companyFeatures(insight) {
  if (!insight) return [];
  const a = insight.analysis;
  return [
    ...new Set(
      [a.summary, a.whyImportant, ...a.risks, ...a.opportunities, ...a.actions]
        .flatMap((c) => c.evidence || [])
        .filter((e) => e.sourceId.startsWith('company:') && e.feature)
        .map((e) => e.feature)
    ),
  ];
}
export function toCard(company, row, insight = null) {
  const n = row.news,
    pubs = n.sourceRecords || [];
  const bankSources = (insight?.sources || []).filter((s) => s.kind === 'bank');
  return {
    news_id: n.id,
    company_id: company.syntheticU,
    date: n.publishedAt,
    title: n.title,
    category: n.category,
    score: row.score,
    bucket: row.score >= 0.6 ? 'focus' : 'all',
    facts: {
      text: pubs.some((p) => p.url) ? n.content : null,
      sources: [
        ...new Map(
          pubs
            .flatMap((p) => [
              ...(p.url ? [{ title: p.title, url: p.url, date: p.date, scope: p.scope }] : []),
              ...(p.links || []).map((l) => ({
                title: l.title,
                url: l.url,
                date: l.publishedAt,
                availability: l.liveHttps === false ? 'not_fetched' : 'available',
              })),
            ])
            .map((s) => [s.url, s])
        ).values(),
      ],
      status: !pubs.some((p) => p.url)
        ? 'unverified'
        : pubs.some((p) => p.sourceStatus === 'reviewed_summary')
          ? 'source_matched'
          : pubs.some((p) => p.scope === 'rss_excerpt')
            ? 'rss_excerpt'
            : 'source_text',
    },
    alfa_view:
      insight?.bankView.status === 'available'
        ? {
            text: insight.bankView.text,
            sources: bankSources.map((s) => ({ title: s.title, url: s.url, date: s.date })),
            historical: true,
          }
        : { text: null, sources: [], status: 'not_generated_or_unavailable' },
    ai_conclusion: insight
      ? {
          why_important: insight.analysis.whyImportant.text,
          consequences: {
            risks: insight.analysis.risks.map((c) => c.text + ' Условие: ' + c.condition),
            opportunities: insight.analysis.opportunities.map(
              (c) => c.text + ' Условие: ' + c.condition
            ),
          },
          actions: insight.analysis.actions.map((c) => c.text),
          company_features_used: companyFeatures(insight).map(
            (path) => path + '=' + String(profileValue(companyContext(company), path))
          ),
          matched_rules: row.hits.map((h) => h.rule),
        }
      : null,
    next_best_action: insight?.analysis.actions.length
      ? { product: null, text: insight.analysis.actions[0].text }
      : null,
    trace_id: insight?.id || rankingTraceId(company.syntheticU, row),
    analysis_status: insight ? 'ready' : 'not_generated',
    publications: pubs,
    member_ids: n.memberIds || [n.id],
    discrepancies: n.discrepancies || [],
    source_warnings: n.sourceWarnings || [],
    source_excerpt: n.content,
    content_scope: n.contentScope || 'source_text',
    origin: n.origin || 'prepared',
    content_hash: n.contentHash,
    ranking: {
      explanation: row.hits.map((h) => h.explanation).join('\n'),
      hits: row.hits,
      origin: row.rankingOrigin,
    },
    analysis_payload: insight,
  };
}
export function traceView(value) {
  return {
    trace_id: value.id,
    company_id: value.companyId,
    news_id: value.newsId,
    created_at: value.generatedAt,
    status: 'completed',
    steps: value.workflow,
    plan: value.plan,
    sources: value.sources,
    company_features_used: companyFeatures(value),
    checks: value.quality,
  };
}
