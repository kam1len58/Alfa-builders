/* Applied before styles load so a saved light theme does not flash dark. */
(() => {
  'use strict';
  const themes = {
    graphite: { name: 'Графит', color: '#111214' },
    daylight: { name: 'Светлая', color: '#f4f5f7' },
    north: { name: 'Север', color: '#101c2c' },
    sage: { name: 'Шалфей', color: '#efeee8' },
    plum: { name: 'Слива', color: '#211b25' },
  };
  const key = 'alfa-insights:theme';
  let selected = 'graphite';
  function read(value) {
    try {
      const parsed = JSON.parse(value);
      return Object.hasOwn(themes, parsed) ? parsed : 'graphite';
    } catch {
      return 'graphite';
    }
  }
  function apply(value) {
    selected = Object.hasOwn(themes, value) ? value : 'graphite';
    document.documentElement.dataset.theme = selected;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', themes[selected].color);
    const trigger = document.getElementById('theme-trigger');
    if (trigger) trigger.title = 'Тема: ' + themes[selected].name;
    for (const input of document.querySelectorAll('input[name="site-theme"]')) {
      input.checked = input.value === selected;
    }
  }
  try {
    selected = read(localStorage.getItem(key));
  } catch {
    /* Storage may be unavailable. */
  }
  apply(selected);
  window.addEventListener('storage', (event) => {
    if (event.key === key || event.key === null) apply(read(event.newValue));
  });
  document.addEventListener('DOMContentLoaded', () => {
    const dialog = document.getElementById('theme-dialog');
    const trigger = document.getElementById('theme-trigger');
    apply(selected);
    trigger.addEventListener('click', () => {
      if (typeof closePopovers === 'function') closePopovers();
      if (typeof closeMobileMenu === 'function') closeMobileMenu();
      if (!dialog.open) dialog.showModal();
      document.body.style.overflow = 'hidden';
      dialog.querySelector('input:checked').focus({ preventScroll: true });
    });
    for (const id of ['theme-close', 'theme-done']) {
      document.getElementById(id).addEventListener('click', () => dialog.close());
    }
    dialog.addEventListener('change', (event) => {
      if (!event.target.matches('input[name="site-theme"]')) return;
      apply(event.target.value);
      let stored = true;
      try {
        localStorage.setItem(key, JSON.stringify(selected));
      } catch {
        stored = false;
      }
      document.getElementById('theme-status').textContent = stored
        ? 'Тема «' + themes[selected].name + '» сохранена.'
        : 'Тема изменена. Браузер не разрешил сохранить выбор.';
    });
    dialog.addEventListener('close', () => {
      if (!document.querySelector('dialog[open]')) document.body.style.overflow = '';
    });
  });
})();
