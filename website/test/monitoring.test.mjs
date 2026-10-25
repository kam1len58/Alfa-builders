import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuality } from '../server/quality.mjs';
import { createMeter } from '../server/meter.mjs';
import { createLlmClient } from '../server/llm-client.mjs';
import { scoreReviewPacket } from '../server/review-metrics.mjs';
test('Экспертный файл не выдаёт оценку одной новости за Precision@5', () => {
  const packet = {
    entries: [1, 2, 3, 4, 5].map((i) => ({
      company: { syntheticU: 'C' },
      cohort: 'top5',
      position: i,
      reviewer: i === 1 ? 'test' : '',
      relevant: i === 1 ? true : null,
    })),
  };
  assert.equal(scoreReviewPacket(packet).precisionAt5.value, null);
  packet.entries.forEach((e) => {
    e.reviewer = 'test';
    e.relevant = e.position !== 5;
  });
  assert.equal(scoreReviewPacket(packet).precisionAt5.value, 0.8);
});
const storage = () => {
  const data = { analyses: [], reviews: [], feedback: [] };
  return { snapshot: () => structuredClone(data), update: async (f) => f(data) };
};
test('Precision@5 не подменяет пропущенные экспертные метки нулями или автоматической оценкой', async () => {
  const store = storage(),
    q = createQuality({ store }),
    user = { id: 'expert', companies: ['*'] };
  await q.recordFeed(
    user,
    { syntheticU: 'C', okvedCode: '46' },
    [1, 2, 3, 4, 5].map((i) => ({ news: { id: 'N' + i } })),
    25
  );
  for (let i = 1; i <= 4; i++) {
    await q.recordAnalysis({ id: 'A' + i, companyId: 'C', newsId: 'N' + i, status: 'completed' });
    await q.review(user, {
      analysisId: 'A' + i,
      verdict: 'approved',
      criteria: { relevant: i !== 4 },
    });
  }
  assert.equal(q.overview(user).metrics.precisionAt5, null);
  await q.recordAnalysis({ id: 'A5', companyId: 'C', newsId: 'N5', status: 'completed' });
  await q.review(user, { analysisId: 'A5', verdict: 'approved', criteria: { relevant: true } });
  assert.equal(q.overview(user).metrics.precisionAt5, 0.8);
  assert.equal(q.overview({ companies: ['OTHER'] }).feedMonitoring.snapshots, 0);
});
test('Стоимость неизвестна без тарифа; платный обрезанный ответ учитывается, резерв ограничивает параллельный расход', async () => {
  const store = storage();
  let clock = new Date('2026-10-25T23:59:00Z');
  const unknown = createMeter({ store, now: () => clock });
  const llm = createLlmClient({
    apiKey: 'synthetic-key',
    model: 'test',
    meter: unknown,
    fetcher: async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          usage: { prompt_tokens: 100, completion_tokens: 20 },
          choices: [{ finish_reason: 'length' }],
        }),
    }),
  });
  await assert.rejects(llm.complete('test', {}), (e) => e.code === 'AI_TRUNCATED');
  assert.equal(unknown.overview().inputTokens, 100);
  assert.equal(unknown.overview().costRub, null);
  clock = new Date('2026-10-26T00:00:00Z');
  assert.equal(unknown.overview().calls, 0);
  const metered = createMeter({
    store,
    budget: 1,
    prices: { test: { input: 1000, output: 1000 } },
    now: () => clock,
  });
  const token = metered.reserve('test', 500, 400);
  assert.throws(
    () => metered.reserve('test', 200, 100),
    (e) => e.code === 'AI_BUDGET_EXCEEDED'
  );
  metered.release(token);
  await metered.record({
    model: 'test',
    usage: { prompt_tokens: 500, completion_tokens: 200 },
    status: 'stop',
    durationMs: 20,
  });
  assert.equal(metered.overview().costRub, 0.7);
});
