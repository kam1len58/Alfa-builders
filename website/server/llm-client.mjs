export class AiError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function parseModelJson(content) {
  if (typeof content !== 'string' || content.length > 60000) {
    throw new AiError(
      'INVALID_MODEL_RESPONSE',
      'Модель вернула ответ неподходящего формата. Повторите запрос.'
    );
  }
  const text = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError(
      'INVALID_MODEL_RESPONSE',
      'Не удалось прочитать структурированный ответ модели. Повторите запрос.'
    );
  }
}

export function createLlmClient({
  apiKey = process.env.LLM_API_KEY,
  baseUrl = process.env.LLM_BASE_URL || 'https://changellenge.up.railway.app/v1',
  model = process.env.LLM_MODEL || 'deepseek/deepseek-v4.1-flash',
  fetcher = fetch,
  meter = null,
} = {}) {
  const endpoint = new URL(baseUrl.replace(/\/$/, '') + '/chat/completions');
  if (endpoint.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(endpoint.hostname)) {
    throw new Error('LLM_BASE_URL must use HTTPS.');
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('LLM_BASE_URL must not contain credentials or query parameters.');
  }
  let active = 0;
  const recent = [];
  const configured = Boolean(apiKey?.trim());

  async function complete(system, data, { maxTokens = 3600, signal } = {}) {
    if (!configured)
      throw new AiError(
        'AI_NOT_CONFIGURED',
        'Подключение к модели ещё не настроено на сервере.',
        503
      );
    const now = Date.now();
    while (recent.length && recent[0] < now - 60000) recent.shift();
    if (active >= 2 || recent.length >= 16) {
      throw new AiError(
        'AI_BUSY',
        'Сервис анализирует другие запросы. Повторите через минуту.',
        429
      );
    }
    ++active;
    recent.push(now);
    const start = Date.now();
    let reservation,
      metered = false;
    try {
      reservation = meter?.reserve(
        model,
        Buffer.byteLength(system) + Buffer.byteLength(JSON.stringify(data)),
        maxTokens
      );
      const timeout = AbortSignal.timeout(90000);
      const response = await fetcher(endpoint, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          Authorization: 'Bearer ' + apiKey.trim(),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: JSON.stringify(data) },
          ],
          max_tokens: maxTokens,
          temperature: 0.2,
          reasoning_effort: 'none',
          ...(model.startsWith('deepseek/') ? { thinking: { type: 'disabled' } } : {}),
        }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      // Тело ошибки провайдера не попадает в браузер или журналы.
      const raw = await response.text();
      if (raw.length > 1000000)
        throw new AiError('INVALID_MODEL_RESPONSE', 'Ответ модели слишком большой.');
      if (!response.ok) {
        if (/budget.{0,30}exceed|insufficient.{0,20}(credit|balance)/i.test(raw)) {
          throw new AiError(
            'AI_BUDGET_EXCEEDED',
            'Дневной бюджет команды исчерпан. По инструкции организаторов лимит обновляется в 03:00 МСК.',
            429
          );
        }
        if ([401, 403].includes(response.status))
          throw new AiError(
            'AI_ACCESS_DENIED',
            'Сервис моделей отклонил доступ. Проверьте серверную настройку ключа.',
            503
          );
        if (response.status === 429)
          throw new AiError(
            'AI_RATE_LIMIT',
            'Сервис моделей ограничил частоту запросов. Попробуйте через минуту.',
            429
          );
        if (response.status === 404)
          throw new AiError(
            'AI_MODEL_UNAVAILABLE',
            'Выбранная модель временно недоступна у провайдера.',
            503
          );
        throw new AiError(
          'AI_PROVIDER_ERROR',
          'Сервис моделей временно недоступен. Повторите запрос позже.',
          502
        );
      }
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new AiError('INVALID_MODEL_RESPONSE', 'Сервис моделей вернул некорректный ответ.');
      }
      const choice = payload.choices?.[0];
      await meter?.record({
        model,
        usage: payload.usage,
        durationMs: Date.now() - start,
        status: choice?.finish_reason || 'response',
      });
      metered = true;
      if (choice?.finish_reason === 'length')
        throw new AiError(
          'AI_TRUNCATED',
          'Модель не завершила разбор в пределах лимита ответа. Повторите запрос.'
        );
      const result = parseModelJson(choice?.message?.content);
      return {
        result,
        usage: {
          inputTokens: payload.usage?.prompt_tokens || 0,
          outputTokens: payload.usage?.completion_tokens || 0,
        },
        durationMs: Date.now() - start,
      };
    } catch (error) {
      if (meter && reservation && !metered)
        await meter.record({
          model,
          usage: null,
          durationMs: Date.now() - start,
          status: error.code || 'connection_error',
        });
      if (error instanceof AiError) throw error;
      if (error.name === 'TimeoutError' || error.name === 'AbortError')
        throw new AiError(
          'AI_TIMEOUT',
          'Не удалось дождаться ответа модели. Попробуйте ещё раз.',
          504
        );
      throw new AiError(
        'AI_CONNECTION_ERROR',
        'Не удалось связаться с сервисом моделей. Попробуйте позже.',
        503
      );
    } finally {
      meter?.release(reservation);
      --active;
    }
  }
  return { complete, model, configured };
}
