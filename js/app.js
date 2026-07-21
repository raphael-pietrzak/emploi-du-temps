// app.js — point d'entrée. Charge l'état, initialise l'UI, sauvegarde à chaque changement.

const THEME_KEY = 'edt_theme';

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = t === 'light' ? 'Sombre' : 'Clair';
}

document.addEventListener('DOMContentLoaded', () => {
  const state = Storage.load() || Storage.defaultState();

  const save = () => Storage.save(state);

  UI.init(state, save);

  // Thème : sombre par défaut, choix persistant.
  const initial = localStorage.getItem(THEME_KEY) || 'dark';
  applyTheme(initial);
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
});
