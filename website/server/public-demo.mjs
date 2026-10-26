import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { rankDocument } from './ranking.mjs';
import { AiError } from './llm-client.mjs';
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const demoIds = ['U_900001', 'U_900002', 'U_900003', 'U_900004'];
const definitions = [
  [
    'Демонстрационная строительная компания',
    '42.99',
    'Условный регион А',
    24_000_000_000,
    { hasLoans: 1, hasLeasing: 1, hasGuarantees: 1 },
    1,
  ],
  [
    'Демонстрационная оптовая компания',
    '46.38',
    'Условный регион Б',
    31_000_000_000,
    { hasFactoring: 1, hasDeposit: 1 },
    1,
  ],
  [
    'Демонстрационная транспортная компания',
    '49.41',
    'Условный регион В',
    18_000_000_000,
    { hasLeasing: 1, hasLoans: 1 },
    0,
  ],
  [
    'Демонстрационная ИТ-компания',
    '62.01',
    'Условный регион Г',
    16_000_000_000,
    { hasDeposit: 1, hasPayroll: 1 },
    0,
  ],
];
// These records are invented independently. No private profile is renamed or transformed here.
export const demoProfiles = definitions.map(
  ([industry, okvedCode, region, revenue, products, hasVed], i) => ({
    syntheticU: demoIds[i],
    industry,
    okvedCode,
    region,
    revenue,
    city: 'Демонстрационный город',
    workers: '101–250',
    clientType: 'Вымышленный пример',
    bankProducts: {
      hasRko: 1,
      hasLoans: 0,
      hasLeasing: 0,
      hasGuarantees: 0,
      hasFactoring: 0,
      hasDeposit: 0,
      hasPayroll: 0,
      ...products,
    },
    ved: { hasVed, country: hasVed ? 'Условная страна' : '' },
    counterparties: {
      suppliersCount: 12 + i * 3,
      customersCount: 18 + i * 4,
      topSupplierShare: 0.24,
      topCustomerShare: 0.18,
      topSuppliers: [
        {
          id: demoIds[(i + 1) % 4],
          okvedCode: definitions[(i + 1) % 4][1],
          okvedName: definitions[(i + 1) % 4][0],
          region: 'Условный регион',
          share: 0.24,
          inSameGroup: false,
        },
      ],
      topCustomers: [
        {
          id: demoIds[(i + 2) % 4],
          okvedCode: definitions[(i + 2) % 4][1],
          okvedName: definitions[(i + 2) % 4][0],
          region: 'Условный регион',
          share: 0.18,
          inSameGroup: false,
        },
      ],
      note: 'Все показатели вымышлены. Направления платежей не подтверждают закупки или продажи.',
    },
    affiliation: {
      groupId: 'DEMO_GROUP_' + i,
      groupSize: 1,
      groupCompanies: [],
      linkedPersonsCount: 0,
      affiliatedCount: 0,
      affiliatedViaPersons: [],
      intraGroupCounterparties: [],
    },
    industryPosition: {
      rankByRevenueInOkved: 1,
      companiesInOkved: 1,
      shareOfOkvedRevenueInDataset: 1,
      note: 'Условная демонстрационная выборка, не доля рынка.',
    },
    demoScenario: 'Полностью вымышленные данные для открытой демонстрации',
    profileOrigin: 'public-demo',
  })
);
const prepared = JSON.parse(
  readFileSync(new URL('../config/prepared-news.json', import.meta.url), 'utf8')
);
const news = Object.entries(prepared).map(([id, n]) => ({
  id,
  title: n.title,
  content: n.content,
  source: n.source,
  publishedAt: n.publishedAt,
  category: 'Публичная новость',
}));
export async function startDemoBackend() {
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end();
      return;
    }
    const path = new URL(req.url, 'http://localhost').pathname;
    let value;
    if (path === '/api/Companies') value = demoProfiles;
    if (path === '/api/News') value = news;
    const company = /^\/api\/Companies\/([^/]+)(\/feed)?$/.exec(path);
    if (company) {
      const p = demoProfiles.find((p) => p.syntheticU === decodeURIComponent(company[1]));
      if (p)
        value = company[2]
          ? news
              .map((n) =>
                rankDocument(p, {
                  id: n.id,
                  title: n.title,
                  text: n.content,
                  url: n.source,
                  publishedAt: n.publishedAt,
                  publisher: n.category,
                })
              )
              .filter((r) => r.tier !== 'Hidden')
          : p;
    }
    const item = /^\/api\/News\/([^/]+)$/.exec(path);
    if (item) value = news.find((n) => n.id === item[1]);
    res.writeHead(value === undefined ? 404 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(value ?? {}));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: 'http://127.0.0.1:' + server.address().port, close: () => server.close() };
}
export function demoCatalogue() {
  return { rows: demoProfiles, byId: new Map(demoProfiles.map((p) => [p.syntheticU, p])) };
}
export function createDemoInsights({ data }) {
  const traces = new Map();
  function build({ company, item }) {
    const n = item.news,
      newsId = 'news:' + n.id,
      companyId = 'company:' + company.syntheticU;
    const quote = n.content.slice(0, 220),
      newsEvidence = { sourceId: newsId, quote };
    const companyEvidence = { sourceId: companyId, feature: 'industry', quote: company.industry };
    const based = (text, extra = {}) => ({
      text,
      sourceIds: [newsId, companyId],
      evidence: [newsEvidence, companyEvidence],
      ...extra,
    });
    const id = hash(['public-demo-1', company.syntheticU, n.contentHash, item.score]);
    const result = {
      id,
      version: 'public-demo-1',
      demo: true,
      companyId: company.syntheticU,
      newsId: n.id,
      model: 'Демонстрационный разбор по правилам',
      generatedAt: '2026-10-26T00:00:00Z',
      cached: true,
      analysis: {
        summary: { text: n.content, sourceIds: [newsId], evidence: [newsEvidence] },
        whyImportant: based(
          item.hits.map((h) => h.explanation).join(' ') +
            ' Профиль компании и её показатели в этом примере полностью вымышлены.'
        ),
        risks: [
          based(
            'Возможное влияние на расходы и условия расчётов нужно проверить по собственным показателям.',
            {
              condition:
                'Если событие затрагивает реальные договоры, закупки или направления деятельности.',
            }
          ),
        ],
        opportunities: [],
        actions: [
          based('Сопоставить публикацию с условиями действующих договоров и бюджетом.', {
            rationale:
              'Новость и балл релевантности сами по себе не подтверждают финансовый эффект.',
          }),
          based('Проверить актуальную публикацию по ссылке и недостающие сведения о компании.', {
            rationale: 'Публичный пример не содержит реальных обязательств или сделок.',
          }),
        ],
        missingData: ['Условия реальных договоров', 'Фактическая структура затрат и платежей'],
      },
      bankView: {
        status: 'unavailable',
        text: 'Демонстрационный пример не является позицией Альфа-Банка.',
        sourceIds: [],
      },
      sources: [
        { id: newsId, kind: 'news', title: n.title, url: n.source, date: n.publishedAt },
        { id: companyId, kind: 'company', title: 'Вымышленный демонстрационный профиль' },
      ],
      workflow: [
        { stage: 'demo', status: 'prepared' },
        { stage: 'tool', tool: 'ranking', status: 'completed' },
      ],
      plan: [],
      quality: {
        status: 'demo',
        valid: true,
        repaired: false,
        claims: 5,
        citedClaims: 5,
        bankUsed: false,
        independentFactCheck: false,
      },
      durationMs: 0,
    };
    traces.set(id, result);
    return result;
  }
  const analysisFor = async (company, news) => build(await data.context(company, news));
  return {
    analysisFor,
    cachedForContext: async (ctx) => build(ctx),
    savedTrace: async (id) => traces.get(id) || null,
    status: () => ({
      configured: true,
      model: 'Демонстрационные примеры по правилам',
      mode: 'public-demo',
    }),
    async chat({ companyId, newsId, question, history = [] }) {
      if (
        typeof question !== 'string' ||
        !question.trim() ||
        question.length > 1500 ||
        !Array.isArray(history) ||
        history.length > 6
      )
        throw new AiError('INVALID_INPUT', 'Укажите вопрос до 1500 символов.', 400);
      const insight = await analysisFor(companyId, newsId);
      const answer = /данн|не хватает|уточн/i.test(question)
        ? insight.analysis.missingData.join('; ')
        : /действ|провер|сделать/i.test(question)
          ? insight.analysis.actions.map((a) => a.text).join(' ')
          : insight.analysis.whyImportant.text;
      return {
        text: 'Демонстрационный ответ по правилам, без вызова нейросети. ' + answer,
        sourceIds: insight.analysis.whyImportant.sourceIds,
        missingData: insight.analysis.missingData,
        model: insight.model,
        generatedAt: new Date().toISOString(),
        analysisId: insight.id,
        insight,
        sources: insight.sources,
      };
    },
  };
}
