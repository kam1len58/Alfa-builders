import test from 'node:test';
import assert from 'node:assert/strict';
import { groupEvents } from '../server/events.mjs';
import { rankDocument } from '../server/ranking.mjs';
import { companyContext } from '../server/company-context.mjs';

const row = (id, title, date = '2026-10-23', score = 0.8) => ({
  news: { id, title, content: title, publishedAt: date, source: 'https://example.org/' + id },
  score,
  tier: 'Focus',
  hits: [],
});
test('Перепечатки решения ЦБ дают одно событие без сложения баллов, источники и расхождения сохранены', () => {
  const a = row('N10', 'Банк России снизил ключевую ставку до 15%'),
    b = row('press', 'ЦБ снизил ставку до 14%', undefined, 0.9);
  const grouped = groupEvents([a, b]);
  assert.equal(grouped.events.length, 1);
  const event = grouped.events[0];
  assert.equal(event.score, 0.9);
  assert.equal(event.news.id, 'N10');
  assert.equal(event.news.sourceRecords.length, 2);
  assert.equal(event.news.discrepancies.length, 1);
  assert.equal(event.news.sourceRecords.find((p) => p.id === 'press').text, b.news.content);
  const after = groupEvents([a, b, row('new', 'ЦБ снизил ключевую ставку')], grouped.assignments);
  assert.equal(after.events[0].news.id, 'N10');
  assert.ok(after.events[0].news.memberIds.includes('press'));
  const removed = groupEvents([row('new', 'ЦБ снизил ключевую ставку')], {
    new: 'N10',
    press: 'N10',
    N10: 'N10',
  });
  assert.ok(removed.events[0].news.memberIds.includes('press'));
});
test('Прогноз, другая страна и другое заседание не склеиваются с решением ЦБ', () => {
  const values = [
    row('a', 'ЦБ снизил ключевую ставку до 15%'),
    row('b', 'Эксперты ожидают снижение ключевой ставки до 15%'),
    row('c', 'ЦБ Турции снизил ключевую ставку до 15%'),
    row('d', 'ЦБ снизил ключевую ставку до 15%', '2026-11-23'),
  ];
  assert.equal(groupEvents(values).events.length, 4);
});
test('Отрасль значимого контрагента учитывается условно, малая доля и повторы не повышают приоритет', () => {
  const p = {
    syntheticU: 'U_1',
    okvedCode: '69',
    bankProducts: {},
    ved: {},
    counterparties: { topSuppliers: [{ share: 0.55, okvedCode: '49', okvedName: 'Транспорт' }] },
  };
  const d = {
    id: 'n',
    title: 'Стоимость дизельного топлива выросла',
    text: 'Дизельное топливо подорожало',
    publishedAt: '2026-10-20',
  };
  const result = rankDocument(p, d);
  assert.equal(result.tier, 'All');
  assert.ok(result.hits.some((h) => h.rule === 'PARTNER_SECTOR'));
  p.counterparties.topSuppliers.push(...Array(5).fill(p.counterparties.topSuppliers[0]));
  assert.equal(rankDocument(p, d).score, result.score);
  p.counterparties.topSuppliers = [{ ...p.counterparties.topSuppliers[0], share: 0.01 }];
  assert.equal(rankDocument(p, d).tier, 'Hidden');
});
test('Модели передаётся контекст связей без ID контрагентов, доля выборки не называется рыночной', () => {
  const c = companyContext({
    syntheticU: 'U_1',
    counterparties: {
      topSuppliers: [{ id: 'PRIVATE_ID', share: 0.6, okvedName: 'Транспорт', inSameGroup: true }],
    },
    affiliation: { groupContext: { industries: [{ okved: '49', name: 'Транспорт' }] } },
  });
  assert.equal(c.partners.outgoing.partner1.paymentShare, 0.6);
  assert.equal(c.partners.outgoing.partner1.sameGroup, true);
  assert.ok(!JSON.stringify(c).includes('PRIVATE_ID'));
  assert.match(c.datasetPosition.note, /рыночная доля не вычислена/);
});
