// app.js — point d'entrée. Charge l'état, initialise l'UI, sauvegarde à chaque changement.

document.addEventListener('DOMContentLoaded', () => {
  const state = Storage.load() || Storage.defaultState();

  const save = () => Storage.save(state);

  UI.init(state, save);
});
