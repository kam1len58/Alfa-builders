import test from 'node:test';
import assert from 'node:assert/strict';
import { createInsightsService } from '../server/insights.mjs';
const company = {
  syntheticU: 'C1',
  industry: 'Оптовая торговля',
  okvedCode: '46.3',
  region: 'Москва',
  bankProducts: { hasLoans: 1 },
  ved: { hasVed: 1 },
  counterparties: { topSupplierShare: 0.4 },
};
const news = {
  id: 'UNSEEN',
  title: 'Инфляция',
  content: 'Инфляция замедлилась до пяти процентов.',
  publishedAt: '2026-10-01',
  source: 'https://www.cbr.ru/news',
  contentHash: 'stable',
};
const item = { news, score: 0.5, tier: 'All', hits: [{ rule: 'INFL_COSTS', bankProducts: [] }] };
const bank = {
  id: 'BANK',
  title: 'Инфляция в сентябре',
  text: 'Ожидается постепенное замедление инфляции.',
  expertStance: 'Ожидается постепенное замедление инфляции.',
  publishedAt: '2026-09-01',
  sourceUrl: 'https://drive.google.com/bank',
  url: 'https://drive.google.com/bank',
  verified: true,
  historical: true,
  kind: 'bank',
  caveat: 'Историческая оценка.',
  status: 'ready',
  documentHash: 'pdf-hash',
  contentHash: 'stable',
};
const sourceIds = ['news:UNSEEN', 'company:C1'];
const good = {
  summary: {
    text: 'Инфляция замедлилась.',
    sourceIds: ['news:UNSEEN'],
    evidence: [{ sourceId: 'news:UNSEEN', quote: 'Инфляция замедлилась' }],
  },
  whyImportant: {
    text: 'Если изменяются закупочные цены, торговой компании стоит уточнить бюджет.',
    sourceIds,
    evidence: [
      { sourceId: 'news:UNSEEN', quote: 'Инфляция замедлилась' },
      { sourceId: 'company:C1', feature: 'industry', quote: 'Оптовая торговля' },
    ],
  },
  risks: [],
  opportunities: [],
  actions: [
    {
      text: 'Сравнить фактические затраты с исторической оценкой банка.',
      rationale: 'Проверить актуальность на дату решения.',
      sourceIds: ['bank:BANK'],
      evidence: [{ sourceId: 'bank:BANK', quote: 'постепенное замедление инфляции' }],
    },
  ],
  missingData: ['Договорные цены'],
};
const plan = {
  tools: ['company_profile', 'news_text', 'ranking', 'bank_materials', 'source_search'],
  questions: ['Как соотнести инфляцию с профилем?'],
};
function create(queue, { changed = false } = {}) {
  const operations = [],
    events = [];
  const dataService = {
    context: async () => ({ company, item }),
    company: async () => company,
    news: async () => (changed ? { ...news, content: 'Изменённый источник' } : news),
    feed: async () => [item],
  };
  const collector = {
    bankFor: () => ({ items: [bank], note: 'Исторический материал' }),
    search: (query) => {
      operations.push(query);
      return [bank];
    },
    byId: (id) => (id === 'BANK' ? bank : null),
    fingerprint: () => 'corpus-v1',
  };
  const llm = {
    configured: true,
    model: 'synthetic-test-model',
    complete: async (system, data) => {
      assert.ok(queue.length, 'Лишний вызов модели');
      const result = queue.shift();
      return {
        result: structuredClone(result),
        usage: { inputTokens: 1, outputTokens: 1 },
        durationMs: 1,
      };
    },
  };
  return {
    service: createInsightsService({
      llm,
      backendUrl: new URL('http://127.0.0.1'),
      dataService,
      collector,
      cacheDirectory: '',
      auditPath: '',
      onAnalysis: async (e) => events.push(e),
    }),
    operations,
    events,
  };
}
test('План, инструменты, источники банка, точные основания и кэш работают совместно', async () => {
  const { service, operations, events } = create([plan, good, { approved: true, issues: [] }]);
  const [first, second] = await Promise.all([
    service.analysisFor('C1', 'UNSEEN'),
    service.analysisFor('C1', 'UNSEEN'),
  ]);
  assert.equal(first.id, second.id);
  assert.equal(first.quality.citedClaims, 3);
  assert.equal(first.quality.bankUsed, true);
  assert.equal(first.bankView.status, 'available');
  assert.equal(first.bankView.historical, true);
  assert.ok(first.workflow.some((s) => s.tool === 'source_search'));
  assert.ok(operations.length);
  assert.equal((await service.analysisFor('C1', 'UNSEEN')).cached, true);
  assert.equal(events.filter((e) => !e.cached).length, 1);
  assert.equal(events.at(-1).cached, true);
});
test('Пустой ответ проверяющей модели и null в цитатах запускают исправление без TypeError', async () => {
  const first = create([plan, good, null, good, { approved: true, issues: [] }]);
  assert.equal((await first.service.analysisFor('C1', 'UNSEEN')).quality.repaired, true);
  const malformed = structuredClone(good);
  malformed.whyImportant.evidence = [null];
  const second = create([plan, malformed, good, { approved: true, issues: [] }]);
  assert.equal((await second.service.analysisFor('C1', 'UNSEEN')).quality.repaired, true);
});
test('Выдуманная цитата приводит к повторному поиску и исправлению, а не к выдаче ошибки как факта', async () => {
  const bad = structuredClone(good);
  bad.summary.evidence[0].quote = 'Выдуманная цитата';
  const { service, operations } = create([plan, bad, good, { approved: true, issues: [] }]);
  const result = await service.analysisFor('C1', 'UNSEEN');
  assert.equal(result.quality.repaired, true);
  assert.ok(operations.length >= 2);
  assert.ok(result.workflow.some((s) => s.reason === 'review_requested'));
});
test('Противоречие, найденное моделью, запускает адресный поиск; второй отказ не скрывается', async () => {
  const { service, operations, events } = create([
    plan,
    good,
    { approved: false, issues: ['Нет основания'], searchQueries: ['Контекст инфляции'] },
    good,
    { approved: false, issues: ['Ошибка осталась'] },
    good,
    { approved: false, issues: ['Ошибка осталась'] },
  ]);
  await assert.rejects(service.analysisFor('C1', 'UNSEEN'), (e) => e.code === 'AI_REVIEW_FAILED');
  assert.ok(operations.includes('Контекст инфляции'));
  assert.equal(events[0].status, 'rejected');
});
test('Изменение источника останавливает генерацию, неизвестные инструменты запрещены', async () => {
  const changed = create([plan], { changed: true });
  await assert.rejects(
    changed.service.analysisFor('C1', 'UNSEEN'),
    (e) => e.code === 'AI_DATA_CHANGED'
  );
  const injection = create([{ tools: ['run_shell'], questions: [] }]);
  await assert.rejects(
    injection.service.analysisFor('C1', 'UNSEEN'),
    (e) => e.code === 'AI_PLAN_INVALID'
  );
});

test('Диалог исправляет неизвестную ссылку и проверяет цитаты и смысл перед выдачей', async () => {
  const answer = {
    text: 'Проверьте условия кредитного договора; параметры в профиле не раскрыты.',
    sourceIds: ['company:C1'],
    evidence: [{ sourceId: 'company:C1', feature: 'bankProducts.hasLoans', quote: '1' }],
    missingData: ['Условия договора'],
  };
  const { service } = create([
    plan,
    good,
    { approved: true, issues: [] },
    { ...answer, sourceIds: ['invented'] },
    answer,
    { approved: true, issues: [] },
  ]);
  const result = await service.chat({
    companyId: 'C1',
    newsId: 'UNSEEN',
    question: 'Что проверить?',
    history: [],
  });
  assert.equal(result.text, answer.text);
  assert.ok(result.sources.some((source) => source.kind === 'company'));
});

test('Диалог не выдаёт ответ после повторного смыслового отказа', async () => {
  const answer = {
    text: 'Проверить параметры договора.',
    sourceIds: ['company:C1'],
    evidence: [{ sourceId: 'company:C1', feature: 'bankProducts.hasLoans', quote: '1' }],
    missingData: [],
  };
  const { service } = create([
    plan,
    good,
    { approved: true, issues: [] },
    answer,
    { approved: false, issues: ['Ошибка'] },
    answer,
    { approved: false, issues: ['Ошибка осталась'] },
  ]);
  await assert.rejects(
    service.chat({ companyId: 'C1', newsId: 'UNSEEN', question: 'Что проверить?', history: [] }),
    (error) => error.code === 'AI_CHAT_REVIEW_FAILED'
  );
});
