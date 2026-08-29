// tabs.js — bascule d'onglets.

Object.assign(UI, {
  bindTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        // Le rapport de charge dépend des volumes/épingles/groupes, modifiables
        // depuis d'autres onglets : on le recalcule à chaque fois qu'on le regarde.
        if (btn.dataset.tab === 'profs') this.renderLoadReport();
        // Les formulaires de contraintes (profs/matières/classes) dépendent
        // des autres onglets aussi : un prof ajouté après le premier rendu ne
        // doit pas rester absent des sélecteurs tant qu'on ne revient pas ici.
        if (btn.dataset.tab === 'constraints') this.renderConstraints();
      });
    });
  },
});
