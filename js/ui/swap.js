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
    // Épingles intouchables.
    if (a.pinned || b?.pinned) return false;
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

  clearSwapHighlight() {
    document.querySelectorAll('.swap-selected, .swap-target').forEach(el => {
      el.classList.remove('swap-selected', 'swap-target');
    });
  },
});
