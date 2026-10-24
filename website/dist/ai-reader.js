'use strict';

window.NewsAI = (() => {
  let current;
  let version = 0;
  let request;
  const results = new Map();
  const sourceElementId = (id) => 'ai-source-' + encodeURIComponent(id);
  const sourceNames = {
    news: 'Новость',
    company: 'Профиль компании',
    ranking: 'Правила отбора',
    bank: 'Материал банка',
  };
  const stages = {
    planning: 'План анализа',
    tool: 'Получение данных',
    analysis: 'Персональный разбор',
    review: 'Проверка оснований',
    repair: 'Уточнение выводов',
  };
  const toolNames = {
    company_profile: 'Профиль компании',
    news_text: 'Текст события',
    ranking: 'Оценка и правила',
    bank_materials: 'Материалы банка',
    source_search: 'Поиск по корпусу источников',
  };

  function evidence(claim) {
    if (!claim.evidence?.length) return '';
    const names = {
      industry: 'Отрасль',
      okved: 'ОКВЭД',
      region: 'Регион',
      workers: 'Численность',
      'ved.hasVed': 'Признак ВЭД',
      'ved.country': 'Страны в данных ФТС',
      'bankProducts.hasLoans': 'Кредитные продукты',
      'bankProducts.hasGuarantees': 'Гарантии',
      'payments.largestRecipientShare': 'Доля крупнейшего получателя платежей',
    };
    return `<details class="claim-evidence"><summary>На чём основан вывод</summary>${claim.evidence.map((item) => `<div><span>${escapeHtml(names[item.feature] || (item.feature ? 'Признак компании' : 'Фрагмент источника'))}</span><blockquote>${escapeHtml(item.quote)}</blockquote>${refs([item.sourceId])}</div>`).join('')}</details>`;
  }

  function refs(ids) {
    if (!current?.result) return '';
    return `<div class="ai-references">${ids
      .map((id) => {
        const source = current.result.sources.find((item) => item.id === id);
        return source
          ? `<button data-ai-source="${escapeHtml(id)}">${icon('link')}${escapeHtml(source.title)}</button>`
          : '';
      })
      .join('')}</div>`;
  }

  function claimList(items, type) {
    if (!items.length)
      return '<p class="data-gap">По доступным данным отдельных выводов не сформировано.</p>';
    return items
      .map(
        (item) =>
          `<article class="ai-claim"><p>${formatLines(item.text)}</p><span class="ai-condition">${escapeHtml(type === 'actions' ? 'Основание: ' : 'Условие: ')}${escapeHtml(type === 'actions' ? item.rationale : item.condition)}</span>${refs(item.sourceIds)}${evidence(item)}</article>`
      )
      .join('');
  }

  function render(result) {
    if (!current || result.companyId !== current.company.id || result.newsId !== current.event.id)
      return;
    current.result = result;
    current.event.insight = result;
    results.set(current.key, result);
    if (results.size > 20) results.delete(results.keys().next().value);
    const a = result.analysis;
    $('#ai-summary').hidden = false;
    $('#ai-summary').innerHTML =
      `<div class="content-origin">Краткий разбор модели</div><p>${formatLines(a.summary.text)}</p>${refs(a.summary.sourceIds)}${evidence(a.summary)}`;
    $('#ai-impact').innerHTML =
      `<section class="analysis-block"><div class="content-origin">Вывод модели · Контекст компании</div><h3>Как событие связано с бизнесом</h3><p>${formatLines(a.whyImportant.text)}</p>${refs(a.whyImportant.sourceIds)}${evidence(a.whyImportant)}</section>
      <section class="analysis-block"><h3>Возможные риски</h3>${claimList(a.risks, 'risks')}</section>
      <section class="analysis-block"><h3>Возможности</h3>${claimList(a.opportunities, 'opportunities')}</section>
      <section class="ai-missing"><h3>Для уточнения оценки</h3>${a.missingData.length ? `<ul>${a.missingData.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p>Дополнительные пробелы модель не выделила. Это не означает полноту исходных данных.</p>'}</section>`;
    $('#ai-actions').innerHTML =
      `<section class="analysis-block"><div class="content-origin">Предложенные моделью действия</div><h3>Что можно сделать</h3>${claimList(a.actions, 'actions')}<span class="analysis-caption">Действия предложены с учётом доступных данных. Условия контрактов и обязательств требуют проверки.</span></section>`;
    $('#ai-bank').innerHTML =
      `<h3>${result.bankView.historical ? 'Исторический контекст Альфа-Банка' : 'Позиция Альфа-Банка'}</h3><p>${formatLines(result.bankView.status === 'available' ? result.bankView.text : 'Подтверждённый материал банка с датой и первоисточником для этого события не найден.')}</p>${refs(result.bankView.sourceIds)}<span class="analysis-caption">${result.bankView.status === 'available' ? 'Короткие цитаты из материалов банка на указанную дату. Они не являются текущей оценкой новой новости.' : 'Выводы модели выше не являются позицией банка.'}</span>`;
    const stamp = new Intl.DateTimeFormat('ru-RU', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(result.generatedAt));
    $('#ai-sources').innerHTML =
      `<section class="ai-provenance"><div class="content-origin">Происхождение разбора</div><h3>${escapeHtml(result.model)}</h3><p>Сформирован ${stamp}${result.cached ? ' · Из кэша' : ''}. Проверен форматом и отдельным обращением к модели; независимая проверка фактов не выполнялась.</p></section>
      ${result.sources.map((source) => `<div class="source-card" id="${sourceElementId(source.id)}"><div class="source-card-title">${escapeHtml(sourceNames[source.kind] || 'Основание')}<span>${escapeHtml(source.id)}</span></div><p>${escapeHtml(source.title)}${source.date ? ' · ' + escapeHtml(source.date) : ''}</p>${source.url ? `<a class="inline-link" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">Открыть материал ${icon('arrow-up-right')}</a>` : ''}</div>`).join('')}
      <details class="ai-workflow"><summary>Как подготовлен разбор</summary><ol>${result.workflow.map((step) => `<li>${escapeHtml(step.stage === 'tool' ? toolNames[step.tool] || step.tool : stages[step.stage] || step.stage)}${step.status === 'no_verified_material' ? ' — подтверждённые материалы не найдены' : ''}</li>`).join('')}</ol><span class="analysis-caption">Это этапы обработки и обращения к данным, без внутренних рассуждений модели.</span></details>`;
    $('#ai-state').textContent = 'Разбор готов · ' + stamp;
    $('#ai-state').dataset.state = 'ready';
    $('#ai-run').textContent = 'Открыть разбор';
    $('#ai-run').disabled = false;
  }

  async function run() {
    if (!current) return;
    if (current.result) {
      NewsReader.selectTab('impact', true);
      return;
    }
    const ownVersion = version;
    request?.abort();
    request = new AbortController();
    $('#ai-run').disabled = true;
    $('#ai-run').textContent = 'Готовим разбор…';
    $('#ai-state').textContent = 'Собираем контекст, анализируем и проверяем основания.';
    $('#ai-state').dataset.state = 'loading';
    try {
      const result = await AlfaApi.analyze(current.company.id, current.event.id, request.signal);
      if (ownVersion !== version) return;
      render(result);
      NewsReader.selectTab('impact', true);
    } catch (error) {
      if (ownVersion !== version || error.name === 'AbortError') return;
      $('#ai-state').textContent =
        error.name === 'TimeoutError'
          ? 'Не удалось дождаться разбора. Повторите запрос.'
          : error.message;
      $('#ai-state').dataset.state = 'error';
      $('#ai-run').textContent = 'Повторить разбор';
      $('#ai-run').disabled = false;
    }
  }

  function mount(event, company) {
    ++version;
    request?.abort();
    current = {
      event,
      company,
      key: JSON.stringify([
        company.id,
        event.id,
        event.rawText,
        company.profile,
        event.assignments[company.id],
      ]),
    };
    const result = results.get(current.key);
    if (result) render(result);
    const ownVersion = version;
    AlfaApi.getAiStatus()
      .then((status) => {
        if (ownVersion !== version) return;
        if (!AlfaApi.can('analyze')) {
          $('#ai-state').textContent = 'Для вашей роли доступен только просмотр события.';
          $('#ai-run').disabled = true;
          return;
        }
        $('#ai-model').textContent = status.configured ? status.model : 'Модель не настроена';
        if (!status.configured && !current.result) {
          $('#ai-state').textContent = 'На сервере не настроено подключение к модели.';
          $('#ai-state').dataset.state = 'error';
          $('#ai-run').disabled = true;
        }
      })
      .catch(() => {
        if (ownVersion === version && !current.result)
          $('#ai-state').textContent = 'Статус модели недоступен. Можно повторить запрос разбора.';
      });
  }

  $('#detail-body').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.id === 'ai-run') run();
    if (button.dataset.aiSource) {
      NewsReader.selectTab('sources', true);
      document
        .getElementById(sourceElementId(button.dataset.aiSource))
        ?.scrollIntoView({ block: 'center' });
    }
  });
  $('#detail-dialog').addEventListener('close', () => {
    ++version;
    request?.abort();
    current = null;
  });
  return { mount, apply: render };
})();
