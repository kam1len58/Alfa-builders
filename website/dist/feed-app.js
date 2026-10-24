'use strict';

const companyLabels = {
  U_9250: {
    name: 'Инженерное строительство',
    monogram: 'ИС',
    brief: 'ВЭД, топливо<br>и бюджетные расходы',
  },
  U_258064: {
    name: 'Оптовая торговля напитками',
    monogram: 'ОН',
    brief: 'Спрос, расчёты<br>и контрагенты',
  },
  U_258131: {
    name: 'Оптовая торговля продуктами',
    monogram: 'ОП',
    brief: 'Международные связи<br>и контрагенты',
  },
  U_276153: {
    name: 'Заказчик-застройщик',
    monogram: 'ЗС',
    brief: 'Группа компаний<br>и расчётные связи',
  },
};
const productLabels = {
  has_rko: 'РКО',
  has_loans: 'Кредит',
  has_leasing: 'Лизинг',
  has_factoring: 'Факторинг',
  has_deposit: 'Депозит',
  has_payroll: 'Зарплатный проект',
  has_guarantees: 'Гарантии',
};
const ruleLabels = {
  INFL_COSTS: 'Инфляция и издержки',
  PMI_ORDERS: 'Заказы в производстве и опте',
  SANCTIONS: 'Внешнеторговые ограничения',
  CUSTOMS: 'Таможенные условия',
  SUPPLIER_CONCENTRATION: 'Концентрация исходящих платежей',
  FUEL: 'Топливная составляющая',
  GOV_PROCUREMENT: 'Гипотеза о госзаказе',
  OIL: 'Нефть и газ',
};
let companies = [];
let events = [];
let requestVersion = 0;
let currentRequest;
const storedCompany = loadPreference('company', 'U_9250');
const storedSaved = loadPreference('feed-saved-v1', []);
const state = {
  company: null,
  loading: true,
  error: '',
  view: 'overview',
  filter: 'focus',
  search: '',
  sort: 'priority',
  selected: null,
  checked: new Set(),
  filters: { from: '', to: '', topic: '', product: '' },
  saved: new Set(Array.isArray(storedSaved) ? storedSaved : []),
  density: loadPreference('density', 'normal'),
};
const hiddenAssignment = {
  score: 0,
  placement: 'скрыть',
  rules: [],
  explanation: '',
  suggestedProducts: '',
  products: [],
};
const companyAssignment = (event) => event.assignments[state.company?.id] || hiddenAssignment;
const isVisibleForCompany = (event) => companyAssignment(event).placement !== 'скрыть';
const savedEventKey = (id) => `${state.company.id}:${id}`;
const isSaved = (id) => state.saved.has(savedEventKey(id));
const scoreFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });
const numberFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const percentFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'percent',
  maximumFractionDigits: 2,
});
const formatScore = (value) => scoreFormatter.format(value);
const formatNumber = (value) => numberFormatter.format(value);
const formatPercent = (value) => percentFormatter.format(value);

function companyNoun(count) {
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) return 'компаний';
  if (lastDigit === 1) return 'компания';
  if (lastDigit >= 2 && lastDigit <= 4) return 'компании';
  return 'компаний';
}

const formatLines = (value) => escapeHtml(value).replace(/\n/g, '<br>');
let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 2600);
}

function closePopovers() {
  $('#company-menu').hidden = true;
  $('#company-switch').setAttribute('aria-expanded', 'false');
  $('#notification-menu').hidden = true;
  $('#notification-button').setAttribute('aria-expanded', 'false');
}

function closeMobileMenu() {
  $('#sidebar').classList.remove('open');
  $('#mobile-shade').hidden = true;
  $('#menu-button').setAttribute('aria-expanded', 'false');
}

function closeMobileSearch() {
  $('.search-wrap').classList.remove('expanded');
  $('#mobile-search-button').setAttribute('aria-expanded', 'false');
}

function visibleSavedCount() {
  return events.filter((event) => isVisibleForCompany(event) && isSaved(event.id)).length;
}

function renderCounts() {
  const available = events.filter(isVisibleForCompany);
  const pending = state.loading || state.error;
  $('#all-count').textContent = pending ? '—' : available.length;
  $('#more-count').textContent = pending ? '—' : available.length;
  $('#saved-count').textContent = pending ? '—' : visibleSavedCount();
}

function toggleSaved(id) {
  const key = savedEventKey(id);
  if (state.saved.has(key)) {
    state.saved.delete(key);
    showToast('Событие удалено из сохранённого');
  } else {
    state.saved.add(key);
    showToast('Событие сохранено');
  }
  savePreference('feed-saved-v2:' + AlfaApi.userId(), [...state.saved]);
  renderEvents();
  renderCounts();
  if (state.selected === id) renderDetailSave();
}

function renderCompany() {
  $('#company-switch').disabled = companies.length === 0;
  $('#brief-open').disabled = state.loading || Boolean(state.error);
  const status = $('#connection-status');
  status.dataset.state = state.loading ? 'loading' : state.error ? 'error' : 'ready';
  status.querySelector('span').textContent = state.loading
    ? 'Обновляем подборку'
    : state.error
      ? 'Нет соединения'
      : 'Данные сервиса';
  if (!state.company) {
    $('#company-name').textContent = state.loading ? 'Загрузка компаний' : 'Компании недоступны';
    $('#company-monogram').textContent = '··';
    $('#focus-count').textContent = '—';
    $('#brief-description').textContent = state.loading
      ? 'Загружаем вашу персональную повестку.'
      : 'Не удалось обновить повестку. Повторите загрузку ниже.';
    renderCounts();
    return;
  }
  const company = state.company,
    profile = company.profile,
    focusCount = events.filter((event) => companyAssignment(event).placement === 'В фокусе').length;
  $('#company-name').textContent = company.name;
  $('#company-monogram').textContent = company.monogram;
  $('#context-industry').textContent = company.industry;
  const featured = company.products.filter((product) =>
    ['Кредит', 'Депозит', 'Лизинг', 'Гарантии'].includes(product)
  );
  $('#context-products').textContent =
    featured.slice(0, 3).join(' · ') ||
    (profile.client_type === 'PROSPECT' ? 'Потенциальный клиент' : 'Продукты не отмечены');
  $('#context-id').textContent = `${escapeHtml(company.id)} · ${profile.region}`;
  $('#brief-title').innerHTML = company.brief;
  $('#focus-count').textContent =
    state.loading || state.error ? '—' : String(focusCount).padStart(2, '0');
  $('#brief-open').disabled = state.loading || Boolean(state.error) || focusCount === 0;
  $('.brief-count p').innerHTML =
    `${focusCount === 1 ? 'событие' : focusCount < 5 ? 'события' : 'событий'}<br>в фокусе`;
  $('.brief-index').textContent =
    focusCount > 1 ? `01 — ${String(focusCount).padStart(2, '0')}` : '01';
  $('#brief-description').textContent = state.loading
    ? 'Обновляем события для выбранной компании.'
    : state.error
      ? 'Не удалось обновить повестку. Повторите загрузку ниже.'
      : `В ленте ${NewsTools.eventCount(events.filter(isVisibleForCompany).length)} с учётом профиля компании. Приоритеты и объяснения рассчитаны сервисом.`;
  $('#company-options').innerHTML = companies
    .map(
      (item) =>
        `<button
  class="company-option ${item.id === company.id ? 'selected' : ''}"
  data-company="${escapeHtml(item.id)}"
  aria-pressed="${item.id === company.id}"
>
  <span class="company-monogram">${escapeHtml(item.monogram)}</span
  ><span
    ><strong>${escapeHtml(item.name)}</strong
    ><small>${escapeHtml(item.id)} · ${escapeHtml(item.profile.region)}</small></span
  >${item.id === company.id ? icon('check') : ''}
</button>`
    )
    .join('');
  renderCounts();
}

function getFilteredEvents() {
  const query = state.search.trim().toLocaleLowerCase('ru');
  const filtered = events.filter((event) => {
    if (!isVisibleForCompany(event)) return false;
    if (state.view === 'saved' && !isSaved(event.id)) return false;

    const assignment = companyAssignment(event);
    if (!NewsTools.matches(event, assignment, state.filters)) return false;
    if (state.filter === 'focus' && assignment.placement !== 'В фокусе') return false;
    if (state.filter === 'general' && assignment.placement !== 'Все события') return false;
    if (!query) return true;

    const searchableText = [
      event.title,
      event.rawText,
      event.category,
      assignment.explanation,
      assignment.suggestedProducts,
    ]
      .join(' ')
      .toLocaleLowerCase('ru');
    return searchableText.includes(query);
  });

  return filtered.sort((first, second) => {
    const scoreDifference = companyAssignment(second).score - companyAssignment(first).score;
    if (state.sort === 'date') {
      return second.timestamp - first.timestamp || scoreDifference;
    }
    return scoreDifference || first.order - second.order;
  });
}

function renderEventCard(event, isFirst) {
  const assignment = companyAssignment(event);
  return `<article class="event-card ${state.checked.has(event.id) ? 'is-selected' : ''}" aria-labelledby="title-${escapeHtml(event.id)}">
  <button
    class="card-image-button"
    data-event="${escapeHtml(event.id)}"
    aria-label="Открыть разбор: ${escapeHtml(event.title)}"
  >
    <img
      src="./assets/${event.image}"
      alt=""
      ${isFirst ? 'fetchpriority="high"' : 'loading="lazy"'}
      width="1000"
      height="505"
    /><span class="image-category">${escapeHtml(event.category)}</span
    ><span class="image-arrow">${icon('arrow-up-right')}</span>
  </button>
  <label class="event-select"><input type="checkbox" data-select-event="${escapeHtml(event.id)}" aria-label="Выбрать для экспорта: ${escapeHtml(event.title)}" ${state.checked.has(event.id) ? 'checked' : ''} /></label>
  <div class="card-body">
    <div class="card-meta">
      <span class="source-label">${escapeHtml(event.origin === 'collected' ? (event.sourceUrl ? new URL(event.sourceUrl).hostname : 'Из источника') : event.id + ' · Из подборки')}</span
      ><time datetime="${event.isoDate}">${event.date}</time>
    </div>
    <h3 class="card-title" id="title-${escapeHtml(event.id)}">
      <button data-event="${escapeHtml(event.id)}">${escapeHtml(event.title)}</button>
    </h3>
    <p class="card-summary source-fragment">${escapeHtml(event.rawText)}</p>
    <div class="company-relevance">
      <div class="relevance-label">${icon('link')}Почему важно для компании</div>
      <p>${escapeHtml(event.insight?.analysis.whyImportant.text || assignment.explanation)}</p>
      <div class="relevance-meta">${event.insight ? '<span>Вывод модели</span>' : ''}<button class="relevance-more" data-event="${escapeHtml(event.id)}" ${event.insight ? 'data-open-impact' : ''} aria-label="Подробнее: почему событие важно для компании — ${escapeHtml(event.title)}">Подробнее ${icon('arrow-right')}</button></div>
    </div>
    <div class="card-footer">
      <span class="impact neutral"><i></i>${assignment.placement === 'В фокусе' ? 'В фокусе' : 'Общий контекст'}</span
      ><span class="ranking-score" title="Балл релевантности, рассчитанный сервисом. Не вероятность риска."
        >Балл ${formatScore(assignment.score)}</span
      ><button
        class="save-button ${isSaved(event.id) ? 'saved' : ''}"
        data-save="${escapeHtml(event.id)}"
        aria-label="${isSaved(event.id) ? 'Удалить из сохранённого' : 'Сохранить событие'}: ${escapeHtml(event.title)}"
        aria-pressed="${isSaved(event.id)}"
      >
        ${icon('bookmark')}
      </button>
    </div>
  </div>
</article>`;
}

function renderEvents() {
  renderWorkbench();
  const pending = state.loading || Boolean(state.error);
  $('#event-grid').setAttribute('aria-busy', String(state.loading));
  $('#reset-filters').disabled = state.loading;
  if (pending) {
    $('#event-grid').innerHTML = '';
    $('#section-count').textContent = '—';
    $('#empty-state').hidden = false;
    $('#show-more-wrap').hidden = true;
    $('#empty-title').textContent = state.loading
      ? 'Загружаем вашу повестку'
      : 'Не удалось загрузить данные';
    $('#empty-description').textContent = state.loading
      ? 'Подбираем события для выбранной компании.'
      : state.error;
    $('#reset-filters').textContent = state.loading ? 'Загрузка…' : 'Повторить загрузку';
    return;
  }
  const shown = getFilteredEvents();
  $('#section-count').textContent = shown.length;
  $('#events-heading').textContent =
    state.view === 'saved'
      ? 'Сохранённые события'
      : state.filter === 'focus'
        ? 'В фокусе'
        : state.filter === 'general'
          ? 'Общий контекст'
          : 'События для компании';
  $('#event-grid').innerHTML = shown
    .map((event, index) => renderEventCard(event, index === 0))
    .join('');
  $('#empty-state').hidden = shown.length !== 0;
  $('#show-more-wrap').hidden =
    state.view !== 'overview' ||
    state.filter !== 'focus' ||
    !!state.search ||
    Object.values(state.filters).some(Boolean);
  if (state.view === 'saved' && !visibleSavedCount()) {
    $('#empty-title').textContent = 'Здесь будет ваша подборка';
    $('#empty-description').textContent =
      'Сохраняйте события выбранной компании, чтобы вернуться к ним позже.';
    $('#reset-filters').textContent = 'Перейти к событиям';
  } else if (events.length === 0) {
    $('#empty-title').textContent = 'Событий пока нет';
    $('#empty-description').textContent = 'Сервис пока не вернул событий для этой компании.';
    $('#reset-filters').textContent = 'Обновить подборку';
  } else {
    $('#empty-title').textContent = 'Ничего не найдено';
    $('#empty-description').textContent = $('#filter-error').hidden
      ? 'Измените поиск, период, тему или продукт для обсуждения.'
      : 'Исправьте период в фильтрах или сбросьте его.';
    $('#reset-filters').textContent = 'Сбросить фильтры';
  }
}

function updateFilterButtons() {
  document.querySelectorAll('[data-filter]').forEach((el) => {
    const active = el.dataset.filter === state.filter;
    el.classList.toggle('active', active);
    el.setAttribute('aria-pressed', String(active));
  });
}

function setView(view) {
  if (view === 'company') {
    openCompany();
    closeMobileMenu();
    return;
  }
  state.view = view;
  state.filter = view === 'overview' ? 'focus' : 'all';
  state.search = '';
  $('#search').value = '';
  closePopovers();
  closeMobileMenu();
  closeMobileSearch();
  const labels = {
    overview: ['Обзор руководителя', 'Сегодня важно'],
    all: ['Персональная повестка', 'Все события'],
    saved: ['Ваша подборка', 'Сохранённое'],
  };
  const [eyebrow, title] = labels[view] || labels.overview;
  $('#page-eyebrow').textContent = eyebrow;
  $('#page-title').innerHTML = `${title}<span class="title-dot">.</span>`;
  $('#overview-grid').hidden = view !== 'overview';
  $('#reading-strip').hidden = view === 'saved';
  document.querySelectorAll('[data-view]').forEach((el) => {
    const active = el.dataset.view === view;
    el.classList.toggle('active', active);
    if (active) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  updateFilterButtons();
  renderEvents();
  history.replaceState(null, '', `#${view}`);
}

function renderDetailSave() {
  const saved = isSaved(state.selected);
  $('#detail-save').innerHTML = icon('bookmark');
  $('#detail-save').classList.toggle('saved', saved);
  $('#detail-save').setAttribute(
    'aria-label',
    saved ? 'Удалить из сохранённого' : 'Сохранить событие'
  );
  $('#detail-save').setAttribute('aria-pressed', String(saved));
}

function openEvent(id) {
  const event = events.find((event) => event.id === id && isVisibleForCompany(event));
  if (!event) return;
  state.selected = id;
  closePopovers();
  NewsReader.open(event, state.company);
  renderDetailSave();
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
  $('#detail-dialog').scrollTop = 0;
  document.body.style.overflow = 'hidden';
}

function openUtility(title, content) {
  closePopovers();
  $('#utility-title').textContent = title;
  $('#utility-body').innerHTML = content;
  if (!$('#utility-dialog').open) $('#utility-dialog').showModal();
  document.body.style.overflow = 'hidden';
}

function partnerTable(partners, label) {
  return `<section class="partner-section"><h3>${label}</h3><div class="partner-table">${partners.map((p) => `<div class="partner-row"><div><strong>${escapeHtml(p.id)}</strong><span>${escapeHtml(p.okved_name || 'Профиль контрагента не передан')}</span></div><span>${formatPercent(p.share)}</span></div>`).join('')}</div></section>`;
}

function openCompany() {
  if (state.loading || state.error || !state.company?.profileReady) {
    showToast('Профиль компании пока недоступен. Дождитесь загрузки данных.');
    return;
  }
  const company = state.company,
    profile = company.profile,
    counterparties = profile.counterparties,
    group = profile.affiliation,
    industryPosition = profile.industry_position;
  openUtility(
    'Профиль компании',
    `<div class="profile-eyebrow">${escapeHtml(company.id)} · ${escapeHtml(profile.city)}</div>
<div class="profile-name">${escapeHtml(company.name)}</div>
<dl class="profile-table">
  <div>
    <dt>Основной вид деятельности</dt>
    <dd>${escapeHtml(profile.industry)}</dd>
  </div>
  <div>
    <dt>ОКВЭД</dt>
    <dd>${escapeHtml(profile.okved_code)}</dd>
  </div>
  <div>
    <dt>Выручка</dt>
    <dd>${formatNumber(profile.revenue)}<small>Единицы в файле не указаны</small></dd>
  </div>
  <div>
    <dt>Регион</dt>
    <dd>${escapeHtml(profile.region)}</dd>
  </div>
  <div>
    <dt>Сотрудники</dt>
    <dd>${escapeHtml(profile.workers)}</dd>
  </div>
  <div>
    <dt>Продуктовые признаки</dt>
    <dd>${company.products.length ? escapeHtml(company.products.join(', ')) : 'Положительных флагов нет'}</dd>
  </div>
  <div>
    <dt>Страны ФТС</dt>
    <dd>${profile.ved.country ? escapeHtml(profile.ved.country) : 'Не указаны'}</dd>
  </div>
  <div>
    <dt>Группа компаний</dt>
    <dd>${formatNumber(group.group_size)} ${companyNoun(group.group_size)}<small>${escapeHtml(group.group_id)}</small></dd>
  </div>
  <div>
    <dt>Положение в выборке ОКВЭД</dt>
    <dd>${formatNumber(industryPosition.rank_by_revenue_in_okved)} из ${formatNumber(industryPosition.companies_in_okved)} по выручке</dd>
  </div>
  <div>
    <dt>Доля выручки в выборке ОКВЭД</dt>
    <dd>${formatPercent(industryPosition.share_of_okved_revenue_in_dataset)}<small>Не доля рынка</small></dd>
  </div>
  <div>
    <dt>Контрагенты в платежах</dt>
    <dd>Получатели: ${formatNumber(counterparties.suppliers_count)} · Отправители: ${formatNumber(counterparties.customers_count)}</dd>
  </div>
  <div>
    <dt>Статус</dt>
    <dd>${escapeHtml(profile.client_type)}</dd>
  </div>
</dl>
${partnerTable(counterparties.top_suppliers, 'Крупнейшие получатели платежей')}${partnerTable(counterparties.top_customers, 'Крупнейшие отправители платежей')}
<p class="profile-note">
  ${escapeHtml(counterparties.note)}. Обозначения «поставщики» и «покупатели» в исходном профиле не подтверждают
  назначение платежей.
</p>
<p class="profile-note">
  Краткое название сформировано по отрасли: юридические названия в файле не переданы. В списке
  группы передано ${group.group_companies.length} ID при указанном размере ${group.group_size}; состав
  показан частично. Размер кредитной нагрузки не определяется по наличию кредитного продукта.
</p>`
  );
}

function openSources() {
  if (window.ServicePanels) {
    ServicePanels.sources();
    return;
  }
  openUtility(
    'Данные и устройство ленты',
    `<div class="source-card">
    <div class="source-card-title">Профили компаний</div>
    <p>Отрасль, выручка, продукты, платёжные связи и группа загружаются из сервиса. Компании обозначены обезличенными ID.</p>
  </div>
  <div class="source-card">
    <div class="source-card-title">Персональная лента</div>
    <p>Сервис выбирает новости для компании и передаёт оценки, раздел ленты и сработавшие правила. Карточки показывают эти результаты без пересчёта.</p>
  </div>
  <div class="source-card">
    <div class="source-card-title">Порядок и видимость</div>
    <p>«В фокусе» — приоритетный обзор, «Общий контекст» — остальные доступные события. Сохранённое и поиск работают внутри ленты выбранной компании.</p>
  </div>
  <p class="source-note">Банковская позиция и полный разбор последствий в ответ ленты пока не включены. Сведения из новостей не проверяются сайтом независимо; баллы не являются вероятностью риска.</p>`
  );
}

function openSettings() {
  openUtility(
    'Настройки обзора',
    `<div class="settings-row">
  <strong>Плотность карточек</strong>
  <p>В компактном виде скрывается текст новости; объяснение релевантности остаётся.</p>
  <div class="segmented-control">
    <button
      data-density="normal"
      class="${state.density === 'normal' ? 'active' : ''}"
      aria-pressed="${state.density === 'normal'}"
    >
      Обычная</button
    ><button
      data-density="compact"
      class="${state.density === 'compact' ? 'active' : ''}"
      aria-pressed="${state.density === 'compact'}"
    >
      Компактная
    </button>
  </div>
</div>
<div class="settings-row">
  <strong>Подборка выбранной компании</strong>
  <p>Сохранённые события разделены по компаниям и хранятся в этом браузере.</p>
  <button class="secondary-button" id="clear-saved">Очистить подборку компании</button>
</div>`
  );
}

function makeCompany(profile) {
  const label = companyLabels[profile.synthetic_u];
  return {
    id: profile.synthetic_u,
    name: label?.name || profile.industry || profile.synthetic_u,
    monogram: label?.monogram || 'К',
    brief: label?.brief || 'События<br>для вашего бизнеса',
    industry: profile.industry,
    profile,
    profileReady: false,
    products: [],
  };
}

function loadFailed(error) {
  state.loading = false;
  state.error =
    error.name === 'TimeoutError'
      ? 'Сервис долго не отвечает. Попробуйте повторить загрузку.'
      : 'Не удалось получить данные от сервиса. Повторите загрузку через некоторое время.';
  renderCompany();
  renderEvents();
}

async function initialize() {
  const version = ++requestVersion;
  currentRequest?.abort();
  currentRequest = new AbortController();
  state.loading = true;
  state.error = '';
  state.company = null;
  companies = [];
  events = [];
  renderCompany();
  renderEvents();
  try {
    const session = await AlfaApi.getSession();
    document.querySelector('[data-action="quality"]').hidden = !AlfaApi.can('quality');
    const saved = loadPreference(
      'feed-saved-v2:' + AlfaApi.userId(),
      session.user?.id === 'local-owner' ? storedSaved : []
    );
    state.saved = new Set(Array.isArray(saved) ? saved : []);
    const profiles = await AlfaApi.getCompanies(currentRequest.signal);
    if (version !== requestVersion) return;
    if (!profiles.length) throw new Error('Нет доступных компаний.');
    companies = profiles.map(makeCompany);
    const preferred = companies.find((company) => company.id === storedCompany) || companies[0];
    await selectCompany(preferred.id, true);
  } catch (error) {
    if (version !== requestVersion) return;
    loadFailed(error);
  }
}

async function selectCompany(id, initial = false) {
  const company = companies.find((company) => company.id === id);
  if (!company) return;
  const version = ++requestVersion;
  currentRequest?.abort();
  currentRequest = new AbortController();
  const signal = currentRequest.signal;
  $('#detail-dialog').close();
  $('#utility-dialog').close();
  $('#comparison-dialog').close();
  state.selected = null;
  state.company = company;
  state.loading = true;
  state.error = '';
  company.profileReady = false;
  events = [];
  state.checked.clear();
  resetAdvancedFilters();
  closePopovers();
  renderCompany();
  renderEvents();
  try {
    const [profile, feed] = await Promise.all([
      AlfaApi.getCompany(id, signal),
      AlfaApi.getFeed(id, signal),
    ]);
    await NewsReader.syncFeedback(id);
    if (version !== requestVersion) return;
    company.profile = profile;
    company.profileReady = true;
    company.industry = profile.industry;
    company.products = Object.entries(productLabels)
      .filter(([key]) => profile.bank_products[key] === 1)
      .map(([, name]) => name);
    events = feed;
    renderFilterOptions();
    state.loading = false;
    savePreference('company', id);
    renderCompany();
    renderEvents();
    if (!initial) showToast(`Повестка обновлена: ${id}`);
  } catch (error) {
    if (version !== requestVersion) return;
    currentRequest.abort();
    loadFailed(error);
  }
}

function selectFilter(filter) {
  state.filter = filter;
  updateFilterButtons();
  renderEvents();
}

function setDensity(density) {
  state.density = density;
  savePreference('density', density);
  document.body.classList.toggle('compact', density === 'compact');
  openSettings();
}

function openUserProfile() {
  if (window.ServicePanels) {
    ServicePanels.profile();
    return;
  }
  openUtility(
    'Профиль пользователя',
    '<div class="profile-name">Финансовый директор</div><p>Роль интерфейса для демонстрации обзора. Пользовательские роли в переданных файлах не указаны.</p>'
  );
}

function handlePageClick(event) {
  const target = event.target;
  const button = target.closest(
    '[data-save], [data-event], [data-view], [data-company], [data-filter], [data-density], [data-action]'
  );

  if (button) {
    const data = button.dataset;
    if (data.save) toggleSaved(data.save);
    else if (data.event) {
      openEvent(data.event);
      if (button.hasAttribute('data-open-impact')) NewsReader.selectTab('impact', true);
    } else if (data.view) setView(data.view);
    else if (data.company) selectCompany(data.company);
    else if (data.filter) selectFilter(data.filter);
    else if (data.density) setDensity(data.density);
    else if (data.action === 'sources') openSources();
    else if (data.action === 'settings') openSettings();
    else if (data.action === 'company') openCompany();
    else if (data.action === 'profile') openUserProfile();
    else if (data.action === 'quality') ServicePanels.quality();
    return;
  }

  if (!target.closest('.company-switch-wrap, .notification-wrap')) closePopovers();
  if (!target.closest('.search-wrap, #mobile-search-button')) closeMobileSearch();
}

hydrateIcons();
$('#heading-date').textContent = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  weekday: 'long',
}).format(new Date());
document.body.classList.toggle('compact', state.density === 'compact');
const initialView = location.hash.slice(1);
setView(['overview', 'all', 'saved'].includes(initialView) ? initialView : 'overview');
initialize();

document.addEventListener('click', handlePageClick);
$('#company-switch').addEventListener('click', () => {
  const open = $('#company-menu').hidden;
  closePopovers();
  $('#company-menu').hidden = !open;
  $('#company-switch').setAttribute('aria-expanded', String(open));
});
$('#notification-button').addEventListener('click', () => {
  const open = $('#notification-menu').hidden;
  closePopovers();
  $('#notification-menu').hidden = !open;
  $('#notification-button').setAttribute('aria-expanded', String(open));
});
$('#read-notifications').addEventListener('click', () => {
  $('#notification-dot').hidden = true;
  $('.notification-entry-dot').style.background = '#686f7c';
  savePreference('notificationsRead', true);
  showToast('Все уведомления прочитаны');
});
$('#notification-dot').hidden = loadPreference('notificationsRead', false);
$('#search').addEventListener('input', (event) => {
  state.search = event.target.value;
  renderEvents();
});
$('#mobile-search-button').addEventListener('click', () => {
  const open = $('.search-wrap').classList.toggle('expanded');
  $('#mobile-search-button').setAttribute('aria-expanded', String(open));
  if (open) $('#search').focus();
});
$('#sort').addEventListener('change', (event) => {
  state.sort = event.target.value;
  renderEvents();
});
$('#show-more').addEventListener('click', () => {
  setView('all');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
$('#brief-open').addEventListener('click', () => {
  const focus = events
    .filter(
      (event) => isVisibleForCompany(event) && companyAssignment(event).placement === 'В фокусе'
    )
    .sort((first, second) => companyAssignment(second).score - companyAssignment(first).score);
  if (focus[0]) openEvent(focus[0].id);
});
$('#reset-filters').addEventListener('click', () => {
  if (state.loading) return;
  if (state.error || events.length === 0) {
    if (companies.length && state.company) selectCompany(state.company.id);
    else initialize();
    return;
  }
  if (state.view === 'saved' && !visibleSavedCount()) {
    setView('all');
    return;
  }
  state.filter = 'all';
  state.search = '';
  resetAdvancedFilters();
  $('#search').value = '';
  updateFilterButtons();
  renderEvents();
});
$('#detail-save').addEventListener('click', () => state.selected && toggleSaved(state.selected));
$('#detail-close').addEventListener('click', () => $('#detail-dialog').close());
$('#detail-dialog').addEventListener('close', renderEvents);
$('#utility-close').addEventListener('click', () => $('#utility-dialog').close());
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('close', () => {
    if (!document.querySelector('dialog[open]')) document.body.style.overflow = '';
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        dialog.close();
    }
  });
}
$('#utility-body').addEventListener('click', (event) => {
  if (event.target.closest('#clear-saved')) {
    if (!state.company) {
      showToast('Сначала выберите компанию.');
      return;
    }
    for (const key of [...state.saved])
      if (key.startsWith(state.company.id + ':')) state.saved.delete(key);
    savePreference('feed-saved-v2:' + AlfaApi.userId(), [...state.saved]);
    renderCounts();
    renderEvents();
    showToast('Подборка компании очищена');
  }
});
$('#menu-button').addEventListener('click', () => {
  const open = $('#sidebar').classList.toggle('open');
  $('#mobile-shade').hidden = !open;
  $('#menu-button').setAttribute('aria-expanded', String(open));
});
$('#mobile-shade').addEventListener('click', closeMobileMenu);
window.addEventListener('resize', () => {
  if (window.innerWidth > 600) {
    closeMobileMenu();
    closeMobileSearch();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closePopovers();
    closeMobileMenu();
    closeMobileSearch();
  }
  if (
    event.key === '/' &&
    !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) &&
    !document.querySelector('dialog[open]') &&
    getComputedStyle($('.search-wrap')).display !== 'none'
  ) {
    event.preventDefault();
    $('#search').focus();
  }
});
document.querySelector('.brand').addEventListener('click', (event) => {
  event.preventDefault();
  setView('overview');
});
