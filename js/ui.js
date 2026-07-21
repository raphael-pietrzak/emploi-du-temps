// ui.js — rendu de l'interface. Consomme uniquement l'état.
// Contient le drag-to-paint pour les dispos.

const UI = {
  state: null,
  selectedProfId: null,
  onChange: null,

  init(state, onChange) {
    this.state = state;
    this.onChange = onChange;
    this.bindTabs();
    this.bindIO();
    this.bindConfig();
    this.bindProfs();
    this.bindSchedule();
    this.renderAll();
  },

  bindTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      });
    });
  },

  bindIO() {
    document.getElementById('export-btn').addEventListener('click', () => Storage.export(this.state));
    document.getElementById('import-input').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const s = await Storage.import(f);
        Object.assign(this.state, s);
        this.onChange();
        this.renderAll();
        alert('Import réussi.');
      } catch (err) { alert('Import échoué : ' + err.message); }
    });
  },

  // ============= CONFIG =============
  bindConfig() {
    document.getElementById('add-class').addEventListener('click', () => {
      const v = document.getElementById('new-class').value.trim();
      if (!v) return;
      if (this.state.config.classes.includes(v)) return;
      this.state.config.classes.push(v);
      document.getElementById('new-class').value = '';
      this.onChange();
      this.renderConfig();
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
        this.onChange();
        this.renderConfig();
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
        this.onChange();
        this.renderConfig();
        this.renderProfEditor();
      });
    });

    // days toggles
    const dt = document.getElementById('days-toggles');
    dt.innerHTML = '';
    this.state.config.days.forEach((d, i) => {
      const btn = document.createElement('span');
      btn.className = 'day-toggle' + (this.state.config.activeDays[i] ? ' active' : '');
      btn.textContent = d;
      btn.addEventListener('click', () => {
        this.state.config.activeDays[i] = !this.state.config.activeDays[i];
        this.onChange();
        this.renderConfig();
        this.renderProfEditor();
      });
      dt.appendChild(btn);
    });

    // volumes matrix
    this.renderVolumes();

    document.getElementById('opt-no-gaps').checked = !!this.state.options.noGapsForStudents;
  },

  renderVolumes() {
    const c = document.getElementById('volumes-container');
    c.innerHTML = '';
    const { classes, subjects } = this.state.config;
    if (!classes.length || !subjects.length) {
      c.innerHTML = '<p class="hint">Ajoute des classes et matières d\'abord.</p>';
      return;
    }
    const t = document.createElement('table');
    let head = '<thead><tr><th>Matière</th>';
    classes.forEach(cl => head += `<th>${cl}</th>`);
    head += '</tr></thead><tbody>';
    subjects.forEach(sj => {
      head += `<tr><td>${sj}</td>`;
      classes.forEach(cl => {
        const key = `${cl}|${sj}`;
        const v = this.state.volumes[key] || 0;
        head += `<td><input class="vol-input" type="number" min="0" value="${v}" data-key="${key}"></td>`;
      });
      head += '</tr>';
    });
    head += '</tbody>';
    t.innerHTML = head;
    c.appendChild(t);
    t.querySelectorAll('.vol-input').forEach(inp => {
      inp.addEventListener('change', e => {
        const v = parseInt(e.target.value) || 0;
        this.state.volumes[e.target.dataset.key] = v;
        this.onChange();
      });
    });
  },

  // ============= PROFS =============
  bindProfs() {
    document.getElementById('add-prof').addEventListener('click', () => {
      const name = document.getElementById('new-prof').value.trim();
      if (!name) return;
      const id = 'p_' + Date.now();
      const p = {
        id, name,
        subjects: [],
        availability: this.emptyAvailability(),
      };
      this.state.profs.push(p);
      document.getElementById('new-prof').value = '';
      this.selectedProfId = id;
      this.onChange();
      this.renderProfs();
    });
  },

  emptyAvailability() {
    // Par défaut, tout est disponible. L'utilisateur peint les indisponibilités.
    return this.state.config.days.map(() => new Array(this.state.config.slots.length).fill(true));
  },

  renderProfs() {
    const list = document.getElementById('profs-list');
    list.innerHTML = '';
    this.state.profs.forEach(p => {
      const li = document.createElement('li');
      if (p.id === this.selectedProfId) li.classList.add('selected');
      li.innerHTML = `<span>${p.name}</span><button class="del" title="Supprimer">×</button>`;
      li.addEventListener('click', e => {
        if (e.target.classList.contains('del')) return;
        this.selectedProfId = p.id;
        this.renderProfs();
      });
      li.querySelector('.del').addEventListener('click', e => {
        e.stopPropagation();
        if (!confirm(`Supprimer ${p.name} ?`)) return;
        this.state.profs = this.state.profs.filter(x => x.id !== p.id);
        if (this.selectedProfId === p.id) this.selectedProfId = null;
        this.onChange();
        this.renderProfs();
      });
      list.appendChild(li);
    });
    this.renderProfEditor();
  },

  renderProfEditor() {
    const prof = this.state.profs.find(p => p.id === this.selectedProfId);
    document.getElementById('prof-empty').hidden = !!prof;
    document.getElementById('prof-editor').hidden = !prof;
    if (!prof) return;

    // ensure availability shape matches current config
    const nd = this.state.config.days.length;
    const ns = this.state.config.slots.length;
    if (!prof.availability || prof.availability.length !== nd) {
      prof.availability = this.emptyAvailability();
    } else {
      prof.availability.forEach(day => {
        while (day.length < ns) day.push(true);
        while (day.length > ns) day.pop();
      });
    }

    document.getElementById('prof-name-title').textContent = prof.name;
    const nameInp = document.getElementById('prof-name-input');
    nameInp.value = prof.name;
    nameInp.oninput = e => {
      prof.name = e.target.value;
      document.getElementById('prof-name-title').textContent = prof.name;
      const li = document.querySelector('#profs-list li.selected span');
      if (li) li.textContent = prof.name;
      this.onChange();
    };

    // subjects toggles
    const sc = document.getElementById('prof-subjects');
    sc.innerHTML = '';
    this.state.config.subjects.forEach(sj => {
      const c = document.createElement('span');
      c.className = 'chip' + (prof.subjects.includes(sj) ? ' active' : '');
      c.textContent = sj;
      c.addEventListener('click', () => {
        if (prof.subjects.includes(sj)) {
          prof.subjects = prof.subjects.filter(x => x !== sj);
        } else {
          prof.subjects.push(sj);
        }
        this.onChange();
        this.renderProfEditor();
      });
      sc.appendChild(c);
    });

    this.renderAvailGrid(prof);

    document.getElementById('avail-all').onclick = () => {
      prof.availability = this.state.config.days.map(() => new Array(this.state.config.slots.length).fill(true));
      this.onChange();
      this.renderAvailGrid(prof);
    };
    document.getElementById('avail-none').onclick = () => {
      prof.availability = this.state.config.days.map(() => new Array(this.state.config.slots.length).fill(false));
      this.onChange();
      this.renderAvailGrid(prof);
    };
  },

  renderAvailGrid(prof) {
    const wrap = document.getElementById('avail-grid-wrap');
    wrap.innerHTML = '';
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
        const on = prof.availability[di][si];
        html += `<td class="cell-avail ${on ? 'on' : ''}" data-d="${di}" data-s="${si}"></td>`;
      });
      html += '</tr>';
    });
    html += '</tbody>';
    t.innerHTML = html;
    wrap.appendChild(t);

    // Drag-to-paint : on ne peint QUE tant que le bouton reste enfoncé.
    // L'état de peinture est porté par `this._paint` pour survivre aux re-renders.
    const self = this;
    const cells = t.querySelectorAll('.cell-avail');

    const apply = (cell) => {
      if (!self._paint || !self._paint.active) return;
      const d = +cell.dataset.d, s = +cell.dataset.s;
      if (prof.availability[d][s] === self._paint.mode) return;
      prof.availability[d][s] = self._paint.mode;
      cell.classList.toggle('on', self._paint.mode);
    };

    cells.forEach(cell => {
      cell.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        const d = +cell.dataset.d, s = +cell.dataset.s;
        self._paint = { active: true, mode: !prof.availability[d][s], prof };
        apply(cell);
      });
      cell.addEventListener('mouseenter', e => {
        // Sécurité : si le bouton n'est plus enfoncé (relâché hors fenêtre), on stoppe.
        if (self._paint && self._paint.active && (e.buttons & 1) === 0) {
          self._paint.active = false;
          self.onChange();
          return;
        }
        apply(cell);
      });
    });

    // Attache le mouseup global une seule fois pour toute la vie de la page.
    if (!this._paintMouseupBound) {
      this._paintMouseupBound = true;
      document.addEventListener('mouseup', () => {
        if (this._paint && this._paint.active) {
          this._paint.active = false;
          this.onChange();
        }
      });
    }
  },

  // ============= SCHEDULE =============
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
    wrap.appendChild(this.buildScheduleGrid((d, s) => {
      const cell = this.state.schedule[`${cls}|${d}|${s}`];
      if (!cell) return null;
      const prof = this.state.profs.find(p => p.id === cell.profId);
      return { top: cell.subj, bottom: prof ? prof.name : '?' };
    }));
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
      for (const cls of this.state.config.classes) {
        const cell = this.state.schedule[`${cls}|${d}|${s}`];
        if (cell && cell.profId === profId) {
          return { top: cell.subj, bottom: cls };
        }
      }
      return null;
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
          html += `<td class="cell-sched filled"><div class="subject">${c.top}</div><div class="prof">${c.bottom}</div></td>`;
        } else {
          html += `<td class="cell-sched"></td>`;
        }
      });
      html += '</tr>';
    });
    html += '</tbody>';
    t.innerHTML = html;
    return t;
  },

  renderAll() {
    this.renderConfig();
    this.renderProfs();
    this.renderSchedule();
  },
};
