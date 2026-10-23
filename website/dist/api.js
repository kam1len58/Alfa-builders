'use strict';

window.AlfaApi = (() => {
  const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  const categories = {
    INFL_COSTS: { name: 'Экономика', image: 'finance.jpg' },
    PMI_ORDERS: { name: 'Производство', image: 'industry.jpg' },
    SANCTIONS: { name: 'Внешняя торговля', image: 'logistics.jpg' },
    CUSTOMS: { name: 'Внешняя торговля', image: 'logistics.jpg' },
    SUPPLIER_CONCENTRATION: { name: 'Контрагенты', image: 'logistics.jpg' },
    FUEL: { name: 'Топливо', image: 'industry.jpg' },
    GOV_PROCUREMENT: { name: 'Бюджет', image: 'finance.jpg' },
    OIL: { name: 'Нефть и газ', image: 'finance.jpg' },
  };

  async function getJson(path, signal) {
    const timeout = AbortSignal.timeout(12000);
    const response = await fetch(path, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(
        response.status === 404
          ? 'Данные компании больше недоступны.'
          : 'Не удалось получить данные. Попробуйте ещё раз.'
      );
    }
    return response.json();
  }

  async function postAi(path, body, signal) {
    const timeout = AbortSignal.timeout(240000);
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error('Не удалось прочитать ответ сервиса анализа.');
    }
    if (!response.ok) {
      const error = new Error(result.message || 'Не удалось подготовить ответ модели.');
      error.code = result.code;
      throw error;
    }
    return result;
  }

  // API использует camelCase, существующий экран профиля — snake_case.
  function toProfile(value) {
    if (Array.isArray(value)) return value.map(toProfile);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key.replace(/[A-Z]/g, (letter) => '_' + letter.toLowerCase()),
        toProfile(item),
      ])
    );
  }

  function toEvent(item, companyId, order) {
    const { news, score, tier, hits } = item;
    if (
      !news ||
      typeof news.id !== 'string' ||
      !news.id ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > 1 ||
      !['Focus', 'All', 'Hidden'].includes(tier) ||
      !Array.isArray(hits)
    ) {
      throw new Error('Сервер вернул неполные данные ленты.');
    }
    const category = (news.tags || []).map((tag) => categories[tag]).find(Boolean) || {
      name: 'События бизнеса',
      image: 'finance.jpg',
    };
    const timestamp = Date.parse(news.publishedAt);
    const hasDate = Number.isFinite(timestamp);
    const source = typeof news.source === 'string' ? news.source : '';
    const products = hits.flatMap((hit) => hit.bankProducts || []);
    let sourceUrl = null;
    try {
      const url = new URL(source);
      if (['https:', 'http:'].includes(url.protocol)) sourceUrl = url.href;
    } catch {
      /* Источник может быть названием подборки, а не ссылкой. */
    }

    return {
      id: news.id,
      title: news.title || news.content?.slice(0, 120) || 'Событие без заголовка',
      rawText: news.content || '',
      category: news.category && news.category !== 'golden' ? news.category : category.name,
      image: category.image,
      source: source === 'golden' ? 'Подготовленная подборка' : source || 'Источник не указан',
      sourceUrl,
      date: hasDate ? dateFormatter.format(new Date(timestamp)) : 'Дата не указана',
      isoDate: hasDate ? new Date(timestamp).toISOString().slice(0, 10) : '',
      timestamp: hasDate ? timestamp : 0,
      order,
      assignments: {
        [companyId]: {
          score,
          placement: { Focus: 'В фокусе', All: 'Все события', Hidden: 'скрыть' }[tier],
          rules: hits.map((hit) => hit.rule),
          explanation:
            hits
              .map((hit) => hit.explanation)
              .filter(Boolean)
              .join('\n') || 'Сервис не передал объяснение.',
          suggestedProducts: [...new Set(products)].join(', '),
          products: [...new Set(products)],
        },
      },
    };
  }

  return {
    getAiStatus(signal) {
      return getJson('/api/ai/status', signal);
    },
    analyze(companyId, newsId, signal) {
      return postAi('/api/ai/analysis', { companyId, newsId }, signal);
    },
    ask(companyId, newsId, question, history, signal) {
      return postAi('/api/ai/chat', { companyId, newsId, question, history }, signal);
    },
    async getCompanies(signal) {
      const items = await getJson('/api/Companies', signal);
      if (!Array.isArray(items) || items.some((item) => !item?.syntheticU)) {
        throw new Error('Сервер вернул некорректный список компаний.');
      }
      return items.map(toProfile);
    },
    async getCompany(id, signal) {
      const profile = await getJson('/api/Companies/' + encodeURIComponent(id), signal);
      if (
        profile?.syntheticU !== id ||
        !profile.bankProducts ||
        !profile.counterparties ||
        !profile.affiliation ||
        !profile.ved ||
        !profile.industryPosition
      ) {
        throw new Error('Сервер вернул неполный профиль компании.');
      }
      return toProfile(profile);
    },
    async getFeed(id, signal) {
      const items = await getJson('/api/Companies/' + encodeURIComponent(id) + '/feed', signal);
      if (!Array.isArray(items)) throw new Error('Сервер вернул некорректную ленту.');
      return items
        .map((item, index) => toEvent(item, id, index))
        .filter((event) => event.assignments[id].placement !== 'скрыть');
    },
  };
})();
