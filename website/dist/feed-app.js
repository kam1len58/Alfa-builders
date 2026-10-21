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
const newsLabels = {
  N1: {
    title: 'Инфляция в сентябре: 0,35% за месяц',
    category: 'Экономика',
    source: 'Росстат · по тексту подборки',
    image: 'finance.jpg',
    date: '9 октября',
    isoDate: '2026-10-09',
    timestamp: 20261009,
  },
  N2: {
    title: 'Производственный PMI: 49,8 пункта',
    category: 'Производство',
    source: 'S&P Global · по тексту подборки',
    image: 'industry.jpg',
    date: '1 октября',
    isoDate: '2026-10-01',
    timestamp: 20261001,
  },
  N3: {
    title: 'Санкционные и тарифные меры для покупателей нефти',
    category: 'Внешняя торговля',
    source: 'Подготовленная подборка',
    image: 'logistics.jpg',
    date: '15–19 октября',
    isoDate: '2026-10-19',
    timestamp: 20261019,
  },
  N4: {
    title: 'Сообщение о возобновлении поставок дизельного топлива',
    category: 'Топливо',
    source: 'Кремль · по тексту подборки',
    image: 'industry.jpg',
    date: '15 октября',
    isoDate: '2026-10-15',
    timestamp: 20261015,
  },
  N5: {
    title: 'Оценка нефтегазовых доходов бюджета',
    category: 'Бюджет',
    source: 'Reuters · по тексту подборки',
    image: 'finance.jpg',
    date: '15 октября',
    isoDate: '2026-10-15',
    timestamp: 20261015,
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
};
const bundle = window.ALFA_FEED;
if (!bundle?.profiles?.length || !bundle?.news?.length) {
  throw new Error('Не удалось загрузить профили и ленту');
}
const companies = bundle.profiles.map((profile) => ({
  id: profile.synthetic_u,
  profile,
  ...companyLabels[profile.synthetic_u],
  industry: profile.industry,
  products: Object.entries(productLabels)
    .filter(([key]) => profile.bank_products[key] === 1)
    .map(([, name]) => name),
}));
const events = bundle.news.map((news) => ({ ...news, ...newsLabels[news.id] }));
const storedCompany = loadPreference('company', companies[0].id);
const storedSaved = loadPreference('feed-saved-v1', []);
const state = {
  company: companies.find((company) => company.id === storedCompany) || companies[0],
  view: 'overview',
  filter: 'focus',
  search: '',
  sort: 'priority',
  selected: null,
  saved: new Set(Array.isArray(storedSaved) ? storedSaved : []),
  density: loadPreference('density', 'normal'),
};
const companyAssignment = (event) => event.assignments[state.company.id];
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
  $('#all-count').textContent = available.length;
  $('#more-count').textContent = available.length;
  $('#saved-count').textContent = visibleSavedCount();
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
  savePreference('feed-saved-v1', [...state.saved]);
  renderEvents();
  renderCounts();
  if (state.selected === id) renderDetailSave();
}

function renderCompany() {
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
  $('#context-id').textContent = `${company.id} · ${profile.region}`;
  $('#brief-title').innerHTML = company.brief;
  $('#focus-count').textContent = String(focusCount).padStart(2, '0');
  $('.brief-count p').innerHTML =
    `${focusCount === 1 ? 'событие' : focusCount < 5 ? 'события' : 'событий'}<br>в фокусе`;
  $('.brief-index').textContent =
    focusCount > 1 ? `01 — ${String(focusCount).padStart(2, '0')}` : '01';
  $('#brief-description').textContent =
    `В ленте ${events.filter(isVisibleForCompany).length} события с учётом профиля компании. Приоритеты и объяснения — из подготовленной подборки.`;
  $('#company-options').innerHTML = companies
    .map(
      (item) =>
        `<button
  class="company-option ${item.id === company.id ? 'selected' : ''}"
  data-company="${item.id}"
  aria-pressed="${item.id === company.id}"
>
  <span class="company-monogram">${item.monogram}</span
  ><span
    ><strong>${escapeHtml(item.name)}</strong
    ><small>${item.id} · ${escapeHtml(item.profile.region)}</small></span
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
    return scoreDifference || first.id.localeCompare(second.id);
  });
}

function renderEventCard(event, isFirst) {
  const assignment = companyAssignment(event);
  return `<article class="event-card" aria-labelledby="title-${event.id}">
  <button
    class="card-image-button"
    data-event="${event.id}"
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
  <div class="card-body">
    <div class="card-meta">
      <span class="source-label">${event.id} · Из подборки</span
      ><time datetime="${event.isoDate}">${event.date}</time>
    </div>
    <h3 class="card-title" id="title-${event.id}">
      <button data-event="${event.id}">${escapeHtml(event.title)}</button>
    </h3>
    <p class="card-summary source-fragment">${escapeHtml(event.rawText)}${event.isTruncated ? '…' : ''}</p>
    <div class="company-relevance">
      <div class="relevance-label">${icon('link')}Почему важно для компании</div>
      <p>${escapeHtml(assignment.explanation)}</p>
    </div>
    <div class="card-footer">
      <span class="impact neutral"><i></i>${assignment.placement === 'В фокусе' ? 'В фокусе' : 'Общий контекст'}</span
      ><span class="ranking-score" title="Балл релевантности из таблицы. Не вероятность риска."
        >Балл ${formatScore(assignment.score)}</span
      ><button
        class="save-button ${isSaved(event.id) ? 'saved' : ''}"
        data-save="${event.id}"
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
    state.view !== 'overview' || state.filter !== 'focus' || !!state.search;
  if (state.view === 'saved' && !visibleSavedCount()) {
    $('#empty-title').textContent = 'Здесь будет ваша подборка';
    $('#empty-description').textContent =
      'Сохраняйте события выбранной компании, чтобы вернуться к ним позже.';
    $('#reset-filters').textContent = 'Перейти к событиям';
  } else {
    $('#empty-title').textContent = 'Ничего не найдено';
    $('#empty-description').textContent = 'Попробуйте другую тему или измените раздел ленты.';
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

function sourceCards(event) {
  const assignment = companyAssignment(event);
  return `<div class="source-card">
  <div class="source-card-title">Профиль компании<span class="source-symbol">К</span></div>
  <p>${state.company.id} · ${escapeHtml(state.company.industry)}</p>
  <span class="analysis-caption">demo_profiles.json · synthetic_u = ${state.company.id}</span>
</div>
<div class="source-card">
  <div class="source-card-title">Исходный текст новости<span class="source-symbol">Н</span></div>
  <p>${escapeHtml(event.rawText)}</p>
  <span class="analysis-caption"
    >feed_preview.xlsx · Баллы!A${event.scoreRow} · ${event.id}</span
  >
</div>
<div class="source-card">
  <div class="source-card-title">Персональная разметка<span class="source-symbol">Р</span></div>
  <p>Балл ${formatScore(assignment.score)} · ${escapeHtml(assignment.placement)}<br />${formatLines(assignment.explanation)}</p>
  <span class="analysis-caption"
    >feed_preview.xlsx · Почему!A${assignment.sourceRow}:G${assignment.sourceRow}</span
  >
</div>
<p class="source-note">
  В файлах нет ссылок на публикации и аналитических материалов банка. Новость показана в переданном
  виде; факты не проверялись по первоисточнику. Балл определяет порядок, а не вероятность
  наступления риска.
</p>`;
}

function openEvent(id) {
  const event = events.find((event) => event.id === id && isVisibleForCompany(event));
  if (!event) return;
  state.selected = id;
  const assignment = companyAssignment(event);
  closePopovers();
  const concentration = assignment.rules.includes('SUPPLIER_CONCENTRATION');
  $('#detail-body').innerHTML = `<img class="detail-photo" src="./assets/${event.image}" alt="" />
<div class="detail-content">
  <div class="detail-meta">
    <span>${event.id} · ${escapeHtml(event.category)}</span><span>·</span
    ><time>${event.date}</time><span class="detail-rank">Балл ${formatScore(assignment.score)}</span>
  </div>
  <h2 id="detail-title">${escapeHtml(event.title)}</h2>
  <div class="detail-tabbar" role="group" aria-label="Содержание разбора">
    <button class="detail-tab active" data-detail-tab="analysis" aria-pressed="true">
      Событие и контекст</button
    ><button class="detail-tab" data-detail-tab="sources" aria-pressed="false">
      Источники и основания
    </button>
  </div>
  <div id="analysis-panel">
    <section class="analysis-block">
      <h3>Что произошло</h3>
      <p>${escapeHtml(event.rawText)}</p>
      ${event.isTruncated ? '<span class="analysis-caption source-limitation">Текст обрывается в исходной таблице. Продолжение не добавлялось.</span>' : ''}<span class="analysis-caption">${escapeHtml(event.source)}</span>
    </section>
    <section class="analysis-block">
      <h3>Почему событие в вашей ленте</h3>
      <p>${formatLines(assignment.explanation)}</p>
      <div class="evidence-tags">${assignment.rules.map((r) => `<span class="evidence-tag">${escapeHtml(ruleLabels[r] || r)}</span>`).join('')}</div>
      <span class="analysis-caption">Объяснение и балл взяты из подготовленной разметки.</span
      >${concentration ? '<p class="source-caveat">Доли в профиле рассчитаны по доступным платежам, а не по закупкам. Назначение платежей и отрасль части контрагентов неизвестны; причинная связь с событием требует проверки.</p>' : ''}
    </section>
    <section class="next-action">
      <h3>Контекст компании</h3>
      <p>
        ${escapeHtml(state.company.industry)}. ${escapeHtml(state.company.profile.region)}. Группа — ${formatNumber(state.company.profile.affiliation.group_size)}
        ${companyNoun(state.company.profile.affiliation.group_size)}.
      </p>
      <div class="evidence-tags">${state.company.products.map((p) => `<span class="evidence-tag">${escapeHtml(p)}</span>`).join('')}${state.company.profile.ved.has_ved ? '<span class="evidence-tag">ВЭД</span>' : ''}</div>
    </section>
    ${assignment.suggestedProducts ? `<section class="analysis-block"><h3>Продукты для обсуждения</h3><p>${escapeHtml(assignment.suggestedProducts)}</p><span class="analysis-caption">Из колонки «Продукты банка». Это возможные направления, а не сведения о подключённых продуктах.</span></section>` : ''}
    <section class="analysis-block bank-material-status">
      <h3>Аналитика банка</h3>
      <p>Материалы банка к этой подборке не приложены.</p>
    </section>
    <section class="question-panel">
      <h3>Уточнить по событию</h3>
      <button class="question-chip" data-question="basis">
        Почему эта новость показана компании?</button
      ><button class="question-chip" data-question="missing">
        Каких данных не хватает для оценки влияния?
      </button>
      <div class="question-answer" id="question-answer" hidden></div>
    </section>
  </div>
  <div id="sources-panel" hidden>${sourceCards(event)}</div>
</div>`;
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
  const company = state.company,
    profile = company.profile,
    counterparties = profile.counterparties,
    group = profile.affiliation,
    industryPosition = profile.industry_position;
  openUtility(
    'Профиль компании',
    `<div class="profile-eyebrow">${company.id} · ${escapeHtml(profile.city)}</div>
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
  openUtility(
    'Данные и устройство ленты',
    `<div class="source-card">
  <div class="source-card-title">4 профиля компаний</div>
  <p>
    Данные demo_profiles.json: отрасль, выручка, продуктовые флаги, связи и группа. Компании
    обозначены обезличенными ID.
  </p>
</div>
<div class="source-card">
  <div class="source-card-title">5 событий и 20 назначений</div>
  <p>
    Лист «Баллы» задаёт оценки, лист «Почему» — видимость, объяснения и продукты для обсуждения. Они
    используются без пересчёта.
  </p>
</div>
<div class="source-card">
  <div class="source-card-title">Порядок и видимость</div>
  <p>
    «В фокусе» — приоритетный обзор. «Все события» — общий контекст. Записи «скрыть» недоступны в
    ленте и сохранённом для соответствующей компании.
  </p>
</div>
<p class="source-note">
  Четыре текста обрываются в исходном файле; продолжения и ссылки не добавлены. Баллы не являются
  вероятностью риска. Первоисточники, аналитика банка и ответы LLM пока не подключены.
</p>`
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

function selectCompany(id) {
  const company = companies.find((company) => company.id === id);
  if (!company) return;

  state.company = company;
  savePreference('company', id);
  renderCompany();
  renderEvents();
  closePopovers();
  showToast(`Повестка обновлена: ${id}`);
}

function selectFilter(filter) {
  state.filter = filter;
  updateFilterButtons();
  renderEvents();
}

function selectDetailTab(button) {
  document.querySelectorAll('[data-detail-tab]').forEach((tab) => {
    const active = tab === button;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-pressed', String(active));
  });
  $('#analysis-panel').hidden = button.dataset.detailTab !== 'analysis';
  $('#sources-panel').hidden = button.dataset.detailTab !== 'sources';
}

function answerQuestion(question) {
  const event = events.find((event) => event.id === state.selected);
  if (!event) return;

  const assignment = companyAssignment(event);
  const answer = $('#question-answer');
  answer.hidden = false;
  answer.textContent =
    question === 'basis'
      ? `${assignment.explanation} Балл: ${formatScore(assignment.score)}. Основание: feed_preview.xlsx, лист «Почему», строка ${assignment.sourceRow}.`
      : 'Нужны полный текст и ссылка на новость, подтверждение конкретных контрактов и направлений, период платежей и условия финансовых продуктов. Доли платежей не равны долям закупок; наличие продукта не определяет размер обязательств. Это пояснение доступных данных, не ответ LLM.';
}

function setDensity(density) {
  state.density = density;
  savePreference('density', density);
  document.body.classList.toggle('compact', density === 'compact');
  openSettings();
}

function openUserProfile() {
  openUtility(
    'Профиль пользователя',
    '<div class="profile-name">Финансовый директор</div><p>Роль интерфейса для демонстрации обзора. Пользовательские роли в переданных файлах не указаны.</p>'
  );
}

function handlePageClick(event) {
  const target = event.target;
  const button = target.closest(
    '[data-save], [data-event], [data-view], [data-company], [data-filter], [data-detail-tab], [data-question], [data-density], [data-action]'
  );

  if (button) {
    const data = button.dataset;
    if (data.save) toggleSaved(data.save);
    else if (data.event) openEvent(data.event);
    else if (data.view) setView(data.view);
    else if (data.company) selectCompany(data.company);
    else if (data.filter) selectFilter(data.filter);
    else if (data.detailTab) selectDetailTab(button);
    else if (data.question) answerQuestion(data.question);
    else if (data.density) setDensity(data.density);
    else if (data.action === 'sources') openSources();
    else if (data.action === 'settings') openSettings();
    else if (data.action === 'company') openCompany();
    else if (data.action === 'profile') openUserProfile();
    return;
  }

  if (!target.closest('.company-switch-wrap, .notification-wrap')) closePopovers();
  if (!target.closest('.search-wrap, #mobile-search-button')) closeMobileSearch();
}

hydrateIcons();
renderCompany();
document.body.classList.toggle('compact', state.density === 'compact');
const initialView = location.hash.slice(1);
setView(['overview', 'all', 'saved'].includes(initialView) ? initialView : 'overview');

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
    .filter((event) => isVisibleForCompany(event) && companyAssignment(event).placement === 'В фокусе')
    .sort((first, second) => companyAssignment(second).score - companyAssignment(first).score);
  if (focus[0]) openEvent(focus[0].id);
});
$('#reset-filters').addEventListener('click', () => {
  if (state.view === 'saved' && !visibleSavedCount()) {
    setView('all');
    return;
  }
  state.filter = 'all';
  state.search = '';
  $('#search').value = '';
  updateFilterButtons();
  renderEvents();
});
$('#detail-save').addEventListener('click', () => state.selected && toggleSaved(state.selected));
$('#detail-close').addEventListener('click', () => $('#detail-dialog').close());
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
    for (const key of [...state.saved])
      if (key.startsWith(state.company.id + ':')) state.saved.delete(key);
    savePreference('feed-saved-v1', [...state.saved]);
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
