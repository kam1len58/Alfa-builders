'use strict';

window.AlfaApi = (() => {
  let session;
  let sessionRequest;
  async function getSession(force = false) {
    if (session && !force) return session;
    if (sessionRequest && !force) return sessionRequest;
    sessionRequest = fetch('/api/session', { cache: 'no-store' })
      .then((response) => response.json())
      .then((value) => {
        session = value;
        if (value.mode === 'public-demo') {
          document.documentElement.dataset.publicDemo = 'true';
          let notice = document.getElementById('public-demo-notice');
          if (!notice) {
            notice = document.createElement('aside');
            notice.id = 'public-demo-notice';
            notice.className = 'public-demo-notice';
            document.querySelector('#main').prepend(notice);
          }
          notice.textContent =
            'Открытая демоверсия · Все компании и финансовые показатели вымышлены. Разборы и диалог — подготовленные примеры по правилам, без вызова нейросети.';
        }
        return value;
      })
      .finally(() => {
        sessionRequest = null;
      });
    return sessionRequest;
  }
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
    const active = await getSession();
    if (!active.authenticated) {
      window.dispatchEvent(new Event('alfa-login-required'));
      throw new Error('Войдите в сервис.');
    }
    const timeout = AbortSignal.timeout(12000);
    const response = await fetch(path, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      if (response.status === 401) {
        session = null;
        window.dispatchEvent(new Event('alfa-login-required'));
      }
      throw new Error(
        response.status === 404
          ? 'Данные компании больше недоступны.'
          : 'Не удалось получить данные. Попробуйте ещё раз.'
      );
    }
    return response.json();
  }

  async function postAi(path, body, signal) {
    const active = await getSession();
    const timeout = AbortSignal.timeout(240000);
    const response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-CSRF-Token': active.csrfToken || '',
      },
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
      origin: news.origin || 'prepared',
      contentHash: news.contentHash,
      memberIds: news.memberIds || [news.id],
      publications: news.sourceRecords || [],
      sourceWarnings: news.sourceWarnings || [],
      discrepancies: news.discrepancies || [],
      contentScope: news.contentScope,
      traceId: item.traceId,
      insight: item.insight,
      rankingOrigin: item.rankingOrigin || 'backend',
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
    getSession,
    isPublicDemo() {
      return session?.mode === 'public-demo';
    },
    userId() {
      return session?.user?.id || 'anonymous';
    },
    can(permission) {
      return session?.permissions?.includes(permission) === true;
    },
    async login(username, password) {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.message);
      session = value;
      return value;
    },
    async logout() {
      await postAi('/api/logout', {});
      session = null;
      return getSession(true);
    },
    getSources(signal) {
      return getJson('/api/sources', signal);
    },
    refreshSources() {
      return postAi('/api/sources/refresh', {});
    },
    importSource(url, kind) {
      return postAi('/api/sources/import', { url, kind });
    },
    getQuality() {
      return getJson('/api/quality');
    },
    getAudit() {
      return getJson('/api/audit');
    },
    evaluate() {
      return postAi('/api/quality/evaluate', {});
    },
    review(body) {
      return postAi('/api/quality/review', body);
    },
    getFeedback(companyId, newsId) {
      return getJson('/api/feedback?' + new URLSearchParams({ companyId, newsId }));
    },
    getCompanyFeedback(companyId) {
      return getJson('/api/feedback?' + new URLSearchParams({ companyId }));
    },
    saveFeedback(body) {
      return postAi('/api/feedback', body);
    },
    getAiStatus(signal) {
      return getJson('/api/ai/status', signal);
    },
    async analyze(companyId, newsId, signal) {
      const card = await postAi(
        '/analyze',
        { company: { id: companyId }, news: { id: newsId } },
        signal
      );
      return card.analysis_payload;
    },
    ask(companyId, newsId, question, history, signal) {
      return postAi(
        '/api/chat',
        { company_id: companyId, news_id: newsId, question, history },
        signal
      );
    },
    getTrace(id) {
      return getJson('/api/trace?' + new URLSearchParams({ id }));
    },
    engage(companyId, newsId, type) {
      return postAi('/api/engagement', { companyId, newsId, type }).catch(() => {});
    },
    async getCompanies(signal) {
      const items = await getJson('/api/companies', signal);
      if (!Array.isArray(items) || items.some((item) => !item?.id)) {
        throw new Error('Сервер вернул некорректный список компаний.');
      }
      return items.map((item) => toProfile({ ...item, syntheticU: item.id }));
    },
    async getCompany(id, signal) {
      const profile = await getJson('/api/company?' + new URLSearchParams({ id }), signal);
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
      const items = await getJson('/api/feed?' + new URLSearchParams({ company_id: id }), signal);
      if (!Array.isArray(items)) throw new Error('Сервер вернул некорректную ленту.');
      return items
        .map((card, index) =>
          toEvent(
            {
              score: card.score,
              tier: card.bucket === 'focus' ? 'Focus' : 'All',
              hits: card.ranking.hits,
              traceId: card.trace_id,
              insight: card.analysis_payload,
              rankingOrigin: card.ranking.origin,
              news: {
                id: card.news_id,
                title: card.title,
                content: card.source_excerpt,
                source: card.facts.sources[0]?.url || '',
                publishedAt: card.date,
                category: card.category,
                tags: card.ranking.hits.map((h) => h.rule),
                memberIds: card.member_ids,
                sourceRecords: card.publications,
                sourceWarnings: card.source_warnings,
                discrepancies: card.discrepancies,
                contentScope: card.content_scope,
                origin: card.origin,
                contentHash: card.content_hash,
              },
            },
            id,
            index
          )
        )
        .filter((event) => event.assignments[id].placement !== 'скрыть');
    },
  };
})();
