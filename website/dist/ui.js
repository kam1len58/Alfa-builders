'use strict';

const icons = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  news: '<path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/><path d="M2 7v12a2 2 0 0 0 2 2h15"/>',
  building: '<path d="M4 21V4h11v17M15 10h5v11M2 21h20M8 8h3M8 12h3M8 16h3M17 14h1M17 17h1"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4Z"/>',
  sources: '<path d="M8 3h8l4 4v14H8zM16 3v5h4M4 7v14M11 12h6M11 16h6"/>',
  settings:
    '<path d="m10 3-.7 2.3-2 .9L5 5.7 3 9l1.7 1.7v2.6L3 15l2 3.3 2.3-.5 2 .9L10 21h4l.7-2.3 2-.9 2.3.5 2-3.3-1.7-1.7v-2.6L21 9l-2-3.3-2.3.5-2-.9L14 3Z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  'arrow-right': '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  'arrow-up-right': '<path d="M6 18 18 6M6 6h12v12"/>',
  briefcase:
    '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12c6 3 12 3 18 0M12 12v4"/>',
  sort: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  link: '<path d="m9 15 6-6M7 16l-1 1a3.5 3.5 0 0 1-5-5l5-5a3.5 3.5 0 0 1 5 0M17 8l1-1a3.5 3.5 0 0 0-5-5l-5 5a3.5 3.5 0 0 0 0 5" transform="translate(2 2)"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.1"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.info}</svg>`;
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
  );
const $ = (selector) => document.querySelector(selector);
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((element) => {
    element.innerHTML = icon(element.dataset.icon);
  });
}
function loadPreference(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(`alfa-insights:${key}`)) ?? fallback;
  } catch {
    return fallback;
  }
}
function savePreference(key, value) {
  try {
    localStorage.setItem(`alfa-insights:${key}`, JSON.stringify(value));
  } catch {
    // В приватном режиме браузер может запретить запись настроек.
  }
}
