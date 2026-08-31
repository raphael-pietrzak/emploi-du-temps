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
    this.bindCapture();
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
    if (!this.state.volumesA) this.state.volumesA = {};
    if (!this.state.volumesB) this.state.volumesB = {};
    if (!this.state.savedSchedules) this.state.savedSchedules = [];
    if (!this.state.version) this.state.version = { major: this.state.savedSchedules.length, minor: 0 };

    // Migration : "éviter les trous chez les élèves" (compact) remplacé par
    // deux leviers indépendants — étaler les classes / grouper les profs —
    // activés par défaut pour tout état existant qui ne les a pas encore.
    if (!this.state.options) this.state.options = {};
    if (this.state.options.spreadForClasses === undefined) this.state.options.spreadForClasses = true;
    if (this.state.options.noGapsForProfs === undefined) this.state.options.noGapsForProfs = true;
    delete this.state.options.noGapsForStudents;

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

  // `kind: 'major'` = nouvelle génération/réparation (major++, minor remis à
  // 0) ; `kind: 'minor'` = modification manuelle de l'emploi du temps déjà
  // généré (échange de cellules). Pas de bump si l'emploi du temps n'existe
  // pas encore (ex. tentative de génération échouée) — une version ne
  // commence à exister que lorsqu'il y a un schedule réel derrière.
  bumpVersion(kind) {
    if (!this.state.schedule) return;
    if (kind === 'major') {
      this.state.version.major++;
      this.state.version.minor = 0;
    } else {
      this.state.version.minor++;
    }
  },

  versionName() {
    const { major, minor } = this.state.version;
    return `v${major}.${minor}`;
  },

  // Affiche un message de statut dans `el` (className = `${baseClass}` ou
  // `${baseClass} ${kind}`). Un statut "ok" (succès) s'efface tout seul après
  // un délai — l'utilisateur veut juste une confirmation furtive, pas un
  // message qui traîne indéfiniment ; un "err"/"warn" (ou statut neutre,
  // kind falsy, ex. "en cours…") reste affiché jusqu'au prochain appel.
  // `el._statusTimer` porte le timer en cours sur l'élément lui-même — un
  // nouvel appel l'annule d'abord, pour qu'un message plus récent ne se
  // fasse jamais effacer par le auto-hide d'un message précédent.
  setStatus(el, kind, text, baseClass = 'status') {
    if (!el) return;
    if (el._statusTimer) {
      clearTimeout(el._statusTimer);
      el._statusTimer = null;
    }
    el.className = kind ? `${baseClass} ${kind}` : baseClass;
    el.textContent = text;
    if (kind === 'ok') {
      el._statusTimer = setTimeout(() => {
        el.textContent = '';
        el.className = baseClass;
        el._statusTimer = null;
      }, 1500);
    }
  },

  // Rendu commun de la colonne "Créneau" des tableaux grille (dispos,
  // créneaux ouverts, emploi du temps) : début et fin empilés sur deux
  // lignes plutôt qu'un "08:20 – 09:20" sur une seule ligne, qui wrappait au
  // milieu du tiret dans une colonne étroite ("08:20 –" puis "09:20" en
  // dessous, coupure moche) — voir `.grid-table td.slot-label` en CSS pour
  // l'empilement proprement dit.
  slotLabelHtml(sl) {
    return `<span class="slot-start">${sl.start}</span><span class="slot-end">${sl.end}</span>`;
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
    this.updateSaveButton();
    this.updateRepairButton();
    this.renderSavedSchedules();
    this.renderSchedule();
  },
};
