'use strict';

let comparisonRequest;
let comparisonVersion = 0;
let comparisonRows = [];
let comparisonNews = null;
let comparisonBusy = false;
let exportItems = [];

function resetAdvancedFilters() {
  state.filters = { from: '', to: '', topic: '', product: '' };
  for (const field of ['from', 'to', 'topic', 'product']) $('#filter-' + field).value = '';
}

function renderFilterOptions() {
  const options = (items, label) =>
    `<option value="">${label}</option>` +
    [...new Set(items)]
      .sort((a, b) => a.localeCompare(b, 'ru'))
      .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
      .join('');
  $('#filter-topic').innerHTML = options(
    events.map((event) => event.category),
    'Все темы'
  );
  $('#filter-product').innerHTML = options(
    events.flatMap((event) => companyAssignment(event).products),
    'Все продукты'
  );
  for (const field of ['topic', 'product']) $('#filter-' + field).value = state.filters[field];
}

function renderWorkbench() {
  const pending = state.loading || Boolean(state.error);
  const shown = pending ? [] : getFilteredEvents();
  $('#export-open').disabled = pending || (!shown.length && !state.checked.size);
  $('#compare-open').disabled = pending || !events.length || companies.length < 2;
  const active = Object.values(state.filters).filter(Boolean).length;
  $('#filter-count').textContent = active || '';
  $('#filter-toggle').classList.toggle('has-filters', active > 0);
  $('#filter-error').hidden = !(
    state.filters.from &&
    state.filters.to &&
    state.filters.from > state.filters.to
  );
  $('#filter-to').setAttribute('aria-invalid', String(!$('#filter-error').hidden));
  $('#filter-to').setCustomValidity(
    $('#filter-error').hidden ? '' : 'Дата окончания раньше даты начала.'
  );
  $('#filter-fields').disabled = pending;
  const labels = { from: 'С', to: 'По', topic: 'Тема', product: 'Продукт' };
  $('#active-filters').innerHTML = Object.entries(state.filters)
    .filter(([, value]) => value)
    .map(
      ([field, value]) =>
        `<button class="filter-chip" data-clear-filter="${field}" aria-label="Убрать фильтр: ${escapeHtml(labels[field] + ' ' + value)}">${escapeHtml(labels[field] + ': ' + (['from', 'to'].includes(field) ? value.split('-').reverse().join('.') : value))}${icon('close')}</button>`
    )
    .join('');
  $('#active-filters').hidden = active === 0;
  $('#selection-bar').hidden = pending || !state.checked.size;
  $('#selected-count').textContent = state.checked.size;
  $('#select-visible').checked =
    shown.length > 0 && shown.every((event) => state.checked.has(event.id));
  $('#select-visible').indeterminate =
    shown.some((event) => state.checked.has(event.id)) && !$('#select-visible').checked;
  $('#select-visible').disabled = !shown.length;
  $('#visible-label').textContent = pending
    ? 'Загрузка подборки'
    : `Показано ${shown.length} из ${events.length}`;
}

function openExport(items) {
  if (!state.company || state.loading || state.error) return;
  exportItems =
    items ||
    (state.checked.size
      ? events.filter((event) => state.checked.has(event.id))
      : getFilteredEvents());
  if (!exportItems.length) return;
  openUtility(
    'Экспорт подборки',
    `<div class="export-overview"><span class="export-symbol">${icon('download')}</span><div><strong>${NewsTools.eventCount(exportItems.length)}</strong><p>${escapeHtml(state.company.name)} · ${escapeHtml(state.company.id)}</p></div></div>
    <p>${items ? 'Выбрано событие из открытой карточки.' : state.checked.size ? 'Выгрузка отмеченных карточек, включая скрытые текущими фильтрами.' : 'Выгрузка всех карточек, показанных с текущими фильтрами.'}</p>
    <div class="export-formats"><button data-download="csv"><strong>CSV ${icon('arrow-up-right')}</strong><span>Таблица для Excel · UTF-8</span></button><button data-download="json"><strong>JSON ${icon('arrow-up-right')}</strong><span>Все поля и массивы данных</span></button></div>
    <p class="source-note">В файл войдут тексты, баллы, причины отбора, продукты, доступные ссылки и локальная обратная связь. Выручка и платёжные связи профиля не включаются. Подготовленные выводы модели включаются отдельно; отсутствующие разделы остаются пустыми.</p><p id="export-status" role="status" class="analysis-caption">Файл будет создан в браузере.</p>`
  );
}

function downloadExport(format) {
  if (!exportItems.length || !state.company) return;
  const rows = NewsTools.exportRows(exportItems, state.company, NewsReader.feedback);
  const timestamp = new Date().toISOString();
  const data =
    format === 'csv'
      ? NewsTools.csv(rows)
      : JSON.stringify(
          {
            exportedAt: timestamp,
            scoreMeaning: 'Релевантность, не вероятность риска',
            analysisNotice:
              'Выводы модели включены только для событий с подготовленным разбором; неподтверждённая позиция банка не добавляется.',
            events: rows,
          },
          null,
          2
        );
  const blob = new Blob([data], {
    type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `alfa-${state.company.id.replace(/[^a-z0-9_-]/gi, '_')}-${timestamp.slice(0, 10)}.${format}`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  $('#export-status').textContent =
    `${format.toUpperCase()}: ${NewsTools.eventCount(rows.length)}. Скачивание запрошено.`;
}

function renderComparisonOptions(preferredId) {
  const available = new Map();
  for (const row of comparisonRows)
    for (const event of row.events || []) available.set(event.id, event);
  for (const event of events) available.set(event.id, event);
  if (!available.size) {
    $('#comparison-event').innerHTML = '<option value="">Нет доступных событий</option>';
    comparisonNews = null;
    return;
  }
  comparisonNews = available.get(preferredId) || available.values().next().value;
  $('#comparison-event').innerHTML = [...available.values()]
    .map(
      (event) =>
        `<option value="${escapeHtml(event.id)}">${escapeHtml(event.id + ' · ' + event.title)}</option>`
    )
    .join('');
  $('#comparison-event').value = comparisonNews.id;
}

function comparisonResult(row, event) {
  if (row.loading) return '<div class="comparison-pending" role="status">Загружаем оценку…</div>';
  if (row.error)
    return `<div class="comparison-error"><strong>Не удалось загрузить</strong>
    <p>Данные этой компании недоступны. Остальные оценки показаны.</p>
    <button class="inline-link" data-retry-comparison="${escapeHtml(row.company.id)}" ${comparisonBusy ? 'disabled' : ''}>Повторить ${icon('arrow-right')}</button></div>`;
  const found = event && row.events?.find((item) => item.id === event.id);
  const a = found?.assignments[row.company.id];
  if (!a)
    return `<div class="comparison-absent"><strong>Не показано в ленте</strong>
    <p>API не вернул эту новость для компании. Балл и причины недоступны; это не нулевая оценка.</p></div>`;
  return `<div class="comparison-score"><strong>${formatScore(a.score)}</strong><span>${escapeHtml(a.placement)}</span></div>
    <span class="content-origin">Объяснение сервиса</span>
    <p class="comparison-explanation">${formatLines(a.explanation)}</p>
    ${a.rules.includes('SUPPLIER_CONCENTRATION') ? '<p class="comparison-caveat">В профиле доступны доли платежей, а не закупок.</p>' : ''}
    <div class="evidence-tags">${a.rules.map((rule) => `<span class="evidence-tag">${escapeHtml(ruleLabels[rule] || rule)}</span>`).join('')}</div>
    <div class="comparison-products"><span>Продукты для обсуждения</span><p>${a.products.length ? escapeHtml(a.products.join(' · ')) : 'Не предложены'}</p></div>`;
}

function renderComparison() {
  const event = comparisonNews;
  $('#comparison-grid').setAttribute('aria-busy', String(comparisonBusy));
  $('#comparison-event').disabled = !event;
  $('#comparison-refresh').disabled = comparisonBusy;
  $('#comparison-context').textContent = event ? event.rawText : 'Нет событий для сравнения.';
  $('#comparison-grid').innerHTML = comparisonRows
    .map((row) => {
      return `<article class="comparison-card ${row.company.id === state.company.id ? 'current' : ''}">
      <div class="comparison-company"><span class="company-monogram">${escapeHtml(row.company.monogram)}</span><div><h3>${escapeHtml(row.company.name)}</h3><span>${escapeHtml(row.company.id)}${row.company.id === state.company.id ? ' · текущая' : ''}</span></div></div>
      ${comparisonResult(row, event)}
    </article>`;
    })
    .join('');
  $('#comparison-status').textContent = comparisonBusy
    ? 'Загружаем ленты компаний…'
    : comparisonRows.some((row) => row.error)
      ? 'Сравнение загружено частично. Повторите запрос для недоступных компаний.'
      : 'Оценки и объяснения из персональных лент. Баллы не пересчитываются.';
}

async function loadComparison(ids) {
  const version = ++comparisonVersion;
  comparisonRequest?.abort();
  comparisonRequest = new AbortController();
  const signal = comparisonRequest.signal;
  comparisonBusy = true;
  comparisonRows.forEach((row) => {
    if (ids.includes(row.company.id)) {
      row.loading = true;
      row.error = false;
    }
  });
  renderComparison();
  await Promise.all(
    comparisonRows
      .filter((row) => ids.includes(row.company.id))
      .map(async (row) => {
        try {
          const feed = await AlfaApi.getFeed(row.company.id, signal);
          if (version !== comparisonVersion || !$('#comparison-dialog').open) return;
          row.events = feed;
          row.error = false;
        } catch (error) {
          if (version !== comparisonVersion || signal.aborted) return;
          row.error = true;
          row.events = null;
        }
        if (version === comparisonVersion && $('#comparison-dialog').open) {
          row.loading = false;
          renderComparisonOptions(comparisonNews?.id);
          renderComparison();
        }
      })
  );
  if (version !== comparisonVersion || !$('#comparison-dialog').open) return;
  comparisonBusy = false;
  renderComparison();
}

function openComparison(eventId) {
  if (state.loading || state.error || !state.company) return;
  closePopovers();
  $('#detail-dialog').close();
  $('#utility-dialog').close();
  comparisonRows = companies.map((company) => ({
    company,
    events: null,
    loading: true,
    error: false,
  }));
  renderComparisonOptions(eventId);
  $('#comparison-dialog').showModal();
  document.body.style.overflow = 'hidden';
  loadComparison(companies.map((company) => company.id));
}

$('#filter-toggle').addEventListener('click', () => {
  const open = $('#advanced-filters').hidden;
  $('#advanced-filters').hidden = !open;
  $('#filter-toggle').setAttribute('aria-expanded', String(open));
});
for (const field of ['from', 'to', 'topic', 'product']) {
  $('#filter-' + field).addEventListener('change', (event) => {
    state.filters[field] = event.target.value;
    renderEvents();
  });
}
$('#filters-reset').addEventListener('click', () => {
  resetAdvancedFilters();
  renderEvents();
});
$('#active-filters').addEventListener('click', (event) => {
  const button = event.target.closest('[data-clear-filter]');
  if (!button) return;
  state.filters[button.dataset.clearFilter] = '';
  $('#filter-' + button.dataset.clearFilter).value = '';
  renderEvents();
  $('#filter-toggle').focus();
});
$('#select-visible').addEventListener('change', (event) => {
  for (const item of getFilteredEvents()) {
    if (event.target.checked) state.checked.add(item.id);
    else state.checked.delete(item.id);
  }
  renderEvents();
});
$('#event-grid').addEventListener('change', (event) => {
  const id = event.target.dataset.selectEvent;
  if (!id) return;
  if (event.target.checked) state.checked.add(id);
  else state.checked.delete(id);
  event.target.closest('.event-card').classList.toggle('is-selected', event.target.checked);
  renderWorkbench();
});
$('#clear-selection').addEventListener('click', () => {
  state.checked.clear();
  renderEvents();
});
$('#selection-export').addEventListener('click', () => openExport());
$('#export-open').addEventListener('click', () => openExport());
$('#compare-open').addEventListener('click', () => openComparison(getFilteredEvents()[0]?.id));
$('#utility-body').addEventListener('click', (event) => {
  const button = event.target.closest('[data-download]');
  if (button) downloadExport(button.dataset.download);
});
$('#comparison-event').addEventListener('change', (event) => {
  renderComparisonOptions(event.target.value);
  renderComparison();
});
$('#comparison-refresh').addEventListener('click', () =>
  loadComparison(companies.map((company) => company.id))
);
$('#comparison-grid').addEventListener('click', (event) => {
  const button = event.target.closest('[data-retry-comparison]');
  if (button && !comparisonBusy) loadComparison([button.dataset.retryComparison]);
});
$('#comparison-close').addEventListener('click', () => $('#comparison-dialog').close());
$('#comparison-dialog').addEventListener('close', () => {
  ++comparisonVersion;
  comparisonRequest?.abort();
  comparisonBusy = false;
});
