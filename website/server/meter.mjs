import { AiError } from './llm-client.mjs';

// Prices are explicit RUB per million tokens; an absent price is unknown, never zero.
export function createMeter({ store, prices = {}, budget = 500, now = () => new Date() }) {
  if (
    !Number.isFinite(budget) ||
    budget <= 0 ||
    !prices ||
    typeof prices !== 'object' ||
    Array.isArray(prices)
  )
    throw new Error('Invalid local model budget configuration');
  const reservations = new Map();
  const day = () => now().toISOString().slice(0, 10); // 00:00 UTC = 03:00 Moscow
  function price(model) {
    const p = prices[model];
    return p && [p.input, p.output].every((v) => Number.isFinite(v) && v >= 0) ? p : null;
  }
  function overview() {
    const rows = (store.snapshot().usage || []).filter((r) => r.day === day());
    const unknown = rows.filter((r) => r.costRub === null).length;
    const knownCostRub = rows.reduce((sum, r) => sum + (r.costRub || 0), 0);
    return {
      day: day(),
      resetAt: new Date(Date.parse(day() + 'T00:00:00Z') + 86400000).toISOString(),
      resetMoscow: '03:00',
      calls: rows.length,
      trackedSince: rows[0]?.at || null,
      inputTokens: rows.reduce((s, r) => s + (r.inputTokens || 0), 0),
      outputTokens: rows.reduce((s, r) => s + (r.outputTokens || 0), 0),
      unknownCostCalls: unknown,
      knownCostRub,
      costRub: unknown ? null : knownCostRub,
      dailyBudgetRub: budget,
      remainingRub: unknown ? null : Math.max(0, budget - knownCostRub),
      budgetScope:
        'Только вызовы после включения учёта в этом сервисе; другие участники команды могут расходовать общий лимит.',
      pricing: Object.keys(prices).length ? 'configured' : 'unknown',
      note: 'Токены учитываются по ответам провайдера, включая отклонённые и обрезанные ответы. Нет usage/тарифа — стоимость неизвестна. Тайм-аут может быть оплачен провайдером.',
    };
  }
  function reserve(model, inputBytes, outputTokens) {
    const p = price(model),
      token = Symbol(model);
    const estimate = p ? (inputBytes * p.input + outputTokens * p.output) / 1e6 : 0;
    const pending = [...reservations.values()]
      .filter((r) => r.day === day())
      .reduce((s, r) => s + r.cost, 0);
    if (overview().knownCostRub + pending + estimate > budget)
      throw new AiError(
        'AI_BUDGET_EXCEEDED',
        'Локальный лимит бюджета исчерпан. Обновление — в 03:00 МСК.',
        429
      );
    reservations.set(token, { day: day(), cost: estimate });
    return token;
  }
  async function record({ model, usage, durationMs, status }) {
    const numeric = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
    const inputTokens = numeric(usage?.prompt_tokens),
      outputTokens = numeric(usage?.completion_tokens),
      p = price(model);
    const costRub =
      p && inputTokens !== null && outputTokens !== null
        ? (inputTokens * p.input + outputTokens * p.output) / 1e6
        : null;
    await store.update((state) => {
      state.usage = [
        ...(state.usage || []),
        {
          at: now().toISOString(),
          day: day(),
          model,
          inputTokens,
          outputTokens,
          costRub,
          durationMs,
          status,
        },
      ].slice(-10000);
    });
  }
  return { reserve, record, release: (token) => reservations.delete(token), overview };
}
