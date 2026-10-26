'use strict';

window.NewsReader = (() => {
  let context = null;
  let chatRequest;
  let chatVersion = 0;
  const questionHistory = new Map();
  const feedback = {};
  const key = () => JSON.stringify([AlfaApi.userId(), context.company.id, context.event.id]);
  const feedbackKey = () => `${context.company.id}:${context.event.id}`;

  function sourcePanel(event, company) {
    return `<div class="source-card"><div class="source-card-title">01 / Новость</div>
      <p>${escapeHtml(event.source)} · ${escapeHtml(event.id)} · ${escapeHtml(event.date)}</p>
      ${event.sourceUrl ? `<a class="inline-link" href="${escapeHtml(event.sourceUrl)}" target="_blank" rel="noopener noreferrer">Открыть публикацию ${icon('arrow-up-right')}</a>` : '<p class="data-gap">Ссылка на первоисточник не передана.</p>'}
      <span class="analysis-caption">${escapeHtml(scopeLabel(event))} Изображение в карточке иллюстративное.</span>${publications(event)}</div>
      <div class="source-card"><div class="source-card-title">02 / Профиль компании</div>
      <p>${escapeHtml(company.id)} · ${escapeHtml(company.profile.industry)} · ОКВЭД ${escapeHtml(company.profile.okved_code)}</p>
      <button class="inline-link" data-reader-tab="impact">Посмотреть признаки отбора ${icon('arrow-right')}</button></div>
      <div class="source-card"><div class="source-card-title">03 / Оценка и интерпретация</div>
      <p>Оценка рассчитана серверными правилами по профилю компании. Перепечатки одного события объединены без сложения баллов.</p>
      <button class="inline-link" data-reader-trace>Посмотреть этапы проверки ${icon('arrow-right')}</button>
      <span class="analysis-caption">Выводы модели и этапы их проверки отображаются ниже после подготовки разбора. Банковская позиция используется только с подтверждённым источником.</span></div>
      <p class="source-note">Релевантность не означает вероятность риска. Сведения из публикации и объяснения сервиса не прошли независимую проверку.</p>`;
  }
  function scopeLabel(event) {
    return event.contentScope === 'reviewed_summary'
      ? 'Краткое изложение, сверенное с публикациями; не дословный текст издателя.'
      : event.contentScope === 'rss_excerpt'
        ? 'Только анонс RSS. Полный текст статьи не загружен.'
        : 'Текст публикации, извлечённый сервисом.';
  }
  function publications(event) {
    return (event.publications || [])
      .map(
        (p) => `<details class="publication-details"><summary>${escapeHtml(p.title)}</summary>
      <p class="analysis-caption">${escapeHtml(p.date || 'Дата не указана')} · ${escapeHtml(p.scope === 'reviewed_summary' ? 'Сверенное изложение' : p.scope === 'rss_excerpt' ? 'Анонс RSS' : 'Текст источника')}</p>
      ${p.url ? `<a class="inline-link" data-source-open href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer">Открыть публикацию ${icon('arrow-up-right')}</a>` : ''}
      ${(p.links || [])
        .filter((s) => s.url !== p.url)
        .map(
          (s) =>
            `<p><a class="inline-link" data-source-open href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title)}</a>${s.liveHttps === false ? '<span class="analysis-caption"> · Прямая загрузка недоступна</span>' : ''}</p>`
        )
        .join('')}
      ${p.originalExcerpt ? `<blockquote>${escapeHtml(p.originalExcerpt.quote)}</blockquote><p class="analysis-caption">Оригинальная цитата · ${escapeHtml(p.originalExcerpt.publisher)}<br>${escapeHtml(p.originalExcerpt.confirms)}</p><a class="inline-link" data-source-open href="${escapeHtml(p.originalExcerpt.url)}" target="_blank" rel="noopener noreferrer">Источник цитаты</a>` : ''}</details>`
      )
      .join('');
  }

  function open(event, company) {
    ++chatVersion;
    chatRequest?.abort();
    context = { event, company, messages: [], busy: false };
    const localFeedback = loadPreference('feedback-v2:' + AlfaApi.userId(), {});
    Object.keys(feedback).forEach((k) => delete feedback[k]);
    if (localFeedback && typeof localFeedback === 'object' && !Array.isArray(localFeedback))
      Object.assign(feedback, localFeedback);
    const a = event.assignments[company.id];
    const tabs = [
      ['event', 'Событие'],
      ['impact', 'Влияние'],
      ['actions', 'Рекомендации'],
      ['sources', 'Источники'],
    ];
    $('#detail-body').innerHTML = `<img class="detail-photo" src="./assets/${event.image}" alt="" />
      <div class="detail-content">
      <div class="detail-meta"><span>${escapeHtml(event.id)} · ${escapeHtml(event.category)}</span><time datetime="${event.isoDate}">${escapeHtml(event.date)}</time><span class="detail-rank">Балл ${formatScore(a.score)}</span></div>
      <h2 id="detail-title">${escapeHtml(event.title)}</h2>
      <div class="reader-company">${escapeHtml(company.name)} <span>${escapeHtml(company.id)}</span></div>
      <section class="ai-entry" aria-label="Персональный разбор"><div class="ai-entry-heading"><span>Разбор для вашей компании</span><button class="secondary-button" id="ai-run">Подготовить разбор</button></div><span class="ai-model" id="ai-model">Модель организаторов</span><p id="ai-state" role="status">Риски, возможности и действия с проверкой оснований. Запускается по вашему запросу.</p></section>
      <div class="detail-tabbar" role="tablist" aria-label="Содержание разбора">${tabs.map(([id, name], i) => `<button class="detail-tab ${i === 0 ? 'active' : ''}" id="tab-${id}" data-detail-tab="${id}" role="tab" aria-selected="${i === 0}" aria-controls="panel-${id}" tabindex="${i === 0 ? 0 : -1}">${name}</button>`).join('')}</div>
      <div id="panel-event" role="tabpanel" aria-labelledby="tab-event" tabindex="0">
        <section class="analysis-block"><div class="content-origin">${escapeHtml(scopeLabel(event))}</div><h3>Что произошло</h3><p>${formatLines(event.rawText)}</p><span class="analysis-caption">${escapeHtml(event.date)} · Публикаций: ${event.publications.length || 1}</span>
        ${[...(event.sourceWarnings || []), ...(event.discrepancies || []).map((d) => d.text)].map((w) => `<p class="source-caveat">${escapeHtml(w)}</p>`).join('')}</section>
        <section class="reader-summary"><div><span>Приоритет</span><strong>${escapeHtml(a.placement)}</strong></div><div><span>Релевантность</span><strong>${formatScore(a.score)} <small>из 1</small></strong></div></section>
        <section class="analysis-block"><div class="content-origin">Объяснение сервиса</div><h3>Почему важно для компании</h3><p>${formatLines(a.explanation)}</p><button class="inline-link reader-next" data-reader-tab="impact">Посмотреть основания ${icon('arrow-right')}</button></section>
        <section class="analysis-block ai-summary" id="ai-summary" hidden></section><div class="reader-actions"><button class="secondary-button" data-reader-compare>${icon('compare')} Сравнить компании</button><button class="secondary-button" data-reader-export>${icon('download')} Экспорт события</button></div>
      </div>
      <div id="panel-impact" role="tabpanel" aria-labelledby="tab-impact" tabindex="0" hidden>
        <div id="ai-impact"><section class="missing-analysis"><span class="content-origin">Риски и возможности</span><h3>Подготовьте персональный разбор</h3><p>Модель сопоставит событие с профилем компании, укажет возможные последствия, условия и недостающие данные.</p></section></div>
<details class="ranking-details"><summary>Правила отбора и признаки профиля</summary>
        <section class="analysis-block"><div class="content-origin">Персонализация сервиса</div><h3>Основания отбора</h3><p>${formatLines(a.explanation)}</p><p class="analysis-caption">${escapeHtml(company.profile.affiliation.group_context?.note || 'Группа указана по идентификатору из данных.')} Положение в выборке ОКВЭД не означает долю реального рынка.</p></section>
        <div class="evidence-list">${
          NewsTools.evidence(company.profile, a.rules)
            .map(
              (item) =>
                `<section class="evidence-item"><span class="rule-code">${escapeHtml(item.rule)}</span><h3>${escapeHtml(item.label)}</h3><p>${escapeHtml(item.value)}</p></section>`
            )
            .join('') || '<p class="data-gap">Сработавшие правила не переданы.</p>'
        }</div>
</details>
        <section class="analysis-block bank-material-status" id="ai-bank"><h3>Позиция Альфа-Банка</h3><p>Будет использована только при наличии связанного материала банка с источником и датой. Вывод модели показан отдельно.</p></section>
      </div>
      <div id="panel-actions" role="tabpanel" aria-labelledby="tab-actions" tabindex="0" hidden>
        <div id="ai-actions"><section class="missing-analysis"><span class="content-origin">Действия компании</span><h3>Подготовьте персональный разбор</h3><p>Здесь появятся предложенные моделью действия с основаниями и условиями применения.</p></section></div>
        <section class="analysis-block"><div class="content-origin">Предложения сервиса</div><h3>Продукты для обсуждения</h3>${a.products.length ? `<ul class="product-list">${a.products.map((product) => `<li>${escapeHtml(product)}</li>`).join('')}</ul>` : '<p>Для этой новости продукты не предложены.</p>'}<span class="analysis-caption">Предложены по правилам отбора. Это не сведения о подключённых продуктах и не подтверждённый план действий.</span></section>
        <section class="next-action"><h3>Продуктовые признаки профиля</h3><p>${company.products.length ? escapeHtml(company.products.join(' · ')) : 'В профиле нет положительных продуктовых признаков.'}</p><span class="analysis-caption">Наличие продукта не раскрывает его условия и размер обязательств.</span></section>
      </div>
      <div id="panel-sources" role="tabpanel" aria-labelledby="tab-sources" tabindex="0" hidden>${sourcePanel(event, company)}<div id="ai-sources"></div></div>
      <details class="reader-chat" id="reader-chat"><summary>${icon('message')}<span>Уточнить по событию<small>Диалог с аналитической моделью</small></span>${icon('chevron')}</summary>
        <div class="chat-content"><p class="chat-disclosure">Ответ учитывает событие, профиль компании, материалы банка и контекст разговора. Сервис может уточнить сведения в собранном корпусе официальных публикаций. Первый вопрос запускает проверку разбора.</p>
        <div class="chat-chips"><button data-chat-prompt="Почему эта новость показана компании?">Почему показано?</button><button data-chat-prompt="Что означает балл?">Как читать балл?</button><button data-chat-prompt="Каких данных не хватает?">Чего не хватает?</button></div>
        <div class="chat-log" id="chat-log" role="log" aria-label="Диалог по событию" aria-live="polite" aria-relevant="additions"></div>
        <form id="chat-form"><label class="sr-only" for="chat-input">Вопрос по событию</label><div class="chat-composer"><textarea id="chat-input" rows="2" maxlength="500" placeholder="Вопрос по этой новости…" required></textarea><button class="icon-button" type="submit" aria-label="Отправить вопрос">${icon('arrow-right')}</button></div><div class="chat-foot"><span>История хранится в этом браузере</span><button type="button" id="clear-chat">Очистить диалог</button></div></form></div>
      </details>
      <section class="feedback-panel" aria-labelledby="feedback-title"><div class="feedback-heading"><h3 id="feedback-title">Подходит вашей компании?</h3><span>Обратная связь</span></div>
      <div class="feedback-options" role="group" aria-label="Оценка новости">${Object.entries(
        NewsTools.feedbackLabels
      )
        .map(
          ([rating, label]) =>
            `<button data-feedback="${rating}" aria-pressed="false">${icon(rating === 'useful' ? 'check' : rating === 'error' ? 'flag' : 'minus')}${label}</button>`
        )
        .join('')}</div>
      <form id="feedback-form" hidden><label for="feedback-comment">Что стоит уточнить? <span>Необязательно</span></label><textarea id="feedback-comment" maxlength="1000" rows="3" placeholder="Например, новость не относится к нашей деятельности"></textarea><div class="feedback-footer"><button class="secondary-button" type="submit">Сохранить комментарий</button><button class="inline-link" type="button" id="remove-feedback">Убрать оценку</button></div></form>
      <p id="feedback-status" class="analysis-caption" role="status">Оценка сохраняется в этом браузере и пока не отправляется на сервер.</p></section></div>`;
    if (!questionHistory.has(key())) {
      const legacy =
        AlfaApi.userId() === 'local-owner'
          ? loadPreference('chat-v2:' + JSON.stringify([company.id, event.id]), [])
          : [];
      const saved = loadPreference('chat-v3:' + key(), legacy);
      questionHistory.set(key(), Array.isArray(saved) ? saved : []);
    }
    context.messages = questionHistory
      .get(key())
      .filter((m) => m && typeof m.question === 'string' && typeof m.text === 'string')
      .slice(-10)
      .map((m) => ({
        question: m.question.slice(0, 500),
        text: m.text.slice(0, 6000),
        model: typeof m.model === 'string' ? m.model : '',
        generatedAt: m.generatedAt,
        refs: Array.isArray(m.refs)
          ? m.refs.filter(
              (ref) =>
                ['sources', 'impact', 'event', 'actions'].includes(ref.tab) &&
                typeof ref.label === 'string'
            )
          : [],
      }));
    renderChat();
    $('#reader-chat').hidden = !AlfaApi.can('analyze');
    renderFeedback();
    NewsAI.mount(event, company);
    const opened = context;
    AlfaApi.getFeedback(company.id, event.id)
      .then((result) => {
        if (context !== opened) return;
        if (result.feedback) feedback[feedbackKey()] = result.feedback;
        else delete feedback[feedbackKey()];
        renderFeedback();
      })
      .catch(() => {
        if (context === opened)
          $('#feedback-status').textContent =
            'Серверные оценки недоступны. Локальная копия может быть устаревшей.';
      });
  }

  function selectTab(id, focus = false) {
    if (!context) return;
    document.querySelectorAll('[data-detail-tab]').forEach((tab) => {
      const active = tab.dataset.detailTab === id;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      $('#panel-' + tab.dataset.detailTab).hidden = !active;
      if (active && focus) tab.focus();
    });
  }

  function renderChat() {
    const log = $('#chat-log');
    log.innerHTML = context.messages
      .map(
        (m) =>
          `<div class="chat-turn"><div class="chat-question"><span>Вы</span><p>${escapeHtml(m.question)}</p></div><div class="chat-answer ${m.error ? 'chat-error' : ''}"><span>${m.pending ? 'Подготавливаем ответ' : m.error ? 'Ответ недоступен' : escapeHtml(m.model || 'Модель')}</span><p>${m.pending ? 'Анализируем вопрос и проверяем доступные основания…' : formatLines(m.text)}</p><div class="chat-references">${(m.refs || []).map((ref) => `<button data-reader-tab="${ref.tab}">${icon('link')}${escapeHtml(ref.label)}</button>`).join('')}${m.error ? `<button data-retry-chat="${escapeHtml(m.question)}">Повторить вопрос</button>` : ''}</div></div></div>`
      )
      .join('');
    log.scrollTop = log.scrollHeight;
    $('#clear-chat').disabled = context.busy || !context.messages.length;
    $('#chat-form button[type="submit"]').disabled = context.busy;
    document
      .querySelectorAll('[data-chat-prompt]')
      .forEach((button) => (button.disabled = context.busy));
    log.setAttribute('aria-busy', String(context.busy));
  }

  function persistChat() {
    const messages = context.messages.filter((m) => !m.pending && !m.error).slice(-10);
    questionHistory.set(key(), messages);
    if (!savePreference('chat-v3:' + key(), messages))
      showToast('История доступна до закрытия страницы: браузер запретил сохранение.');
  }

  async function ask(question) {
    if (!context || context.busy || !question.trim()) return;
    question = question.trim().slice(0, 500);
    const active = context;
    const ownVersion = ++chatVersion;
    chatRequest?.abort();
    chatRequest = new AbortController();
    const history = active.messages
      .filter((m) => !m.pending && !m.error)
      .slice(-6)
      .map((m) => ({ question: m.question, answer: m.text }));
    if (active.messages.at(-1)?.error && active.messages.at(-1).question === question)
      active.messages.pop();
    const turn = { question, text: '', refs: [], pending: true };
    active.messages.push(turn);
    active.messages = active.messages.slice(-10);
    active.busy = true;
    $('#chat-input').value = '';
    renderChat();
    try {
      const reply = await AlfaApi.ask(
        active.company.id,
        active.event.id,
        question,
        history,
        chatRequest.signal
      );
      if (ownVersion !== chatVersion || context !== active) return;
      Object.assign(turn, {
        text: reply.text,
        model: reply.model,
        generatedAt: reply.generatedAt,
        pending: false,
        refs: reply.sourceIds.length
          ? [
              { label: 'Основания ответа', tab: 'sources' },
              { label: 'Персональный разбор', tab: 'impact' },
            ]
          : [],
      });
      NewsAI.apply(reply.insight);
      persistChat();
    } catch (error) {
      if (ownVersion !== chatVersion || context !== active || error.name === 'AbortError') return;
      Object.assign(turn, {
        pending: false,
        error: true,
        text:
          error.name === 'TimeoutError'
            ? 'Не удалось дождаться ответа. Повторите вопрос.'
            : error.message,
      });
    } finally {
      if (ownVersion === chatVersion && context === active) {
        active.busy = false;
        renderChat();
      }
    }
  }

  function renderFeedback() {
    const value = feedback[feedbackKey()];
    const valid = value && NewsTools.feedbackLabels[value.rating];
    document.querySelectorAll('[data-feedback]').forEach((button) => {
      button.disabled = !AlfaApi.can('feedback');
      button.setAttribute(
        'aria-pressed',
        String(Boolean(valid && button.dataset.feedback === value.rating))
      );
    });
    $('#feedback-form').hidden = !valid;
    $('#feedback-comment').value = valid ? value.comment || '' : '';
    $('#feedback-status').textContent = !AlfaApi.can('feedback')
      ? 'Для вашей роли доступен только просмотр.'
      : valid
        ? 'Оценка загружена. Она учитывается в мониторинге качества.'
        : 'Оценка и комментарий сохраняются на сервере для проверки качества. Не указывайте конфиденциальные сведения.';
  }

  async function storeFeedback(rating, comment) {
    if (!context) return;
    const active = context;
    feedback[feedbackKey()] = {
      rating,
      comment: comment.slice(0, 1000),
      updatedAt: new Date().toISOString(),
    };
    const persisted = savePreference('feedback-v2:' + AlfaApi.userId(), feedback);
    renderFeedback();
    $('#feedback-status').textContent = persisted
      ? 'Локальная копия сохранена. Отправляем оценку на сервер…'
      : 'Отправляем оценку на сервер…';
    try {
      await AlfaApi.saveFeedback({
        companyId: active.company.id,
        newsId: active.event.id,
        rating,
        comment: comment.slice(0, 1000),
        analysisId: active.event.insight?.id || null,
      });
      if (context === active)
        $('#feedback-status').textContent =
          'Оценка сохранена на сервере и учтена в мониторинге качества.';
    } catch (error) {
      if (context === active)
        $('#feedback-status').textContent = 'На сервер не сохранено: ' + error.message;
    }
  }

  $('#detail-body').addEventListener('click', (event) => {
    if (!context) return;
    if (event.target.closest('a[href^="http"]'))
      AlfaApi.engage(context.company.id, context.event.id, 'source_open');
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-reader-trace')) showTrace();
    if (button.dataset.detailTab) selectTab(button.dataset.detailTab);
    if (button.dataset.readerTab) {
      selectTab(button.dataset.readerTab);
      $('#tab-' + button.dataset.readerTab).focus();
      $('#tab-' + button.dataset.readerTab).scrollIntoView({ block: 'nearest' });
    }
    if (button.dataset.chatPrompt) ask(button.dataset.chatPrompt);
    if (button.dataset.retryChat) ask(button.dataset.retryChat);
    if (button.dataset.feedback)
      storeFeedback(button.dataset.feedback, $('#feedback-comment').value);
    if (button.id === 'remove-feedback') {
      const active = context;
      delete feedback[feedbackKey()];
      const persisted = savePreference('feedback-v2:' + AlfaApi.userId(), feedback);
      renderFeedback();
      $('#feedback-status').textContent = persisted
        ? 'Удаляем оценку с сервера…'
        : 'Не удалось обновить хранилище браузера. После перезагрузки прежняя оценка может появиться снова.';
      AlfaApi.saveFeedback({ companyId: active.company.id, newsId: active.event.id, rating: null })
        .then(() => {
          if (context === active) $('#feedback-status').textContent = 'Оценка удалена с сервера.';
        })
        .catch((error) => {
          if (context === active)
            $('#feedback-status').textContent = 'Серверная оценка не удалена: ' + error.message;
        });
    }
    if (button.id === 'clear-chat') {
      context.messages = [];
      questionHistory.set(key(), []);
      const persisted = savePreference('chat-v3:' + key(), []);
      renderChat();
      if (!persisted) showToast('Не удалось очистить историю в хранилище браузера.');
    }
    if (button.hasAttribute('data-reader-compare')) openComparison(context.event.id);
    if (button.hasAttribute('data-reader-export')) openExport([context.event]);
  });
  async function showTrace() {
    const active = context;
    openUtility('Как подготовлена карточка', '<p role="status">Загружаем этапы проверки…</p>');
    try {
      const trace = await AlfaApi.getTrace(active.event.insight?.id || active.event.traceId);
      if (context !== active || !$('#utility-dialog').open) return;
      const names = {
        company_profile: 'Профиль и связи компании',
        event_grouping: 'Объединение публикаций',
        ranking: 'Оценка релевантности',
        news_text: 'Тексты источников',
        bank_materials: 'Материалы Альфа-Банка',
        source_search: 'Поиск оснований',
        plan: 'План проверки',
        analysis: 'Подготовка выводов',
        review: 'Проверка содержания',
        repair: 'Исправление оснований',
        tool: 'Обращение к данным',
      };
      $('#utility-body').innerHTML =
        `<p class="analysis-caption">${trace.status === 'ranking_only' ? 'Серверный отбор. Разбор модели ещё не подготовлен.' : 'Разбор с проверкой источников и содержания.'}</p><ol class="trace-steps">${(trace.steps || []).map((s) => `<li>${escapeHtml(names[s.tool] || names[s.stage] || 'Проверка')} ${s.score !== undefined ? `<strong>${formatScore(s.score)}</strong>` : ''}</li>`).join('')}</ol><p class="analysis-caption">Оснований: ${(trace.sources || []).length}. Это журнал этапов обработки.</p>`;
    } catch (error) {
      $('#utility-body').innerHTML = `<p role="alert">${escapeHtml(error.message)}</p>`;
    }
  }
  $('#detail-body').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!context) return;
    if (event.target.id === 'chat-form') ask($('#chat-input').value);
    if (event.target.id === 'feedback-form') {
      const value = feedback[feedbackKey()];
      if (value) storeFeedback(value.rating, $('#feedback-comment').value.trim());
    }
  });
  $('#detail-body').addEventListener('keydown', (event) => {
    if (event.target.id === 'chat-input' && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      ask(event.target.value);
    }
    const tab = event.target.closest('[role="tab"]');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll('[data-detail-tab]')];
    const index = tabs.indexOf(tab);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    selectTab(tabs[next].dataset.detailTab, true);
  });

  $('#detail-dialog').addEventListener('close', () => {
    ++chatVersion;
    chatRequest?.abort();
  });

  async function syncFeedback(companyId) {
    try {
      const result = await AlfaApi.getCompanyFeedback(companyId);
      Object.keys(feedback)
        .filter((key) => key.startsWith(companyId + ':'))
        .forEach((key) => delete feedback[key]);
      for (const row of result.feedback) feedback[row.companyId + ':' + row.newsId] = row;
      savePreference('feedback-v2:' + AlfaApi.userId(), feedback);
    } catch {
      /* Лента остаётся доступной; статус оценки уточняется в карточке. */
    }
  }
  return { open, selectTab, feedback, syncFeedback };
})();
