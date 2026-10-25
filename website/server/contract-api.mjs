import { AiError } from './llm-client.mjs';
import { rankingTraceId, toCard, traceView } from './contract.mjs';

export function createContractApi({
  data,
  insights,
  quality,
  access,
  send,
  readJson,
  validatePair,
}) {
  return async function contractApi(url, request, response, session) {
    const path = url.pathname;
    if (path === '/api/companies' && request.method === 'GET') {
      const rows = (await data.companies()).filter(
        (p) => session.user.companies.includes('*') || session.user.companies.includes(p.syntheticU)
      );
      send(
        response,
        200,
        rows.map((p) => ({
          id: p.syntheticU,
          industry: p.industry,
          revenue: p.revenue,
          region: p.region,
          scenario: p.scenario || null,
        }))
      );
      return true;
    }
    if (path === '/api/company' && request.method === 'GET') {
      const id = url.searchParams.get('id');
      access.company(session, id);
      send(response, 200, await data.company(id));
      return true;
    }
    if (path === '/api/feed' && request.method === 'GET') {
      const id = url.searchParams.get('company_id');
      access.company(session, id);
      const start = Date.now();
      const company = await data.company(id),
        rows = await data.feed(id),
        cards = [];
      for (const item of rows)
        cards.push(toCard(company, item, await insights.cachedForContext({ company, item })));
      await quality.recordFeed(session.user, company, rows, Date.now() - start);
      send(response, 200, cards);
      return true;
    }
    if (path === '/api/trace' && request.method === 'GET') {
      const id = url.searchParams.get('id') || '';
      if (id.length > 300) throw new AiError('INVALID_INPUT', 'Некорректный идентификатор.', 400);
      if (id.startsWith('rank:')) {
        const [, companyId, newsId] = id.split(':');
        access.company(session, companyId);
        const ctx = await data.context(companyId, newsId);
        if (id !== rankingTraceId(companyId, ctx.item))
          throw new AiError('TRACE_STALE', 'Лента обновилась. Откройте карточку заново.', 404);
        send(response, 200, {
          trace_id: id,
          company_id: companyId,
          news_id: ctx.item.news.id,
          status: 'ranking_only',
          steps: [
            { tool: 'company_profile', status: 'completed' },
            { tool: 'event_grouping', status: 'completed', members: ctx.item.news.memberIds },
            { tool: 'ranking', status: 'completed', score: ctx.item.score, hits: ctx.item.hits },
          ],
          sources: ctx.item.news.sourceRecords,
          discrepancies: ctx.item.news.discrepancies,
          note: 'Модель для этой карточки ещё не запускалась.',
        });
        return true;
      }
      const hit = await insights.savedTrace(id);
      if (!hit) throw new AiError('TRACE_MISSING', 'Разбор не найден.', 404);
      access.company(session, hit.companyId);
      send(response, 200, traceView(hit));
      return true;
    }
    if (['/api/chat', '/analyze', '/chat'].includes(path)) {
      if (request.method !== 'POST')
        throw new AiError('METHOD_NOT_ALLOWED', 'Ожидается POST.', 405);
      access.requirePermission(session, 'analyze');
      access.limit(session, 'ai', 10);
      const input = await readJson(request);
      const pair = {
        companyId:
          input.company_id ||
          input.company?.syntheticU ||
          input.company?.synthetic_u ||
          input.company?.id,
        newsId: input.news_id || input.news?.id,
      };
      validatePair(pair);
      access.company(session, pair.companyId);
      const ctx = await data.context(pair.companyId, pair.newsId);
      // Resolve registered data; a caller cannot replace the profile or insert unchecked news.
      if (
        input.news?.text &&
        ![ctx.item.news.content, ctx.item.news.inputContent].includes(input.news.text)
      )
        throw new AiError(
          'CONTEXT_MISMATCH',
          'Текст отличается от зарегистрированной новости. Сначала импортируйте источник.',
          409
        );
      if (path === '/analyze') {
        const insight = await insights.analysisFor(pair.companyId, pair.newsId);
        send(response, 200, toCard(ctx.company, ctx.item, insight));
      } else {
        const reply = await insights.chat({
          ...pair,
          question: input.question,
          history: input.history || [],
        });
        await quality.engagement(session.user, { ...pair, type: 'chat_answer' });
        send(response, 200, { ...reply, answer: reply.text, trace_id: reply.analysisId });
      }
      return true;
    }
    if (path === '/api/engagement' && request.method === 'POST') {
      access.limit(session, 'engagement', 120);
      const input = await readJson(request);
      validatePair(input);
      access.company(session, input.companyId);
      await data.context(input.companyId, input.newsId);
      await quality.engagement(session.user, input);
      send(response, 200, { ok: true });
      return true;
    }
    return false;
  };
}
