// swap.js — échange interactif de deux cellules dans la grille d'emploi du temps.
// Règles de validité : volumes préservés, disponibilité + non-conflit des profs.

Object.assign(UI, {
  handleSwapClick(td) {
    const cls = td.dataset.cls;
    const d = +td.dataset.d, s = +td.dataset.s;
    const key = `${cls}|${d}|${s}`;
    const cell = this.state.schedule[key];

    if (!this._swap) {
      if (!cell) return;
      this._swap = { cls, d, s };
      td.classList.add('swap-selected');
      this.highlightSwapTargets(cls, d, s);
      return;
    }

    if (this._swap.cls === cls && this._swap.d === d && this._swap.s === s) {
      this.clearSwapHighlight();
      this._swap = null;
      return;
    }

    if (!td.classList.contains('swap-target')) {
      this.clearSwapHighlight();
      this._swap = null;
      return;
    }

    const aKey = `${this._swap.cls}|${this._swap.d}|${this._swap.s}`;
    const a = this.state.schedule[aKey];
    const b = this.state.schedule[key];
    if (b) {
      this.state.schedule[aKey] = b;
      this.state.schedule[key] = a;
    } else {
      delete this.state.schedule[aKey];
      this.state.schedule[key] = a;
    }
    this._swap = null;
    this.onChange();
    this.renderSchedule();
  },

  highlightSwapTargets(clsA, d, s) {
    const cellA = this.state.schedule[`${clsA}|${d}|${s}`];
    if (!cellA) return;
    document.querySelectorAll('#schedule-container .cell-sched').forEach(td => {
      const clsB = td.dataset.cls;
      if (!clsB) return;
      const d2 = +td.dataset.d, s2 = +td.dataset.s;
      if (clsB === clsA && d2 === d && s2 === s) return;
      const cellB = this.state.schedule[`${clsB}|${d2}|${s2}`];
      if (this.canSwap(clsA, d, s, cellA, clsB, d2, s2, cellB)) {
        td.classList.add('swap-target');
      }
    });
  },

  // Un swap A↔B est valide si :
  //  1. Volumes préservés : même classe, OU même matière (si B occupé).
  //     Si B est vide : uniquement même classe (sinon subj_A quitte cls_A sans compensation).
  //  2. prof_A disponible et libre à (d2, s2) — en excluant la cellule B si prof_A y est déjà.
  //  3. Symétrique pour prof_B à (d1, s1) si B est occupé.
  canSwap(clsA, d1, s1, a, clsB, d2, s2, b) {
    // Épingles intouchables, cellules multi-profs (réunion/cours co-enseigné),
    // et cellules alternant semaine A/B : la logique de swap ci-dessous ne
    // gère qu'un seul profId et une seule matière par cellule.
    if (a.pinned || b?.pinned || a.meeting || b?.meeting || a.weekA || a.weekB || b?.weekA || b?.weekB) return false;
    // Règle 1 : volumes.
    if (b) {
      if (clsA !== clsB && a.subj !== b.subj) return false;
    } else {
      if (clsA !== clsB) return false;
    }

    const profA = this.state.profs.find(p => p.id === a.profId);
    if (!profA || !profA.availability?.[d2]?.[s2]) return false;
    // prof_A libre à (d2, s2) : aucune AUTRE classe (≠ clsB) ne l'occupe à ce moment.
    // La cellule (clsB, d2, s2) est ignorée car elle va être remplacée par le swap.
    for (const c of this.state.config.classes) {
      if (c === clsB) continue;
      const cell = this.state.schedule[`${c}|${d2}|${s2}`];
      if (cell && cell.profId === profA.id) return false;
    }

    if (b) {
      const profB = this.state.profs.find(p => p.id === b.profId);
      if (!profB || !profB.availability?.[d1]?.[s1]) return false;
      for (const c of this.state.config.classes) {
        if (c === clsA) continue;
        const cell = this.state.schedule[`${c}|${d1}|${s1}`];
        if (cell && cell.profId === profB.id) return false;
      }
    }
    return true;
  },

  // Même mécanique que handleSwapClick, mais pour la vue "emploi du temps
  // d'un prof" : les cellules y sont indexées par classe comme ailleurs, mais
  // une cellule vide n'a pas de classe associée dans CETTE vue (le prof est
  // juste libre) — highlightProfSwapTargets le résout dynamiquement.
  handleProfSwapClick(td, profId) {
    const cls = td.dataset.cls;
    const d = +td.dataset.d, s = +td.dataset.s;
    const key = `${cls}|${d}|${s}`;
    const cell = this.state.schedule[key];

    if (!this._swap) {
      if (!cell) return;
      this._swap = { cls, d, s };
      td.classList.add('swap-selected');
      this.highlightProfSwapTargets(profId, cls, d, s);
      return;
    }

    if (this._swap.cls === cls && this._swap.d === d && this._swap.s === s) {
      this.clearSwapHighlight();
      this._swap = null;
      return;
    }

    if (!td.classList.contains('swap-target')) {
      this.clearSwapHighlight();
      this._swap = null;
      return;
    }

    const aKey = `${this._swap.cls}|${this._swap.d}|${this._swap.s}`;
    const a = this.state.schedule[aKey];
    const b = this.state.schedule[key];
    if (b) {
      this.state.schedule[aKey] = b;
      this.state.schedule[key] = a;
    } else {
      delete this.state.schedule[aKey];
      this.state.schedule[key] = a;
    }
    this._swap = null;
    this.onChange();
    this.renderSchedule();
  },

  highlightProfSwapTargets(profId, clsA, d, s) {
    const cellA = this.state.schedule[`${clsA}|${d}|${s}`];
    if (!cellA) return;
    document.querySelectorAll('#schedule-container .cell-sched').forEach(td => {
      const d2 = +td.dataset.d, s2 = +td.dataset.s;
      if (d2 === d && s2 === s) return;
      const existingCls = td.dataset.cls;
      if (existingCls) {
        // Cellule où CE prof enseigne déjà (à une autre classe) : cible directe.
        const cellB = this.state.schedule[`${existingCls}|${d2}|${s2}`];
        if (this.canSwap(clsA, d, s, cellA, existingCls, d2, s2, cellB)) {
          td.classList.add('swap-target');
        }
        return;
      }
      // Cellule vide dans la vue de ce prof : soit occupée par une AUTRE
      // classe — donnée par un AUTRE prof, donc invisible dans cette vue —
      // avec la MÊME matière (vrai échange croisé 2↔2, prioritaire : il y a
      // un vrai contenu à échanger là), soit un créneau réellement libre pour
      // clsA (simple déplacement, uniquement en dernier recours : sinon on
      // masquerait l'échange croisé derrière un déplacement trivial qui
      // laisse l'autre classe intacte alors qu'un vrai échange était possible).
      let match = null;
      for (const clsCandidate of this.state.config.classes) {
        if (clsCandidate === clsA) continue;
        const cellB = this.state.schedule[`${clsCandidate}|${d2}|${s2}`];
        if (!cellB) continue; // rien à échanger avec une classe qui n'a rien ici
        if (this.canSwap(clsA, d, s, cellA, clsCandidate, d2, s2, cellB)) {
          match = clsCandidate;
          break;
        }
      }
      if (!match && !this.state.schedule[`${clsA}|${d2}|${s2}`] &&
          this.canSwap(clsA, d, s, cellA, clsA, d2, s2, undefined)) {
        match = clsA;
      }
      if (match) {
        td.dataset.cls = match; // fige la classe cible pour le clic suivant
        td.classList.add('swap-target');
      }
    });
  },

  // Une réunion sans classe vit sous une clé fictive "@meeting:<id>" (voir
  // buildContext dans solver.js) — c'est un créneau à profs multiples, sans
  // matière ni volumes à préserver, donc pas de "swap" au sens de canSwap
  // (qui suppose un seul prof) : juste un DÉPLACEMENT vers un créneau libre
  // où TOUS les profs requis sont à la fois disponibles et non occupés
  // ailleurs (autre classe ou autre réunion) à ce moment-là.
  handleMeetingSwapClick(td, meetingId) {
    const d = +td.dataset.d, s = +td.dataset.s;
    const pseudoKey = `@meeting:${meetingId}`;
    const key = `${pseudoKey}|${d}|${s}`;
    const cell = this.state.schedule[key];

    if (!this._swap) {
      if (!cell) return;
      this._swap = { meetingId, d, s };
      td.classList.add('swap-selected');
      this.highlightMeetingSwapTargets(meetingId, d, s);
      return;
    }

    if (this._swap.meetingId === meetingId && this._swap.d === d && this._swap.s === s) {
      this.clearSwapHighlight();
      this._swap = null;
      return;
    }

    if (!td.classList.contains('swap-target')) {
      this.clearSwapHighlight();
      this._swap = null;
      return;
    }

    const aKey = `${pseudoKey}|${this._swap.d}|${this._swap.s}`;
    const a = this.state.schedule[aKey];
    delete this.state.schedule[aKey];
    this.state.schedule[key] = a;
    this._swap = null;
    this.onChange();
    this.renderSchedule();
  },

  highlightMeetingSwapTargets(meetingId, d, s) {
    const meeting = this.state.constraints.meetings.find(m => m.id === meetingId);
    if (!meeting) return;
    document.querySelectorAll('#schedule-container .cell-sched[data-meeting]').forEach(td => {
      if (td.dataset.meeting !== meetingId) return;
      const d2 = +td.dataset.d, s2 = +td.dataset.s;
      if (d2 === d && s2 === s) return;
      if (this.canMoveMeeting(meeting, d2, s2)) {
        td.classList.add('swap-target');
      }
    });
  },

  // Vrai si le créneau (d2,s2) est ouvert et si TOUS les profs requis par la
  // réunion y sont disponibles et non occupés ailleurs. Ne gère que le cas
  // "déplacer vers une case vide" : la cible ne doit pas déjà porter cette
  // réunion (cellule vide, pas d'autre réunion en même temps).
  canMoveMeeting(meeting, d2, s2) {
    const openSlots = this.state.config.openSlots || [];
    if ((openSlots[d2] || [])[s2] === false) return false;
    if (this.state.schedule[`@meeting:${meeting.id}|${d2}|${s2}`]) return false;

    for (const profId of meeting.profIds) {
      const prof = this.state.profs.find(p => p.id === profId);
      if (!prof || !prof.availability?.[d2]?.[s2]) return false;
      // Classes (dont les réunions co-enseignées AVEC classes, qui écrivent
      // directement sous la clé de la classe comme une session normale).
      for (const c of this.state.config.classes) {
        const cell = this.state.schedule[`${c}|${d2}|${s2}`];
        if (cell && (cell.profIds || [cell.profId]).includes(profId)) return false;
      }
      // Autres réunions SANS classe (clé fictive "@meeting:<id>").
      for (const m of this.state.constraints.meetings || []) {
        if (m.id === meeting.id || (m.classes && m.classes.length > 0)) continue;
        const cell = this.state.schedule[`@meeting:${m.id}|${d2}|${s2}`];
        if (cell && (cell.profIds || [cell.profId]).includes(profId)) return false;
      }
    }
    return true;
  },

  clearSwapHighlight() {
    document.querySelectorAll('.swap-selected, .swap-target').forEach(el => {
      el.classList.remove('swap-selected', 'swap-target');
    });
  },
});
