// config.js — onglet Configuration : classes, matières, créneaux, jours, options, matrice de volumes.

Object.assign(UI, {
  bindConfig() {
    document.getElementById('add-class').addEventListener('click', () => {
      const v = document.getElementById('new-class').value.trim();
      if (!v) return;
      if (this.state.config.classes.includes(v)) return;
      this.state.config.classes.push(v);
      // Par défaut : la nouvelle classe est ajoutée à toutes les matières que chaque prof enseigne.
      this.state.profs.forEach(p => {
        if (!p.subjectClasses) return;
        Object.values(p.subjectClasses).forEach(arr => {
          if (!arr.includes(v)) arr.push(v);
        });
      });
      document.getElementById('new-class').value = '';
      this.onChange();
      this.renderConfig();
      this.renderProfEditor();
    });
    document.getElementById('add-subject').addEventListener('click', () => {
      const v = document.getElementById('new-subject').value.trim();
      if (!v) return;
      if (this.state.config.subjects.includes(v)) return;
      this.state.config.subjects.push(v);
      document.getElementById('new-subject').value = '';
      this.onChange();
      this.renderConfig();
    });
    document.getElementById('add-slot').addEventListener('click', () => {
      this.state.config.slots.push({ start: '16:00', end: '16:50' });
      this.onChange();
      this.renderConfig();
      this.renderProfEditor();
    });
    document.getElementById('opt-no-gaps').addEventListener('change', e => {
      this.state.options.noGapsForStudents = e.target.checked;
      this.onChange();
    });

    // Entrée dans un champ = clic sur le bouton d'ajout associé.
    this.bindEnterToClick('new-class', 'add-class');
    this.bindEnterToClick('new-subject', 'add-subject');
  },

  renderConfig() {
    // classes
    const cl = document.getElementById('classes-list');
    cl.innerHTML = '';
    this.state.config.classes.forEach(c => {
      const li = document.createElement('li');
      li.className = 'chip';
      li.innerHTML = `${c} <button title="Supprimer">×</button>`;
      li.querySelector('button').addEventListener('click', () => {
        this.state.config.classes = this.state.config.classes.filter(x => x !== c);
        // Nettoie les références à cette classe côté profs.
        this.state.profs.forEach(p => {
          if (!p.subjectClasses) return;
          Object.keys(p.subjectClasses).forEach(sj => {
            p.subjectClasses[sj] = p.subjectClasses[sj].filter(x => x !== c);
          });
        });
        this.onChange();
        this.renderConfig();
        this.renderProfEditor();
      });
      cl.appendChild(li);
    });

    // subjects
    const sl = document.getElementById('subjects-list');
    sl.innerHTML = '';
    this.state.config.subjects.forEach(s => {
      const li = document.createElement('li');
      li.className = 'chip';
      li.innerHTML = `${s} <button title="Supprimer">×</button>`;
      li.querySelector('button').addEventListener('click', () => {
        this.state.config.subjects = this.state.config.subjects.filter(x => x !== s);
        this.state.profs.forEach(p => {
          if (p.subjectClasses) delete p.subjectClasses[s];
        });
        this.onChange();
        this.renderConfig();
        this.renderProfEditor();
      });
      sl.appendChild(li);
    });

    // slots
    const tb = document.querySelector('#slots-table tbody');
    tb.innerHTML = '';
    this.state.config.slots.forEach((sl, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="time" value="${sl.start}" data-field="start" data-i="${i}"></td>
        <td><input type="time" value="${sl.end}" data-field="end" data-i="${i}"></td>
        <td><button data-del="${i}" title="Supprimer">×</button></td>`;
      tb.appendChild(tr);
    });
    tb.querySelectorAll('input[type=time]').forEach(inp => {
      inp.addEventListener('change', e => {
        const i = +e.target.dataset.i;
        this.state.config.slots[i][e.target.dataset.field] = e.target.value;
        this.onChange();
        this.renderProfEditor();
      });
    });
    tb.querySelectorAll('button[data-del]').forEach(b => {
      b.addEventListener('click', () => {
        this.state.config.slots.splice(+b.dataset.del, 1);
        this.state.profs.forEach(p => {
          if (p.availability) p.availability.forEach(day => day.splice(+b.dataset.del, 1));
        });
        this.state.config.openSlots.forEach(day => day.splice(+b.dataset.del, 1));
        this.onChange();
        this.renderConfig();
        this.renderProfEditor();
      });
    });

    this.renderOpenGrid();

    // volumes matrix
    this.renderVolumes();

    document.getElementById('opt-no-gaps').checked = !!this.state.options.noGapsForStudents;

    // Les contraintes dépendent des matières/classes/slots/jours.
    this.renderConstraints();
  },

  // Grille globale "il y a cours à ce moment-là ?" — ferme des créneaux pour
  // TOUT LE MONDE (toutes classes et profs), au lieu de peindre "indisponible"
  // sur chaque prof individuellement pour un même mercredi après-midi.
  renderOpenGrid() {
    const { days, slots } = this.state.config;
    const nd = days.length, ns = slots.length;
    // Recale la forme si des jours/créneaux ont été ajoutés/retirés (comme
    // pour prof.availability dans renderProfEditor) : nouveaux créneaux ouverts par défaut.
    if (!this.state.config.openSlots) this.state.config.openSlots = [];
    const openSlots = this.state.config.openSlots;
    while (openSlots.length < nd) openSlots.push(new Array(ns).fill(true));
    openSlots.length = nd;
    openSlots.forEach(day => {
      while (day.length < ns) day.push(true);
      day.length = ns;
    });

    const wrap = document.getElementById('open-grid-wrap');
    wrap.innerHTML = '';
    const t = document.createElement('table');
    t.className = 'grid-table open-slots-table';
    let html = '<thead><tr><th>Créneau</th>';
    days.forEach(d => html += `<th>${d}</th>`);
    html += '</tr></thead><tbody>';
    slots.forEach((sl, si) => {
      html += `<tr><td class="slot-label">${sl.start} – ${sl.end}</td>`;
      days.forEach((_, di) => {
        const on = openSlots[di][si];
        html += `<td class="cell-avail ${on ? 'on' : ''}" data-d="${di}" data-s="${si}"></td>`;
      });
      html += '</tr>';
    });
    html += '</tbody>';
    t.innerHTML = html;
    wrap.appendChild(t);

    // Drag-to-paint : même mécanique que la grille de dispo des profs.
    const self = this;
    const cells = t.querySelectorAll('.cell-avail');
    const apply = (cell) => {
      if (!self._paintOpen || !self._paintOpen.active) return;
      const d = +cell.dataset.d, s = +cell.dataset.s;
      if (openSlots[d][s] === self._paintOpen.mode) return;
      openSlots[d][s] = self._paintOpen.mode;
      cell.classList.toggle('on', self._paintOpen.mode);
    };
    cells.forEach(cell => {
      cell.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        const d = +cell.dataset.d, s = +cell.dataset.s;
        self._paintOpen = { active: true, mode: !openSlots[d][s] };
        apply(cell);
      });
      cell.addEventListener('mouseenter', e => {
        if (self._paintOpen && self._paintOpen.active && (e.buttons & 1) === 0) {
          self._paintOpen.active = false;
          self.onChange();
          return;
        }
        apply(cell);
      });
    });

    // Attache le mouseup global une seule fois pour toute la vie de la page
    // (même mécanique que la grille de dispo des profs).
    if (!this._paintOpenMouseupBound) {
      this._paintOpenMouseupBound = true;
      document.addEventListener('mouseup', () => {
        if (this._paintOpen && this._paintOpen.active) {
          this._paintOpen.active = false;
          this.onChange();
        }
      });
    }
  },

  renderVolumes() {
    const c = document.getElementById('volumes-container');
    c.innerHTML = '';
    const { classes } = this.state.config;
    const subjects = this.state.config.subjects; // ordre réel, pour la longueur/ajout
    if (!classes.length || !subjects.length) {
      c.innerHTML = '<p class="hint">Ajoute des classes et matières d\'abord.</p>';
      return;
    }
    // Tri alphabétique à l'affichage seulement (lisibilité) — ne modifie pas
    // this.state.config.subjects, dont l'ordre reste celui d'ajout ailleurs.
    const subjectsSorted = subjects.slice().sort((a, b) => a.localeCompare(b, 'fr'));
    // "Un prof enseigne-t-il (subj, cls) ?" — même logique que le solveur.
    const hasProf = (subj, cls) => this.state.profs.some(p => {
      if (p.subjectClasses) return (p.subjectClasses[subj] || []).includes(cls);
      if (!(p.subjects || []).includes(subj)) return false;
      return p.classes === undefined || p.classes.includes(cls);
    });

    const t = document.createElement('table');
    t.className = 'volumes-table';
    let html = '<thead><tr><th class="subj-col">Matière</th>';
    classes.forEach(cl => html += `<th>${cl}</th>`);
    html += '<th class="total-col">Total</th><th></th></tr></thead><tbody>';
    const colTotals = classes.map(() => 0);
    subjectsSorted.forEach(sj => {
      html += `<tr><td class="subj-col">${sj}</td>`;
      let rowTotal = 0;
      classes.forEach((cl, i) => {
        const key = `${cl}|${sj}`;
        const v = this.state.volumes[key] || 0;
        const va = this.state.volumesA[key] || 0;
        const vb = this.state.volumesB[key] || 0;
        rowTotal += v + (va + vb) / 2;
        colTotals[i] += v + (va + vb) / 2;
        const zeroCls = (v === 0 && !va && !vb) ? ' is-zero' : '';
        const noProfCls = (v > 0 && !hasProf(sj, cl)) ? ' no-prof' : '';
        const title = (v > 0 && !hasProf(sj, cl))
          ? `Aucun prof n'enseigne ${sj} en ${cl}.`
          : 'Clic : +1 (toutes les semaines) · Maj+clic : −1\nCmd+clic : +1 semaine A · Cmd+Maj+clic : −1 semaine A\nAlt+clic : +1 semaine B · Alt+Maj+clic : −1 semaine B';
        const extraParts = [];
        if (va) extraParts.push(`A+${va}`);
        if (vb) extraParts.push(`B+${vb}`);
        const extra = extraParts.length ? `<sub class="vol-extra">${extraParts.join(' ')}</sub>` : '';
        html += `<td><span class="vol-cell${zeroCls}${noProfCls}" data-key="${key}" title="${title}">${v || (extra ? '' : '0')}${extra}</span></td>`;
      });
      html += `<td class="total-cell">${rowTotal || '·'}</td>`;
      html += `<td class="row-action"><button class="copy-row" data-subj="${sj}" title="Copier la 1ʳᵉ valeur non-nulle sur toutes les classes">⇢</button></td>`;
      html += '</tr>';
    });
    // Ligne de totaux par classe
    const grand = colTotals.reduce((a, b) => a + b, 0);
    html += '<tr class="totals-row"><td class="subj-col">Total / classe</td>';
    colTotals.forEach(t => html += `<td class="total-cell">${t || '·'}</td>`);
    html += `<td class="total-cell grand">${grand}</td><td></td></tr>`;
    html += '</tbody>';
    t.innerHTML = html;
    c.appendChild(t);

    const cells = Array.from(t.querySelectorAll('.vol-cell'));
    const weekAvg = key => (this.state.volumes[key] || 0) + ((this.state.volumesA[key] || 0) + (this.state.volumesB[key] || 0)) / 2;
    const recomputeTotals = () => {
      const colT = classes.map(() => 0);
      const rows = t.querySelectorAll('tbody tr:not(.totals-row)');
      rows.forEach(tr => {
        let rowT = 0;
        tr.querySelectorAll('.vol-cell').forEach((el, i) => {
          const v = weekAvg(el.dataset.key);
          rowT += v;
          colT[i] += v;
        });
        tr.querySelector('.total-cell').textContent = rowT || '·';
      });
      const totRow = t.querySelector('tr.totals-row');
      const totCells = totRow.querySelectorAll('.total-cell');
      colT.forEach((v, i) => { totCells[i].textContent = v || '·'; });
      totCells[totCells.length - 1].textContent = colT.reduce((a, b) => a + b, 0);
    };

    // `kind` : 'common' (clic), 'A' (ctrl+clic) ou 'B' (alt+clic) — édite la
    // carte correspondante (volumes / volumesA / volumesB) sans jamais avoir
    // à ressaisir les heures communes : elles restent inchangées, seule
    // l'heure spécifique à la semaine visée bouge.
    const mapFor = kind => kind === 'A' ? this.state.volumesA : kind === 'B' ? this.state.volumesB : this.state.volumes;
    const setValue = (el, kind, v) => {
      v = Math.max(0, v);
      const key = el.dataset.key;
      const [cl, sj] = key.split('|');
      mapFor(kind)[key] = v;
      if (v === 0) delete mapFor(kind)[key];
      const vCommon = this.state.volumes[key] || 0;
      const va = this.state.volumesA[key] || 0;
      const vb = this.state.volumesB[key] || 0;
      const extraParts = [];
      if (va) extraParts.push(`A+${va}`);
      if (vb) extraParts.push(`B+${vb}`);
      el.innerHTML = `${vCommon || (extraParts.length ? '' : '0')}${extraParts.length ? `<sub class="vol-extra">${extraParts.join(' ')}</sub>` : ''}`;
      el.classList.toggle('is-zero', vCommon === 0 && !va && !vb);
      const bad = vCommon > 0 && !hasProf(sj, cl);
      el.classList.toggle('no-prof', bad);
      el.title = bad
        ? `Aucun prof n'enseigne ${sj} en ${cl}.`
        : 'Clic : +1 (toutes les semaines) · Maj+clic : −1\nCmd+clic : +1 semaine A · Cmd+Maj+clic : −1 semaine A\nAlt+clic : +1 semaine B · Alt+Maj+clic : −1 semaine B';
      recomputeTotals();
      this.onChange();
    };

    cells.forEach(el => {
      el.addEventListener('click', e => {
        const kind = e.metaKey ? 'A' : e.altKey ? 'B' : 'common';
        const cur = mapFor(kind)[el.dataset.key] || 0;
        setValue(el, kind, cur + (e.shiftKey ? -1 : 1));
      });
    });

    // Copier-ligne : applique la 1ʳᵉ valeur non-nulle de la ligne à toutes les classes.
    t.querySelectorAll('.copy-row').forEach(btn => {
      btn.addEventListener('click', () => {
        const sj = btn.dataset.subj;
        const rowCells = cells.filter(x => x.dataset.key.endsWith('|' + sj));
        const src = rowCells.find(x => (this.state.volumes[x.dataset.key] || 0) > 0);
        if (!src) { alert('Renseigne une valeur > 0 dans la ligne d\'abord.'); return; }
        const val = this.state.volumes[src.dataset.key] || 0;
        rowCells.forEach(x => setValue(x, 'common', val));
      });
    });
  },
});
