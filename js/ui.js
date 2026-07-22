// ui.js — rendu de l'interface. Consomme uniquement l'état.
// Contient le drag-to-paint pour les dispos.

const UI = {
  state: null,
  selectedProfId: null,
  onChange: null,

  init(state, onChange) {
    this.state = state;
    this.onChange = onChange;
    // Migration : ancien state sans contraintes.
    if (!this.state.constraints) this.state.constraints = { pins: [], timePref: {} };
    if (!this.state.constraints.pins) this.state.constraints.pins = [];
    if (!this.state.constraints.timePref) this.state.constraints.timePref = {};
    this.bindTabs();
    this.bindIO();
    this.bindConfig();
    this.bindProfs();
    this.bindConstraints();
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

    // Les contraintes dépendent des matières/classes/slots/jours.
    this.renderConstraints();
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
        subjectClasses: {},
        availability: this.emptyAvailability(),
      };
      this.state.profs.push(p);
      document.getElementById('new-prof').value = '';
      this.selectedProfId = id;
      this.onChange();
      this.renderProfs();
    });
    this.bindEnterToClick('new-prof', 'add-prof');
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

    // Migration : convertit l'ancien modèle (subjects + classes globales) vers subjectClasses.
    if (!prof.subjectClasses) {
      prof.subjectClasses = {};
      const oldClasses = prof.classes || this.state.config.classes;
      (prof.subjects || []).forEach(sj => {
        prof.subjectClasses[sj] = [...oldClasses];
      });
      delete prof.subjects;
      delete prof.classes;
    }

    // Rendu : une ligne par matière. Case matière + (si active) chips des classes.
    const teachesEl = document.getElementById('prof-teaches');
    teachesEl.innerHTML = '';
    this.state.config.subjects.forEach(sj => {
      const row = document.createElement('div');
      row.className = 'teach-row';
      const active = prof.subjectClasses[sj] !== undefined;

      const subjChip = document.createElement('span');
      subjChip.className = 'chip' + (active ? ' active' : '');
      subjChip.textContent = sj;
      subjChip.addEventListener('click', () => {
        if (prof.subjectClasses[sj] !== undefined) {
          delete prof.subjectClasses[sj];
        } else {
          // Par défaut : uniquement les classes non encore attribuées à un autre prof.
          prof.subjectClasses[sj] = this.state.config.classes.filter(cl =>
            !this.state.profs.some(op =>
              op.id !== prof.id && op.subjectClasses?.[sj]?.includes(cl)
            )
          );
        }
        this.onChange();
        this.renderProfEditor();
      });
      row.appendChild(subjChip);

      if (active) {
        const classesWrap = document.createElement('span');
        classesWrap.className = 'teach-classes';
        this.state.config.classes.forEach(cl => {
          const cc = document.createElement('span');
          const on = prof.subjectClasses[sj].includes(cl);
          const takenBy = this.state.profs.find(op =>
            op.id !== prof.id && op.subjectClasses?.[sj]?.includes(cl)
          );
          cc.className = 'chip mini'
            + (on ? ' active' : '')
            + (takenBy && !on ? ' taken' : '');
          cc.textContent = cl;
          if (takenBy) cc.title = `Déjà attribué à ${takenBy.name}`;
          cc.addEventListener('click', () => {
            const arr = prof.subjectClasses[sj];
            const i = arr.indexOf(cl);
            if (i >= 0) {
              arr.splice(i, 1);
            } else {
              if (takenBy) return; // interdit d'activer une classe déjà prise
              arr.push(cl);
            }
            this.onChange();
            this.renderProfEditor();
          });
          classesWrap.appendChild(cc);
        });
        row.appendChild(classesWrap);
      }

      teachesEl.appendChild(row);
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
      html += `<tr><td class="slot-label">${sl.start} – ${sl.end}</td>`;
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

  // ============= CONSTRAINTS =============
  bindConstraints() {
    // Sélection de classes pour l'épingle : chips cliquables.
    // Sélection du prof : "aucun" ou un des profs éligibles (matière + toutes les classes).
    document.getElementById('add-pin').addEventListener('click', () => {
      const subj = document.getElementById('pin-subj').value;
      const day = +document.getElementById('pin-day').value;
      const slot = +document.getElementById('pin-slot').value;
      const profId = document.getElementById('pin-prof').value || null;
      const classes = Array.from(document.querySelectorAll('#pin-classes .chip.active'))
        .map(el => el.dataset.cls);
      if (!subj) { alert('Choisis une matière.'); return; }
      if (classes.length === 0) { alert('Sélectionne au moins une classe.'); return; }
      if (Number.isNaN(day) || Number.isNaN(slot)) { alert('Choisis un jour et un créneau.'); return; }
      this.state.constraints.pins.push({
        id: 'pin_' + Date.now(),
        subj, classes, day, slot, profId,
      });
      this.onChange();
      this.renderConstraints();
    });
  },

  renderConstraints() {
    const { subjects, classes, days, activeDays, slots } = this.state.config;

    // matière
    const subjSel = document.getElementById('pin-subj');
    const prevSubj = subjSel.value;
    subjSel.innerHTML = '<option value="">Matière…</option>' +
      subjects.map(s => `<option value="${s}">${s}</option>`).join('');
    if (subjects.includes(prevSubj)) subjSel.value = prevSubj;

    // classes (chips multi-sélection)
    const clsWrap = document.getElementById('pin-classes');
    const prevActive = new Set(
      Array.from(clsWrap.querySelectorAll('.chip.active')).map(el => el.dataset.cls)
    );
    clsWrap.innerHTML = '';
    classes.forEach(cl => {
      const chip = document.createElement('span');
      chip.className = 'chip' + (prevActive.has(cl) ? ' active' : '');
      chip.dataset.cls = cl;
      chip.textContent = cl;
      chip.addEventListener('click', () => {
        chip.classList.toggle('active');
        this.updatePinProfOptions();
      });
      clsWrap.appendChild(chip);
    });

    // jour
    const daySel = document.getElementById('pin-day');
    const prevDay = daySel.value;
    daySel.innerHTML = '<option value="">Jour…</option>' +
      days.map((d, i) => activeDays[i] ? `<option value="${i}">${d}</option>` : '').join('');
    if (prevDay !== '' && activeDays[+prevDay]) daySel.value = prevDay;

    // créneau
    const slotSel = document.getElementById('pin-slot');
    const prevSlot = slotSel.value;
    slotSel.innerHTML = '<option value="">Créneau…</option>' +
      slots.map((sl, i) => `<option value="${i}">${sl.start}–${sl.end}</option>`).join('');
    if (prevSlot !== '' && +prevSlot < slots.length) slotSel.value = prevSlot;

    // Re-listener sur subj pour rafraîchir les profs éligibles
    subjSel.onchange = () => this.updatePinProfOptions();
    this.updatePinProfOptions();

    // Liste des épingles existantes
    const list = document.getElementById('pins-list');
    list.innerHTML = '';
    this.state.constraints.pins.forEach(pin => {
      const li = document.createElement('li');
      const prof = pin.profId ? this.state.profs.find(p => p.id === pin.profId) : null;
      const profTxt = prof ? prof.name : 'sans prof';
      li.innerHTML = `<span><strong>${pin.subj}</strong> — ${pin.classes.join(', ')} — ${days[pin.day]} ${slots[pin.slot]?.start || '?'}–${slots[pin.slot]?.end || '?'} — ${profTxt}</span><button title="Retirer">×</button>`;
      li.querySelector('button').addEventListener('click', () => {
        this.state.constraints.pins = this.state.constraints.pins.filter(p => p.id !== pin.id);
        this.onChange();
        this.renderConstraints();
      });
      list.appendChild(li);
    });

    // Préférences horaires
    const tp = document.getElementById('time-pref-container');
    tp.innerHTML = '';
    if (subjects.length === 0) {
      tp.innerHTML = '<p class="hint">Ajoute des matières d\'abord.</p>';
    } else {
      subjects.forEach(sj => {
        const cur = this.state.constraints.timePref[sj] || 'any';
        const row = document.createElement('div');
        row.className = 'timepref-row';
        row.innerHTML = `
          <span class="timepref-name">${sj}</span>
          <span class="timepref-choices">
            ${['early', 'any', 'late'].map(v =>
              `<label class="timepref-choice ${cur === v ? 'active' : ''}"><input type="radio" name="tp-${sj}" value="${v}" ${cur === v ? 'checked' : ''}> ${v === 'early' ? 'Matin' : v === 'late' ? 'Fin de journée' : 'Indifférent'}</label>`
            ).join('')}
          </span>`;
        row.querySelectorAll('input[type=radio]').forEach(r => {
          r.addEventListener('change', () => {
            this.state.constraints.timePref[sj] = r.value;
            this.onChange();
            this.renderConstraints();
          });
        });
        tp.appendChild(row);
      });
    }
  },

  updatePinProfOptions() {
    const subj = document.getElementById('pin-subj').value;
    const classes = Array.from(document.querySelectorAll('#pin-classes .chip.active'))
      .map(el => el.dataset.cls);
    const profSel = document.getElementById('pin-prof');
    const prev = profSel.value;
    // Profs éligibles = ceux qui enseignent subj pour TOUTES les classes cochées.
    let elig = this.state.profs.slice();
    if (subj && classes.length > 0) {
      elig = elig.filter(p =>
        classes.every(cl => (p.subjectClasses?.[subj] || []).includes(cl))
      );
    } else if (subj) {
      elig = elig.filter(p => (p.subjectClasses?.[subj] || []).length > 0);
    }
    profSel.innerHTML = '<option value="">Sans prof (surveillance)</option>' +
      elig.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (elig.some(p => p.id === prev)) profSel.value = prev;
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

  renderAll() {
    this.renderConfig();
    this.renderProfs();
    this.renderConstraints();
    this.renderSchedule();
  },
};
