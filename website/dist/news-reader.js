'use strict';

window.NewsReader = (() => {
  let context = null;
  let chatRequest;
  let chatVersion = 0;
  const questionHistory = new Map();
  const stored = loadPreference('feedback-v1', {});
  const feedback = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  const key = () => JSON.stringify([context.company.id, context.event.id]);
  const feedbackKey = () => `${context.company.id}:${context.event.id}`;

  function sourcePanel(event, company) {
    return `<div class="source-card"><div class="source-card-title">01 / Новость</div>
      <p>${escapeHtml(event.source)} · ${escapeHtml(event.id)} · ${escapeHtml(event.date)}</p>
      ${event.sourceUrl ? `<a class="inline-link" href="${escapeHtml(event.sourceUrl)}" target="_blank" rel="noopener noreferrer">Открыть публикацию ${icon('arrow-up-right')}</a>` : '<p class="data-gap">Ссылка на первоисточник не передана.</p>'}
      <span class="analysis-caption">Текст получен от сервиса. Изображение в карточке иллюстративное.</span></div>
      <div class="source-card"><div class="source-card-title">02 / Профиль компании</div>
      <p>${escapeHtml(company.id)} · ${escapeHtml(company.profile.industry)} · ОКВЭД ${escapeHtml(company.profile.okved_code)}</p>
      <button class="inline-link" data-reader-tab="impact">Посмотреть признаки отбора ${icon('arrow-right')}</button></div>
      <div class="source-card"><div class="source-card-title">03 / Оценка и интерпретация</div>
      <p>Балл, раздел ленты, причины отбора и продукты переданы бэкендом. Сайт не пересчитывает оценку.</p>
      <span class="analysis-caption">Выводы модели и этапы их проверки отображаются ниже после подготовки разбора. Банковская позиция используется только с подтверждённым источником.</span></div>
      <p class="source-note">Релевантность не означает вероятность риска. Сведения из публикации и объяснения сервиса не прошли независимую проверку.</p>`;
  }

  function open(event, company) {
    ++chatVersion;
    chatRequest?.abort();
    context = { event, company, messages: [], busy: false };
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
        <section class="analysis-block"><div class="content-origin">Материал новости</div><h3>Что произошло</h3><p>${formatLines(event.rawText)}</p><span class="analysis-caption">${escapeHtml(event.source)} · ${escapeHtml(event.date)}</span></section>
        <section class="reader-summary"><div><span>Приоритет</span><strong>${escapeHtml(a.placement)}</strong></div><div><span>Релевантность</span><strong>${formatScore(a.score)} <small>из 1</small></strong></div></section>
        <section class="analysis-block"><div class="content-origin">Объяснение сервиса</div><h3>Почему важно для компании</h3><p>${formatLines(a.explanation)}</p><button class="inline-link reader-next" data-reader-tab="impact">Посмотреть основания ${icon('arrow-right')}</button></section>
        <section class="analysis-block ai-summary" id="ai-summary" hidden></section><div class="reader-actions"><button class="secondary-button" data-reader-compare>${icon('compare')} Сравнить компании</button><button class="secondary-button" data-reader-export>${icon('download')} Экспорт события</button></div>
      </div>
      <div id="panel-impact" role="tabpanel" aria-labelledby="tab-impact" tabindex="0" hidden>
        <div id="ai-impact"><section class="missing-analysis"><span class="content-origin">Риски и возможности</span><h3>Подготовьте персональный разбор</h3><p>Модель сопоставит событие с профилем компании, укажет возможные последствия, условия и недостающие данные.</p></section></div>
<details class="ranking-details"><summary>Правила отбора и признаки профиля</summary>
        <section class="analysis-block"><div class="content-origin">Персонализация сервиса</div><h3>Основания отбора</h3><p>${formatLines(a.explanation)}</p></section>
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
        <div class="chat-content"><p class="chat-disclosure">Ответ учитывает событие, профиль компании и предыдущие сообщения. Для первого вопроса сервис подготовит и проверит разбор. Внешний поиск пока не подключён.</p>
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
      const saved = loadPreference('chat-v2:' + key(), []);
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
    renderFeedback();
    NewsAI.mount(event, company);
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
    if (!savePreference('chat-v2:' + key(), messages))
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
      button.setAttribute(
        'aria-pressed',
        String(Boolean(valid && button.dataset.feedback === value.rating))
      );
    });
    $('#feedback-form').hidden = !valid;
    $('#feedback-comment').value = valid ? value.comment || '' : '';
    $('#feedback-status').textContent = valid
      ? 'Есть локальная оценка. На сервер не отправлена; доступна в экспорте.'
      : 'Оценка сохраняется в этом браузере и пока не отправляется на сервер.';
  }

  function storeFeedback(rating, comment) {
    if (!context) return;
    feedback[feedbackKey()] = {
      rating,
      comment: comment.slice(0, 1000),
      updatedAt: new Date().toISOString(),
    };
    const persisted = savePreference('feedback-v1', feedback);
    renderFeedback();
    $('#feedback-status').textContent = persisted
      ? 'Сохранено в этом браузере. На сервер не отправлено; доступно в экспорте.'
      : 'Оценка сохранена только до закрытия страницы: браузер запретил запись.';
  }

  $('#detail-body').addEventListener('click', (event) => {
    if (!context) return;
    const button = event.target.closest('button');
    if (!button) return;
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
      delete feedback[feedbackKey()];
      const persisted = savePreference('feedback-v1', feedback);
      renderFeedback();
      $('#feedback-status').textContent = persisted
        ? 'Оценка удалена из этого браузера.'
        : 'Не удалось обновить хранилище браузера. После перезагрузки прежняя оценка может появиться снова.';
    }
    if (button.id === 'clear-chat') {
      context.messages = [];
      questionHistory.set(key(), []);
      const persisted = savePreference('chat-v2:' + key(), []);
      renderChat();
      if (!persisted) showToast('Не удалось очистить историю в хранилище браузера.');
    }
    if (button.hasAttribute('data-reader-compare')) openComparison(context.event.id);
    if (button.hasAttribute('data-reader-export')) openExport([context.event]);
  });
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

  return { open, selectTab, feedback };
})();
