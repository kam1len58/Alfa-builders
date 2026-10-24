import { rankDocument } from './ranking.mjs';
import { AiError } from './llm-client.mjs';
export function evaluateBenchmark(benchmark) {
  let tp = 0,
    fp = 0,
    fn = 0,
    tn = 0,
    weighted = 0,
    totalWeight = 0;
  const cases = benchmark.cases.map((example) => {
    const profile = benchmark.profiles[example.profile];
    const row = rankDocument(profile, {
      id: example.id,
      title: example.title,
      text: example.text,
      publishedAt: '2026-10-01',
      url: 'https://www.cbr.ru/test',
      publisher: 'Синтетический тест',
    });
    const actual = row.score > 0,
      expected = example.relevant;
    if (actual && expected) tp++;
    else if (actual) fp++;
    else if (expected) fn++;
    else tn++;
    const weight = example.critical ? 2 : 1;
    weighted += actual === expected ? weight : 0;
    totalWeight += weight;
    return { id: example.id, expected, actual, score: row.score, passed: actual === expected };
  });
  return {
    version: benchmark.version,
    at: new Date().toISOString(),
    synthetic: true,
    independentValidation: false,
    cases,
    metrics: {
      precision: tp + fp ? tp / (tp + fp) : null,
      recall: tp + fn ? tp / (tp + fn) : null,
      accuracy: (tp + tn) / cases.length,
      weightedAccuracy: weighted / totalWeight,
      tp,
      fp,
      fn,
      tn,
    },
    note: 'Синтетические контрольные примеры проверяют правила отбора. Они не измеряют фактологическую точность модели или качество на рынке в целом.',
  };
}
export function createQuality({ store }) {
  async function recordAnalysis(entry) {
    await store.update((state) => {
      if (
        entry.status === 'completed' &&
        state.analyses.some((row) => row.id === entry.id && row.status === 'completed')
      )
        return;
      state.analyses.push({ at: new Date().toISOString(), ...entry });
      state.analyses = state.analyses.slice(-500);
    });
  }
  function matches(user, row) {
    return user.companies.includes('*') || user.companies.includes(row.companyId);
  }
  async function feedback(user, input) {
    if (
      !['useful', 'irrelevant', 'error', null].includes(input.rating) ||
      typeof input.companyId !== 'string' ||
      typeof input.newsId !== 'string' ||
      typeof (input.comment || '') !== 'string' ||
      String(input.comment || '').length > 1000
    )
      throw new AiError('FEEDBACK_INVALID', 'Некорректная оценка.', 400);
    await store.update((state) => {
      state.feedback = state.feedback.filter(
        (row) =>
          !(
            row.userId === user.id &&
            row.companyId === input.companyId &&
            row.newsId === input.newsId
          )
      );
      if (input.rating)
        state.feedback.push({
          userId: user.id,
          companyId: input.companyId,
          newsId: input.newsId,
          rating: input.rating,
          comment: String(input.comment || '').trim(),
          analysisId: input.analysisId || null,
          at: new Date().toISOString(),
        });
      state.feedback = state.feedback.slice(-3000);
    });
  }
  async function review(user, input) {
    if (
      !['approved', 'rejected'].includes(input.verdict) ||
      typeof input.analysisId !== 'string' ||
      typeof (input.comment || '') !== 'string' ||
      (input.comment || '').length > 1000
    )
      throw new AiError('REVIEW_INVALID', 'Некорректная экспертная оценка.', 400);
    const analysis = store
      .snapshot()
      .analyses.find((row) => row.id === input.analysisId && row.status === 'completed');
    if (!analysis || !matches(user, analysis))
      throw new AiError('REVIEW_MISSING', 'Разбор недоступен для оценки.', 404);
    await store.update((state) => {
      state.reviews = state.reviews.filter(
        (row) => !(row.analysisId === input.analysisId && row.userId === user.id)
      );
      state.reviews.push({
        analysisId: input.analysisId,
        userId: user.id,
        verdict: input.verdict,
        comment: input.comment || '',
        at: new Date().toISOString(),
        companyId: analysis.companyId,
      });
      state.reviews = state.reviews.slice(-1000);
    });
  }
  function overview(user) {
    const state = store.snapshot(),
      analyses = state.analyses.filter((row) => matches(user, row)),
      feedback = state.feedback.filter((row) => matches(user, row)),
      reviews = state.reviews.filter((row) => matches(user, row));
    const complete = analyses.filter((row) => row.status === 'completed'),
      failed = analyses.filter((row) => row.status === 'failed' || row.status === 'rejected');
    const ratio = (n, d) => (d ? n / d : null);
    const latencies = complete
      .map((row) => row.durationMs)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const alerts = [];
    if (
      state.evaluation &&
      (state.evaluation.metrics.precision < 0.85 || state.evaluation.metrics.recall < 0.85)
    )
      alerts.push('Контрольные примеры: точность или полнота ниже порога 85%.');
    if (analyses.length >= 10 && failed.length / analyses.length > 0.2)
      alerts.push('Более 20% разборов отклонены или завершились ошибкой.');
    if (
      feedback.length >= 10 &&
      feedback.filter((row) => row.rating === 'error').length / feedback.length > 0.1
    )
      alerts.push('Более 10% отзывов сообщают об ошибке.');
    return {
      at: new Date().toISOString(),
      alerts,
      window: 'Последние 500 попыток; отзывы и экспертные оценки хранятся отдельно',
      counts: {
        completed: complete.length,
        failed: failed.length,
        repaired: complete.filter((row) => row.repaired).length,
        feedback: feedback.length,
        expertReviews: reviews.length,
      },
      metrics: {
        citationCoverage: ratio(
          complete.reduce((n, row) => n + (row.citedClaims || 0), 0),
          complete.reduce((n, row) => n + (row.claims || 0), 0)
        ),
        bankUsage: ratio(complete.filter((row) => row.bankUsed).length, complete.length),
        firstPass: ratio(complete.filter((row) => !row.repaired).length, complete.length),
        failureRate: ratio(failed.length, analyses.length),
        usefulRate: ratio(
          feedback.filter((row) => row.rating === 'useful').length,
          feedback.length
        ),
        errorFeedbackRate: ratio(
          feedback.filter((row) => row.rating === 'error').length,
          feedback.length
        ),
        expertApproval: ratio(
          reviews.filter((row) => row.verdict === 'approved').length,
          reviews.length
        ),
        p95DurationMs: latencies.length
          ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)]
          : null,
      },
      recent: analyses
        .slice(-20)
        .reverse()
        .map(({ id, companyId, newsId, status, at, durationMs, repaired, bankUsed }) => ({
          id,
          companyId,
          newsId,
          status,
          at,
          durationMs,
          repaired,
          bankUsed,
        })),
      feedback: feedback.slice(-15).reverse(),
      reviews: reviews.slice(-20),
      evaluation: state.evaluation,
      disclaimer:
        'Наличие ссылок и автоматическая проверка не доказывают истинность. Содержательное качество оценивается отдельно экспертом.',
    };
  }
  return { recordAnalysis, feedback, review, overview };
}
