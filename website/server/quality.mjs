import { rankDocument } from './ranking.mjs';
import { AiError } from './llm-client.mjs';
export function evaluateBenchmark(benchmark, { usedForTuning = false } = {}) {
  if (
    !benchmark ||
    !benchmark.profiles ||
    !Array.isArray(benchmark.cases) ||
    !benchmark.cases.length ||
    benchmark.cases.length > 10000 ||
    new Set(benchmark.cases.map((c) => c.id)).size !== benchmark.cases.length
  )
    throw new Error('Invalid benchmark');
  let tp = 0,
    fp = 0,
    fn = 0,
    tn = 0,
    weighted = 0,
    totalWeight = 0;
  const cases = benchmark.cases.map((example) => {
    const profile = benchmark.profiles[example.profile];
    if (
      !profile ||
      typeof example.relevant !== 'boolean' ||
      typeof example.title !== 'string' ||
      typeof example.text !== 'string'
    )
      throw new Error('Invalid benchmark case');
    const row = rankDocument(profile, {
      id: example.id,
      title: example.title,
      text: example.text,
      publishedAt: '2026-10-01',
      url: 'https://www.cbr.ru/test',
      publisher: 'Синтетический тест',
    });
    const actual = row.tier !== 'Hidden',
      expected = example.relevant;
    if (actual && expected) tp++;
    else if (actual) fp++;
    else if (expected) fn++;
    else tn++;
    const weight = example.critical ? 2 : 1;
    weighted += actual === expected ? weight : 0;
    totalWeight += weight;
    return {
      id: example.id,
      profile: example.profile,
      expected,
      actual,
      score: row.score,
      passed: actual === expected,
    };
  });
  return {
    version: benchmark.version,
    at: new Date().toISOString(),
    synthetic: true,
    independentValidation: false,
    usedForTuning,
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
    note:
      'Синтетические контрольные примеры проверяют правила отбора. ' +
      (usedForTuning
        ? 'Набор использован при доработке правил и больше не является отложенной выборкой. '
        : '') +
      'Они не измеряют фактологическую точность модели или качество на рынке в целом.',
  };
}
export function createQuality({ store }) {
  async function recordFeed(user, company, rows, durationMs) {
    await store.update((state) => {
      state.feeds = [
        ...(state.feeds || []),
        {
          at: new Date().toISOString(),
          userId: user.id,
          companyId: company.syntheticU,
          industry: company.okvedCode,
          ids: rows.slice(0, 5).map((r) => r.news.id),
          durationMs,
        },
      ].slice(-1000);
    });
  }
  async function engagement(user, input) {
    if (!['source_open', 'card_open', 'chat_answer'].includes(input.type))
      throw new AiError('EVENT_INVALID', 'Некорректное событие.', 400);
    await store.update((state) => {
      state.engagement = [
        ...(state.engagement || []),
        {
          at: new Date().toISOString(),
          userId: user.id,
          companyId: input.companyId,
          newsId: input.newsId,
          type: input.type,
        },
      ].slice(-3000);
    });
  }
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
    const criteria = {};
    for (const key of ['factsCorrect', 'relevant', 'actionsUseful', 'bankAttributionCorrect']) {
      const value = input.criteria?.[key];
      if (value !== undefined && value !== null && typeof value !== 'boolean')
        throw new AiError('REVIEW_INVALID', 'Некорректный критерий оценки.', 400);
      criteria[key] = value ?? null;
    }
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
        criteria,
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
    const feeds = (state.feeds || []).filter((row) => matches(user, row)),
      latest = [...new Map(feeds.map((row) => [row.companyId, row])).values()];
    const labels = new Map();
    for (const r of reviews) {
      const analysis = analyses.find((a) => a.id === r.analysisId);
      if (analysis && typeof r.criteria?.relevant === 'boolean')
        labels.set(analysis.companyId + ':' + analysis.newsId, r.criteria.relevant);
    }
    const completeTop5 = latest.filter(
      (f) => f.ids.length === 5 && f.ids.every((id) => labels.has(f.companyId + ':' + id))
    );
    const overlaps = [];
    for (let i = 0; i < latest.length; i++)
      for (let j = i + 1; j < latest.length; j++) {
        const a = latest[i],
          b = latest[j];
        if (
          String(a.industry).slice(0, 2) === String(b.industry).slice(0, 2) ||
          !a.ids.length ||
          !b.ids.length
        )
          continue;
        const union = new Set([...a.ids, ...b.ids]);
        overlaps.push(a.ids.filter((id) => b.ids.includes(id)).length / union.size);
      }
    const feedTimes = feeds
      .map((r) => r.durationMs)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const interactions = (state.engagement || []).filter((row) => matches(user, row));
    const keys = (type) =>
      new Set(
        interactions
          .filter((r) => r.type === type)
          .map((r) => [r.userId, r.companyId, r.newsId].join(':'))
      );
    const opened = keys('card_open'),
      sourcesOpened = keys('source_open'),
      chats = keys('chat_answer');
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
        sourceOpenRate: ratio([...opened].filter((k) => sourcesOpened.has(k)).length, opened.size),
        chatUseRate: ratio([...opened].filter((k) => chats.has(k)).length, opened.size),
        precisionAt5: completeTop5.length
          ? completeTop5.reduce(
              (s, f) => s + f.ids.filter((id) => labels.get(f.companyId + ':' + id)).length / 5,
              0
            ) / completeTop5.length
          : null,
        fullyReviewedTop5: completeTop5.length,
        crossIndustryTop5Overlap: overlaps.length
          ? overlaps.reduce((s, v) => s + v, 0) / overlaps.length
          : null,
        crossIndustryPairs: overlaps.length,
        feedP95Ms: feedTimes.length ? feedTimes[Math.ceil(feedTimes.length * 0.95) - 1] : null,
        expertFactsCorrect: ratio(
          reviews.filter((row) => row.criteria?.factsCorrect === true).length,
          reviews.filter((row) => typeof row.criteria?.factsCorrect === 'boolean').length
        ),
        expertRelevant: ratio(
          reviews.filter((row) => row.criteria?.relevant === true).length,
          reviews.filter((row) => typeof row.criteria?.relevant === 'boolean').length
        ),
        expertActionsUseful: ratio(
          reviews.filter((row) => row.criteria?.actionsUseful === true).length,
          reviews.filter((row) => typeof row.criteria?.actionsUseful === 'boolean').length
        ),
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
      feedMonitoring: {
        openedCards: opened.size,
        sourceOpenedCards: [...opened].filter((k) => sourcesOpened.has(k)).length,
        chatCards: [...opened].filter((k) => chats.has(k)).length,
        snapshots: feeds.length,
        companies: latest.length,
        expertLabels: labels.size,
        engagements: (state.engagement || []).filter((r) => matches(user, r)).length,
        note: 'Precision@5 считается только для полностью размеченных пятёрок. Автоматические проверки и отзывы клиентов не заменяют экспертные метки. Пересечение лент — Jaccard последних пятёрок разных разделов ОКВЭД; это диагностический показатель, не точность.',
      },
      reviews: reviews.slice(-20),
      evaluation: state.evaluation,
      disclaimer:
        'Наличие ссылок и автоматическая проверка не доказывают истинность. Содержательное качество оценивается отдельно экспертом.',
    };
  }
  return { recordAnalysis, recordFeed, engagement, feedback, review, overview };
}
