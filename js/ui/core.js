// core.js — état partagé + init + helpers communs à toutes les sections d'UI.
// Les autres fichiers ui/*.js étendent cet objet via Object.assign(UI, {...}).

const UI = {
  state: null,
  selectedProfId: null,
  onChange: null,

  init(state, onChange) {
    this.state = state;
    this.onChange = onChange;
    this.migrateState();
    this.bindTabs();
    this.bindIO();
    this.bindConfig();
    this.bindProfs();
    this.bindConstraints();
    this.bindSchedule();
    this.renderAll();
  },

  // Met le state à niveau avec la forme attendue par le code actuel. Appelée
  // au chargement ET après un import JSON (`io.js`) — un fichier exporté il y
  // a longtemps doit être rattrapé aux deux occasions, pas seulement au tout
  // premier chargement de la page.
  migrateState() {
    // Migration : ancien state sans contraintes.
    if (!this.state.constraints) this.state.constraints = { pins: [], groups: [] };
    if (!this.state.constraints.pins) this.state.constraints.pins = [];
    if (!this.state.constraints.groups) this.state.constraints.groups = [];
    if (!this.state.constraints.spread) this.state.constraints.spread = [];
    if (!this.state.constraints.meetings) this.state.constraints.meetings = [];

    // Migration : "jours actifs" (booléen par jour) → "créneaux ouverts"
    // (booléen par jour ET créneau), qui permet de fermer une demi-journée
    // (ex: mercredi après-midi) sans faire semblant que tous les profs sont
    // indisponibles. Un ancien jour désactivé devient tous ses créneaux fermés.
    const { config } = this.state;
    const nd = config.days.length, ns = config.slots.length;
    if (!config.openSlots) {
      config.openSlots = config.days.map((_, i) =>
        new Array(ns).fill(config.activeDays ? !!config.activeDays[i] : true)
      );
    }
    delete config.activeDays;
    // Recale la forme si des jours/créneaux ont été ajoutés/retirés entre-temps.
    while (config.openSlots.length < nd) config.openSlots.push(new Array(ns).fill(true));
    config.openSlots.length = nd;
    config.openSlots.forEach(day => {
      while (day.length < ns) day.push(true);
      day.length = ns;
    });
  },

  bindEnterToClick(inputId, buttonId) {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById(buttonId).click();
      }
    });
  },

  // Indices des jours ayant au moins un créneau ouvert — utilisé partout où
  // on affichait avant une colonne par "jour actif" (grille de dispo, épingles,
  // emploi du temps). Un jour entièrement fermé (tous ses créneaux) disparaît
  // de l'affichage, comme le faisait l'ancien "jour désactivé".
  activeDayIndices() {
    const { days, openSlots } = this.state.config;
    return days.map((_, i) => i).filter(i => (openSlots[i] || []).some(Boolean));
  },

  renderAll() {
    this.renderConfig();
    this.renderProfs();
    this.renderConstraints();
    this.renderSchedule();
  },
};
