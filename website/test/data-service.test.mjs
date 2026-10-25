import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataService } from '../server/data-service.mjs';
test('Адаптер сохраняет исходные баллы, но не превращает экспорт топлива в рост цен или платежи в закупки', async () => {
  const news = {
    id: 'prepared',
    title: 'Экспорт топлива вырос',
    content: 'Увеличилось предложение',
    publishedAt: '2026-10-01',
  };
  const original = {
    news,
    score: 0.998,
    tier: 'Focus',
    hits: [
      { rule: 'FUEL', explanation: 'Рост цен гарантирован', bankProducts: [] },
      {
        rule: 'SUPPLIER_CONCENTRATION',
        explanation: 'Закупки критически зависимы',
        bankProducts: [],
      },
    ],
  };
  const service = createDataService({
    backendUrl: new URL('http://127.0.0.1'),
    collector: { news: () => [] },
    fetcher: async (url) => ({
      ok: true,
      json: async () =>
        url.pathname.endsWith('/feed')
          ? [original]
          : { syntheticU: 'C', okvedCode: '41', bankProducts: {}, ved: {} },
    }),
  });
  const [row] = await service.feed('C');
  assert.equal(row.score, original.score);
  assert.equal(row.tier, original.tier);
  assert.equal(row.news.content, news.content);
  assert.deepEqual(row.news.memberIds, [news.id]);
  assert.equal(row.news.sourceRecords[0].text, news.content);
  assert.ok(row.hits.every((hit) => hit.explanationOrigin === 'profile_safety_note'));
  assert.ok(!row.hits.some((hit) => /гарантирован|критически зависимы/.test(hit.explanation)));
});
