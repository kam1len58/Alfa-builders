'use strict';
window.ServicePanels = (() => {
  let version = 0,
    poll;
  const date = (value) =>
    value
      ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(
          new Date(value)
        )
      : 'Ещё не обновлялся';
  const pct = (value) =>
    value === null || value === undefined
      ? 'Нет данных'
      : new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 1 }).format(
          value
        );
  const statusNames = {
    ready: 'Доступен',
    error: 'Ошибка загрузки',
    review_required: 'Нужна проверка',
    not_collected: 'Ожидает загрузки',
  };
  const roles = {
    owner: 'Владелец',
    editor: 'Редактор источников',
    analyst: 'Аналитик',
    expert: 'Эксперт',
    viewer: 'Просмотр',
  };
  const card = (label, value, note = '') =>
    '<article class="service-stat"><span>' +
    escapeHtml(label) +
    '</span><strong>' +
    escapeHtml(value) +
    '</strong><small>' +
    escapeHtml(note) +
    '</small></article>';
  function loading(title) {
    const own = ++version;
    clearTimeout(poll);
    openUtility(title, '<p class="service-note" role="status">Загружаем данные…</p>');
    return own;
  }
  function failure(error, own) {
    if (own === version)
      $('#utility-body').innerHTML =
        '<p class="service-error" role="alert">' + escapeHtml(error.message) + '</p>';
  }
  async function sources({ keep = false } = {}) {
    const own = keep ? version : loading('Источники и обновления');
    try {
      const [data, session] = await Promise.all([AlfaApi.getSources(), AlfaApi.getSession()]);
      if (own !== version) return;
      const bank = data.documents.filter((d) => d.kind === 'bank' && d.status === 'ready');
      const news = data.documents.filter((d) => d.kind === 'news' && d.status === 'ready');
      const canManage = session.permissions.includes('sources');
      $('#utility-body').innerHTML =
        '<div class="service-intro"><span class="section-overline">Основания решений</span><h3>От публикации к вашему бизнесу</h3><p>Новости поступают из официальных каналов. Материалы банка используются с датой и первоисточником; выводы модели показаны отдельно.</p></div>' +
        '<div class="service-stat-grid">' +
        card('Внешние новости', news.length, 'В текущем корпусе') +
        card('Материалы банка', bank.length, 'Проверены происхождение и цитаты') +
        card('Источники', data.sources.length, 'RSS и документы кейса') +
        '</div>' +
        '<div class="service-toolbar">' +
        (canManage
          ? '<button class="secondary-button" data-service="refresh">' +
            icon('sources') +
            'Обновить источники</button>'
          : '') +
        '<button class="secondary-button" data-service="sources">' +
        icon('check') +
        'Проверить состояние</button><button class="inline-link" data-service="reload-feed">Обновить мою ленту</button></div><p id="source-operation" class="analysis-caption" role="status">Автоматическая проверка — каждый час при работающем сервере. Обновление не обращается к модели.</p>' +
        '<div class="source-status-list">' +
        data.sources
          .map(
            (s) =>
              '<article class="source-status-row"><div><strong>' +
              escapeHtml(s.name) +
              '</strong><span>' +
              escapeHtml(s.kind === 'bank' ? 'Аналитика банка' : 'Новостной канал') +
              ' · ' +
              escapeHtml(s.format.toUpperCase()) +
              '</span><small>' +
              escapeHtml(date(s.lastSuccess)) +
              '</small></div><span class="source-state ' +
              escapeHtml(s.status) +
              '">' +
              escapeHtml(statusNames[s.status] || s.status) +
              '</span></article>'
          )
          .join('') +
        '</div>' +
        '<section class="service-section"><h3>Аналитика Альфа-Банка</h3><p class="analysis-caption">Это исторические оценки на дату документа. Они не заменяют актуальную позицию банка.</p>' +
        bank
          .map(
            (d) =>
              '<article class="bank-document"><span class="content-origin">' +
              escapeHtml(d.publishedAt.slice(0, 10)) +
              ' · Материал кейса</span><h4>' +
              escapeHtml(d.title) +
              '</h4>' +
              (d.excerpts || [])
                .map(
                  (e) =>
                    '<blockquote>' +
                    escapeHtml(e.text) +
                    '<cite>Страница ' +
                    e.page +
                    '</cite></blockquote>'
                )
                .join('') +
              '<p class="analysis-caption">' +
              escapeHtml(d.caveat || '') +
              '</p><a class="inline-link" href="' +
              escapeHtml(d.url) +
              '" target="_blank" rel="noopener noreferrer">Открыть документ ' +
              icon('arrow-up-right') +
              '</a><details><summary>Проверка происхождения</summary><p class="hash-line">SHA-256: ' +
              escapeHtml(d.documentHash || d.contentHash) +
              '</p><p class="analysis-caption">Короткие цитаты сверены со страницей PDF. Хеш скачанного файла должен совпасть; изменённый скан требует повторной проверки.</p></details></article>'
          )
          .join('') +
        '</section>' +
        '<section class="service-section"><h3>Последние публикации</h3>' +
        news
          .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
          .slice(0, 8)
          .map(
            (d) =>
              '<article class="source-publication"><span>' +
              escapeHtml(d.publishedAt.slice(0, 10)) +
              ' · ' +
              escapeHtml(d.publisher) +
              '</span><a href="' +
              escapeHtml(d.url) +
              '" target="_blank" rel="noopener noreferrer">' +
              escapeHtml(d.title) +
              ' ' +
              icon('arrow-up-right') +
              '</a></article>'
          )
          .join('') +
        '</section>' +
        (canManage
          ? '<details class="service-section"><summary>Добавить официальную публикацию</summary><p class="analysis-caption">Разрешены домены из конфигурации источников. Статья должна содержать текст и дату; произвольные адреса и внутренние сети отклоняются.</p><form id="source-import-form" class="service-form"><label>Адрес статьи<input type="url" name="url" placeholder="https://www.cbr.ru/…" maxlength="1500" required></label><label>Тип<select name="kind"><option value="news">Новость</option><option value="bank">Материал Альфа-Банка</option></select></label><button class="secondary-button" type="submit">Загрузить публикацию</button><p id="source-import-status" role="status"></p></form></details>'
          : '');
    } catch (error) {
      failure(error, own);
    }
  }
  async function quality() {
    const own = loading('Качество анализа');
    try {
      const [data, session] = await Promise.all([AlfaApi.getQuality(), AlfaApi.getSession()]);
      if (own !== version) return;
      const metrics = data.metrics,
        evaluation = data.evaluation;
      $('#utility-body').innerHTML =
        '<div class="service-intro"><span class="section-overline">Контроль качества</span><h3>Что подтверждено проверками</h3><p>' +
        escapeHtml(data.disclaimer) +
        '</p></div>' +
        '<div class="service-stat-grid">' +
        card('Разборы', data.counts.completed, 'Прошли проверку формата и оснований') +
        card(
          'Связь с источниками',
          pct(metrics.citationCoverage),
          'Точные цитаты и признаки профиля'
        ) +
        card(
          'Экспертное одобрение',
          pct(metrics.expertApproval),
          data.counts.expertReviews + ' экспертных оценок'
        ) +
        card(
          'Пользовательская польза',
          pct(metrics.usefulRate),
          data.counts.feedback + ' отзывов'
        ) +
        card('С первого раза', pct(metrics.firstPass), 'Без исправления моделью') +
        card('Ошибки обработки', pct(metrics.failureRate), 'Не выдаются как готовый разбор') +
        '</div>' +
        '<p class="service-note">Связь с источниками измеряет наличие проверенных оснований, а не истинность каждого вывода. Выборка: ' +
        escapeHtml(data.window) +
        '.</p>' +
        (data.alerts || [])
          .map(
            (message) => '<p class="service-error" role="status">' + escapeHtml(message) + '</p>'
          )
          .join('') +
        '<section class="service-section"><div class="service-section-heading"><h3>Контроль отбора новостей</h3><button class="secondary-button" data-service="evaluate">Запустить проверку</button></div>' +
        (evaluation
          ? '<p>Синтетические примеры: ' +
            evaluation.cases.length +
            '. Точность отбора: <strong>' +
            pct(evaluation.metrics.precision) +
            '</strong>; полнота: <strong>' +
            pct(evaluation.metrics.recall) +
            '</strong>.</p><p class="analysis-caption">' +
            escapeHtml(evaluation.note) +
            '</p><div class="benchmark-list">' +
            evaluation.cases
              .filter((c) => !c.passed)
              .map(
                (c) =>
                  '<p>' +
                  escapeHtml(c.id) +
                  ' — ожидается ' +
                  (c.expected ? 'показ' : 'скрытие') +
                  ', получено ' +
                  (c.actual ? 'показ' : 'скрытие') +
                  '</p>'
              )
              .join('') +
            '</div>'
          : '<p>Проверка ещё не выполнена.</p>') +
        '</section>' +
        '<section class="service-section"><h3>Последние разборы</h3><div class="quality-history">' +
        data.recent
          .map(
            (row) =>
              '<article><div><strong>' +
              escapeHtml(row.companyId) +
              ' · ' +
              escapeHtml(row.newsId) +
              '</strong><span>' +
              escapeHtml(date(row.at)) +
              '</span></div><span class="source-state ' +
              (row.status === 'completed' ? 'ready' : 'error') +
              '">' +
              escapeHtml(row.status === 'completed' ? 'Проверен' : 'Отклонён') +
              '</span></article>'
          )
          .join('') +
        '</div>' +
        (data.recent.length
          ? ''
          : '<p class="data-gap">Пока нет разборов. Откройте событие и подготовьте анализ.</p>') +
        '</section>' +
        (session.permissions.includes('review')
          ? '<section class="service-section"><h3>Экспертная оценка</h3><p class="analysis-caption">Эксперт проверяет факты, применимость к компании, обоснованность рекомендаций и корректность позиции банка.</p><form id="expert-review-form" class="service-form"><label>Разбор<select name="analysisId" required><option value="">Выберите разбор</option>' +
            [
              ...new Map(
                data.recent.filter((r) => r.status === 'completed').map((r) => [r.id, r])
              ).values(),
            ]
              .map(
                (r) =>
                  '<option value="' +
                  escapeHtml(r.id) +
                  '">' +
                  escapeHtml(r.companyId + ' · ' + r.newsId) +
                  '</option>'
              )
              .join('') +
            '</select></label><label>Результат<select name="verdict"><option value="approved">Обоснован</option><option value="rejected">Нужна доработка</option></select></label><label>Комментарий<textarea name="comment" rows="3" maxlength="1000"></textarea></label><button class="secondary-button" type="submit">Сохранить оценку</button><p id="expert-status" role="status"></p></form></section>'
          : '') +
        '<section class="service-section"><h3>Обратная связь</h3>' +
        data.feedback
          .map(
            (row) =>
              '<article class="source-publication"><span>' +
              escapeHtml(row.companyId + ' · ' + row.newsId) +
              '</span><strong>' +
              escapeHtml(NewsTools.feedbackLabels[row.rating] || row.rating) +
              '</strong>' +
              (row.comment ? '<p>' + escapeHtml(row.comment) + '</p>' : '') +
              '</article>'
          )
          .join('') +
        (data.feedback.length ? '' : '<p class="data-gap">Оценок пользователей пока нет.</p>') +
        '</section><button class="inline-link" data-service="audit">Журнал обращений к инструментам</button>';
    } catch (error) {
      failure(error, own);
    }
  }
  async function profile() {
    const own = loading('Доступ к сервису');
    try {
      const session = await AlfaApi.getSession();
      if (own !== version) return;
      $('#utility-body').innerHTML =
        '<div class="profile-name">' +
        escapeHtml(session.user?.name || 'Вход в сервис') +
        '</div><p>' +
        escapeHtml(roles[session.user?.role] || '') +
        '</p><p class="analysis-caption">' +
        (session.mode === 'local'
          ? 'Локальный режим: доступ предоставлен пользователю этого компьютера. Для разделения доступа настройте отдельные учётные записи.'
          : 'Компании ограничены правами вашей учётной записи.') +
        '</p>' +
        (session.mode === 'accounts'
          ? '<button class="secondary-button" data-service="logout">Выйти</button>'
          : '');
    } catch (error) {
      failure(error, own);
    }
  }
  function login() {
    ++version;
    clearTimeout(poll);
    openUtility(
      'Вход в сервис',
      '<form id="service-login-form" class="service-form"><p>Войдите, чтобы открыть доступные вашей учётной записи компании.</p><label>Имя пользователя<input name="username" autocomplete="username" maxlength="100" required></label><label>Пароль<input type="password" name="password" autocomplete="current-password" maxlength="256" required></label><button class="secondary-button" type="submit">Войти</button><p id="login-status" role="alert"></p></form>'
    );
  }
  $('#utility-body').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-service]');
    if (!button) return;
    const action = button.dataset.service;
    if (action === 'sources') return sources({ keep: true });
    if (action === 'reload-feed') {
      $('#utility-dialog').close();
      return selectCompany(state.company.id);
    }
    if (action === 'logout') {
      await AlfaApi.logout();
      location.reload();
      return;
    }
    button.disabled = true;
    try {
      if (action === 'refresh') {
        await AlfaApi.refreshSources();
        $('#source-operation').textContent =
          'Идёт загрузка. Лента обновится после нажатия «Обновить мою ленту».';
        const own = version;
        poll = setTimeout(() => {
          if (own === version && $('#utility-dialog').open) sources({ keep: true });
        }, 12000);
      }
      if (action === 'evaluate') {
        await AlfaApi.evaluate();
        return quality();
      }
      if (action === 'audit') {
        const own = loading('Журнал инструментов'),
          data = await AlfaApi.getAudit();
        if (own === version)
          $('#utility-body').innerHTML =
            '<p class="service-note">Метаданные действий без ключей, запросов и внутренних рассуждений модели.</p>' +
            data.entries
              .map(
                (row) =>
                  '<article class="source-publication"><span>' +
                  escapeHtml(date(row.at)) +
                  '</span><strong>' +
                  escapeHtml(row.operation + ' · ' + (row.tool || row.status || '')) +
                  '</strong><small>' +
                  escapeHtml([row.companyId, row.newsId, row.code].filter(Boolean).join(' · ')) +
                  '</small></article>'
              )
              .join('');
      }
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  });
  $('#utility-body').addEventListener('submit', async (event) => {
    if (
      !['source-import-form', 'expert-review-form', 'service-login-form'].includes(event.target.id)
    )
      return;
    event.preventDefault();
    const form = event.target,
      values = Object.fromEntries(new FormData(form)),
      button = form.querySelector('button[type="submit"]');
    const status = form.querySelector('[role="status"],[role="alert"]');
    button.disabled = true;
    try {
      if (form.id === 'service-login-form') {
        await AlfaApi.login(values.username, values.password);
        form.reset();
        $('#utility-dialog').close();
        initialize();
        return;
      }
      if (form.id === 'source-import-form') {
        await AlfaApi.importSource(values.url, values.kind);
        status.textContent = 'Материал добавлен. Обновите ленту.';
      }
      if (form.id === 'expert-review-form') {
        await AlfaApi.review(values);
        status.textContent = 'Экспертная оценка сохранена.';
      }
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  $('#utility-dialog').addEventListener('close', () => {
    ++version;
    clearTimeout(poll);
  });
  window.addEventListener('alfa-login-required', login);
  return { sources, quality, profile };
})();
