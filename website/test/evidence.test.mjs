import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectEvidence } from '../server/evidence.mjs';
import { classify, rankDocument } from '../server/ranking.mjs';
import { evaluateBenchmark, createQuality } from '../server/quality.mjs';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openState } from '../server/state.mjs';
const sources = [
  { id: 'news:N', kind: 'news', data: { content: 'Инфляция замедлилась до пяти процентов.' } },
  {
    id: 'company:C',
    kind: 'company',
    data: { industry: 'Оптовая торговля', bankProducts: { hasLoans: 1 } },
  },
  {
    id: 'bank:B',
    kind: 'bank',
    verified: true,
    data: { text: 'Историческая оценка банка от сентября.' },
  },
];
const evidence = [
  { sourceId: 'news:N', quote: 'Инфляция замедлилась' },
  { sourceId: 'company:C', feature: 'industry', quote: 'Оптовая торговля' },
];
const analysis = {
  summary: { text: 'Описание.', sourceIds: ['news:N'], evidence: [evidence[0]] },
  whyImportant: { text: 'Условный вывод.', sourceIds: ['news:N', 'company:C'], evidence },
  risks: [],
  opportunities: [],
  actions: [
    {
      text: 'Уточнить условия.',
      sourceIds: ['bank:B'],
      evidence: [{ sourceId: 'bank:B', quote: 'Историческая оценка банка' }],
    },
  ],
};
test('Точные цитаты, конкретные признаки и использование материала банка проверяются', () => {
  assert.equal(inspectEvidence(analysis, sources).valid, true);
  const changed = structuredClone(analysis);
  changed.whyImportant.evidence[1].quote = 'Другая отрасль';
  assert.equal(inspectEvidence(changed, sources).valid, false);
  const forged = structuredClone(analysis);
  forged.actions[0].evidence[0].quote = 'Выдуманная цитата';
  assert.equal(inspectEvidence(forged, sources).valid, false);
  const missing = structuredClone(analysis);
  missing.actions = [];
  assert.equal(inspectEvidence(missing, sources).valid, false);
});
test('Новые новости классифицируются независимо от регистра; выставка и поставки не являются ставкой', () => {
  assert.ok(classify('PMI изменился, ФОТ вырос').includes('PMI_ORDERS'));
  assert.ok(!classify('Открылась выставка; поставки запланированы').includes('RATE'));
  const profile = { okvedCode: '46.3', bankProducts: { hasLoans: 1 }, ved: { hasVed: 1 } };
  const ranked = rankDocument(profile, {
    id: 'unseen',
    title: 'Инфляция замедлилась',
    text: 'Потребительские цены изменились',
    publishedAt: '2026-10-01',
  });
  assert.equal(ranked.tier, 'All');
  assert.equal(ranked.score, 0.5);
});
test('Синтетический benchmark выдаёт вычисленные метрики и не заявляет достоверность модели', async () => {
  const data = JSON.parse(
    await readFile(new URL('../data/quality-benchmark.json', import.meta.url), 'utf8')
  );
  const result = evaluateBenchmark(data);
  assert.equal(result.cases.length, 24);
  assert.equal(result.metrics.tp + result.metrics.fp + result.metrics.fn + result.metrics.tn, 24);
  assert.equal(result.independentValidation, false);
  assert.ok(result.metrics.precision >= 0.85);
  assert.ok(result.metrics.recall >= 0.85);
});
test('Отзывы изолированы по пользователям и компаниям, экспертные оценки требуют существующего разбора', async () => {
  const root = await mkdtemp(join(tmpdir(), 'alfa-quality-'));
  try {
    const store = await openState(root),
      quality = createQuality({ store }),
      user = { id: 'a', companies: ['C1'] };
    await quality.feedback(user, {
      companyId: 'C1',
      newsId: 'N',
      rating: 'useful',
      comment: 'Синтетический отзыв',
    });
    await quality.feedback(
      { id: 'b', companies: ['C2'] },
      { companyId: 'C2', newsId: 'N', rating: 'error' }
    );
    assert.equal(quality.overview(user).counts.feedback, 1);
    await assert.rejects(
      quality.review(user, { analysisId: 'missing', verdict: 'approved' }),
      (e) => e.status === 404
    );
    await quality.recordAnalysis({
      id: 'known',
      companyId: 'C1',
      newsId: 'N',
      status: 'completed',
      claims: 2,
      citedClaims: 2,
      bankUsed: true,
    });
    await quality.review(user, { analysisId: 'known', verdict: 'rejected', comment: 'Тест' });
    assert.equal(quality.overview(user).metrics.expertApproval, 0);
    await quality.feedback(user, { companyId: 'C1', newsId: 'N', rating: null });
    assert.equal(quality.overview(user).counts.feedback, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
