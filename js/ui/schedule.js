// schedule.js — onglet Emploi du temps : génération, sélection de vue et rendus (classe / prof / global).

Object.assign(UI, {
  bindSchedule() {
    document.getElementById('generate-btn').addEventListener('click', () => {
      const status = document.getElementById('solver-status');
      status.className = 'status';
      status.textContent = 'Calcul en cours…';
      setTimeout(() => {
        const t0 = performance.now();
        const res = Solver.solve(this.state);
        const dt = Math.round(performance.now() - t0);
        if (res.ok) {
          this.state.schedule = res.schedule;
          status.className = 'status ok';
          status.textContent = `${res.message} (${dt}ms)`;
          this.onChange();
        } else {
          this.state.schedule = null;
          status.className = 'status err';
          status.textContent = res.message;
        }
        this.renderSchedule();
      }, 10);
    });
    document.getElementById('view-select').addEventListener('change', () => this.renderSchedule());
    const rnd = document.getElementById('opt-randomize');
    rnd.checked = !!this.state.options.randomize;
    rnd.addEventListener('change', e => {
      this.state.options.randomize = e.target.checked;
      this.onChange();
    });
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
    if (!this.state.schedule) {
      cont.innerHTML = '<p class="hint">Aucun emploi du temps généré. Clique sur "Générer".</p>';
      return;
    }

    const view = sel.value;
    if (view.startsWith('prof:')) {
      const profId = view.slice(5);
      cont.appendChild(this.buildProfGrid(profId));
    } else if (view.startsWith('class:')) {
      const cls = view.slice(6);
      cont.appendChild(this.buildClassBlock(cls));
    } else {
      this.state.config.classes.forEach(cls => {
        cont.appendChild(this.buildClassBlock(cls));
      });
    }
  },

  buildClassBlock(cls) {
    const wrap = document.createElement('div');
    wrap.className = 'class-block';
    const h = document.createElement('h3');
    h.textContent = 'Classe ' + cls;
    wrap.appendChild(h);
    const grid = this.buildScheduleGrid((d, s) => {
      const cell = this.state.schedule[`${cls}|${d}|${s}`];
      if (!cell) return null;
      const prof = this.state.profs.find(p => p.id === cell.profId);
      return { top: cell.subj, bottom: prof ? prof.name : '—', pinned: !!cell.pinned };
    });
    // Marque chaque cellule avec sa classe : le swap peut être cross-classe.
    grid.querySelectorAll('.cell-sched').forEach(td => {
      td.dataset.cls = cls;
      const key = `${cls}|${td.dataset.d}|${td.dataset.s}`;
      const cell = this.state.schedule[key];
      if (cell?.pinned) {
        td.classList.add('pinned');
        return; // pas de swap sur une épingle
      }
      td.classList.add('swappable');
      td.addEventListener('click', () => this.handleSwapClick(td));
    });
    wrap.appendChild(grid);
    return wrap;
  },

  buildProfGrid(profId) {
    const prof = this.state.profs.find(p => p.id === profId);
    const wrap = document.createElement('div');
    wrap.className = 'class-block';
    const h = document.createElement('h3');
    h.textContent = 'Prof ' + (prof ? prof.name : profId);
    wrap.appendChild(h);
    wrap.appendChild(this.buildScheduleGrid((d, s) => {
      // Un prof peut apparaître sur plusieurs classes (épingle multi-classes).
      const found = [];
      for (const cls of this.state.config.classes) {
        const cell = this.state.schedule[`${cls}|${d}|${s}`];
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
