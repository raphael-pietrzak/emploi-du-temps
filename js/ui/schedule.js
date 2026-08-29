// schedule.js — onglet Emploi du temps : génération, réparation, sélection de vue et rendus (classe / prof / global).

Object.assign(UI, {
  lastPartial: null, // dernier essai partiel (Solver.solve échoué) : { schedule, placements, missing }

  bindSchedule() {
    document.getElementById('generate-btn').addEventListener('click', () => {
      const btn = document.getElementById('generate-btn');
      const status = document.getElementById('solver-status');
      status.className = 'status';
      status.textContent = 'Calcul en cours…';
      btn.disabled = true;
      setTimeout(() => {
        const t0 = performance.now();
        const res = Solver.solve(this.state);
        const dt = Math.round(performance.now() - t0);
        if (res.ok) {
          this.state.schedule = res.schedule;
          this.lastPartial = null;
          status.className = 'status ok';
          status.textContent = `${res.message} (${dt}ms)`;
          this.onChange();
        } else {
          this.state.schedule = null;
          this.lastPartial = res.partial || null;
          status.className = 'status err';
          status.textContent = res.message;
        }
        btn.disabled = false;
        this.updateRepairButton();
        this.renderSchedule();
      }, 10);
    });

    document.getElementById('repair-btn').addEventListener('click', () => {
      if (!this.lastPartial || !this.lastPartial.missing.length) return;
      const status = document.getElementById('solver-status');
      status.className = 'status';
      status.textContent = 'Réparation en cours (recherche locale)…';
      setTimeout(() => {
        const t0 = performance.now();
        const res = Solver.repair(this.state, this.lastPartial);
        const dt = Math.round(performance.now() - t0);
        if (res.ok) {
          this.state.schedule = res.schedule;
          this.lastPartial = null;
          status.className = 'status ok';
          status.textContent = `${res.message} (${dt}ms)`;
          this.onChange();
        } else {
          status.className = 'status err';
          status.textContent = `${res.message} (${dt}ms)`;
        }
        this.updateRepairButton();
        this.renderSchedule();
      }, 10);
    });

    document.getElementById('view-select').addEventListener('change', () => this.renderSchedule());
    this.updateRepairButton();
  },

  updateRepairButton() {
    const btn = document.getElementById('repair-btn');
    if (!btn) return;
    btn.disabled = !(this.lastPartial && this.lastPartial.missing && this.lastPartial.missing.length > 0);
  },

  renderSchedule() {
    // populate view options
    const sel = document.getElementById('view-select');
    const current = sel.value;
    sel.innerHTML = '<option value="all">Toutes les classes</option>';
    this.state.config.classes.forEach(c => {
      const o = document.createElement('option');
      o.value = 'class:' + c; o.textContent = 'Classe ' + c;
      sel.appendChild(o);
    });
    this.state.profs.forEach(p => {
      const o = document.createElement('option');
      o.value = 'prof:' + p.id; o.textContent = 'Prof ' + p.name;
      sel.appendChild(o);
    });
    sel.value = current || 'all';

    const cont = document.getElementById('schedule-container');
    cont.innerHTML = '';
    const view = sel.value;

    if (this.state.schedule) {
      if (view.startsWith('prof:')) {
        cont.appendChild(this.buildProfGrid(view.slice(5)));
      } else if (view.startsWith('class:')) {
        cont.appendChild(this.buildClassBlock(view.slice(6)));
      } else {
        this.state.config.classes.forEach(cls => cont.appendChild(this.buildClassBlock(cls)));
      }
      return;
    }

    // Pas de planning validé, mais un essai partiel disponible (échec de la
    // dernière génération) : on l'affiche quand même, en lecture seule, pour
    // donner une idée concrète de ce qui a pu être casé avant le blocage.
    if (this.lastPartial && this.lastPartial.schedule && Object.keys(this.lastPartial.schedule).length > 0) {
      const banner = document.createElement('p');
      banner.className = 'hint partial-banner';
      banner.textContent = `Essai partiel — ${this.lastPartial.missing.length} heure(s) manquante(s), lecture seule. Clique sur "Réparer" pour tenter de compléter par recherche locale.`;
      cont.appendChild(banner);
      const schedule = this.lastPartial.schedule;
      if (view.startsWith('prof:')) {
        cont.appendChild(this.buildProfGrid(view.slice(5), schedule));
      } else if (view.startsWith('class:')) {
        cont.appendChild(this.buildClassBlock(view.slice(6), schedule, true));
      } else {
        this.state.config.classes.forEach(cls => cont.appendChild(this.buildClassBlock(cls, schedule, true)));
      }
      return;
    }

    cont.innerHTML = '<p class="hint">Aucun emploi du temps généré. Clique sur "Générer".</p>';
  },

  buildClassBlock(cls, schedule = this.state.schedule, readOnly = false) {
    const wrap = document.createElement('div');
    wrap.className = 'class-block';
    const h = document.createElement('h3');
    h.textContent = 'Classe ' + cls;
    wrap.appendChild(h);
    const grid = this.buildScheduleGrid((d, s) => {
      const cell = schedule[`${cls}|${d}|${s}`];
      if (!cell) return null;
      const prof = this.state.profs.find(p => p.id === cell.profId);
      return { top: cell.subj, bottom: prof ? prof.name : '—', pinned: !!cell.pinned };
    });
    // Marque chaque cellule avec sa classe : le swap peut être cross-classe.
    grid.querySelectorAll('.cell-sched').forEach(td => {
      td.dataset.cls = cls;
      const key = `${cls}|${td.dataset.d}|${td.dataset.s}`;
      const cell = schedule[key];
      if (cell?.pinned) td.classList.add('pinned');
      if (readOnly || cell?.pinned) return; // pas de swap en lecture seule ou sur une épingle
      td.classList.add('swappable');
      td.addEventListener('click', () => this.handleSwapClick(td));
    });
    wrap.appendChild(grid);
    return wrap;
  },

  buildProfGrid(profId, schedule = this.state.schedule) {
    const prof = this.state.profs.find(p => p.id === profId);
    const wrap = document.createElement('div');
    wrap.className = 'class-block';
    const h = document.createElement('h3');
    h.textContent = 'Prof ' + (prof ? prof.name : profId);
    wrap.appendChild(h);
    wrap.appendChild(this.buildScheduleGrid((d, s) => {
      // Un prof peut apparaître sur plusieurs classes (épingle/groupe multi-classes).
      const found = [];
      for (const cls of this.state.config.classes) {
        const cell = schedule[`${cls}|${d}|${s}`];
        if (cell && cell.profId === profId) found.push({ cls, cell });
      }
      if (found.length === 0) return null;
      const pinned = found.some(f => f.cell.pinned);
      return {
        top: found[0].cell.subj,
        bottom: found.map(f => f.cls).join(', '),
        pinned,
      };
    }));
    return wrap;
  },

  buildScheduleGrid(cellFor) {
    const t = document.createElement('table');
    t.className = 'grid-table';
    let html = '<thead><tr><th>Créneau</th>';
    this.state.config.days.forEach((d, i) => {
      if (this.state.config.activeDays[i]) html += `<th>${d}</th>`;
    });
    html += '</tr></thead><tbody>';
    this.state.config.slots.forEach((sl, si) => {
      html += `<tr><td class="slot-label">${sl.start}–${sl.end}</td>`;
      this.state.config.days.forEach((_, di) => {
        if (!this.state.config.activeDays[di]) return;
        const c = cellFor(di, si);
        if (c) {
          const pinCls = c.pinned ? ' pinned' : '';
          html += `<td class="cell-sched filled${pinCls}" data-d="${di}" data-s="${si}"><div class="subject">${c.top}</div><div class="prof">${c.bottom}</div></td>`;
        } else {
          html += `<td class="cell-sched" data-d="${di}" data-s="${si}"></td>`;
        }
      });
      html += '</tr>';
    });
    html += '</tbody>';
    t.innerHTML = html;
    return t;
  },
});
