// profs.js — onglet Professeurs : liste, éditeur (matières/classes) et grille de disponibilités (drag-to-paint).

Object.assign(UI, {
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

    // Les indicateurs "no-prof" du tableau de volumes dépendent des subjectClasses.
    if (document.getElementById('volumes-container')) this.renderVolumes();

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
});
