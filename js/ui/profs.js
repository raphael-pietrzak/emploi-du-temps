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

    document.getElementById('combined-avail-copy-btn').addEventListener('click', () => {
      const text = this.buildCombinedAvailText();
      const status = document.getElementById('combined-avail-copy-status');
      if (!text) {
        this.setStatus(status, 'err', 'Sélectionne au moins un prof avant de copier.', 'hint status');
        return;
      }
      navigator.clipboard.writeText(text).then(() => {
        this.setStatus(status, 'ok', 'Disponibilités combinées (texte) copiées dans le presse-papiers.', 'hint status');
      }).catch(() => {
        this.setStatus(status, 'err', 'Échec de la copie (presse-papiers refusé par le navigateur).', 'hint status');
      });
    });
  },

  emptyAvailability() {
    // Par défaut, tout est disponible. L'utilisateur peint les indisponibilités.
    return this.state.config.days.map(() => new Array(this.state.config.slots.length).fill(true));
  },

  // Nombre d'heures hebdomadaires que l'emploi du temps actuel donne à ce
  // prof (moyenne sur 2 semaines s'il a des cellules alternantes semaine
  // A/B — une cellule alt occupe le créneau une semaine sur deux, donc
  // compte pour 0.5h côté "moyenne par semaine" plutôt que 1h). Retourne
  // null si aucun emploi du temps n'est encore généré (rien à compter).
  profScheduledHours(profId) {
    const schedule = this.state.schedule;
    if (!schedule) return null;
    let total = 0;
    for (const key in schedule) {
      const cell = schedule[key];
      if (!cell) continue;
      if (cell.weekA || cell.weekB) {
        if (cell.weekA && (cell.weekA.profIds || [cell.weekA.profId]).includes(profId)) total += 0.5;
        if (cell.weekB && (cell.weekB.profIds || [cell.weekB.profId]).includes(profId)) total += 0.5;
      } else if ((cell.profIds || [cell.profId]).includes(profId)) {
        total += 1;
      }
    }
    // Arrondi à 0.5h près pour éviter les artefacts flottants (ex: 3 * 0.5 = 1.4999...).
    return Math.round(total * 2) / 2;
  },

  renderProfs() {
    const list = document.getElementById('profs-list');
    list.innerHTML = '';
    // Tri alphabétique à l'affichage seulement — l'ordre réel de state.profs
    // (et donc l'ordre d'ajout) n'est pas modifié.
    const sorted = this.state.profs.slice().sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    sorted.forEach(p => {
      const li = document.createElement('li');
      if (p.id === this.selectedProfId) li.classList.add('selected');
      const hrs = this.profScheduledHours(p.id);
      const hrsTxt = hrs === null ? '' : ` <span class="prof-hours">${hrs}h</span>`;
      li.innerHTML = `<span>${p.name}${hrsTxt}</span><button class="del" title="Supprimer">×</button>`;
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
    this.renderLoadReport();
    this.renderCombinedAvail();
  },

  // Sélection de profs pour la grille de disponibilités combinées ci-dessous
  // (ex. pour choisir un créneau de réunion) — état purement UI, non persisté.
  combinedAvailSelected: new Set(),

  // Par défaut true : exclure aussi les créneaux où un prof sélectionné est
  // déjà occupé dans l'emploi du temps actuel, pas seulement indisponible.
  // Désactivable (case à cocher) pour ne voir que la disponibilité "brute"
  // peinte sur chaque prof, sans tenir compte de l'emploi du temps généré.
  combinedAvailUseSchedule: true,

  combinedAvailIsBusy(profId, d, s) {
    for (const c of this.state.config.classes) {
      const cell = this.state.schedule?.[`${c}|${d}|${s}`];
      if (!cell) continue;
      if (cell.weekA || cell.weekB) {
        if (cell.weekA && (cell.weekA.profIds || [cell.weekA.profId]).includes(profId)) return true;
        if (cell.weekB && (cell.weekB.profIds || [cell.weekB.profId]).includes(profId)) return true;
      } else if ((cell.profIds || [cell.profId]).includes(profId)) return true;
    }
    for (const m of this.state.constraints.meetings || []) {
      if (m.classes && m.classes.length > 0) continue;
      const cell = this.state.schedule?.[`@meeting:${m.id}|${d}|${s}`];
      if (cell && (cell.profIds || [cell.profId]).includes(profId)) return true;
    }
    return false;
  },

  // Texte copiable (presse-papiers) de la grille combinée actuelle — mêmes
  // règles que le rendu (`renderCombinedAvail`) : mêmes profs sélectionnés,
  // même prise en compte (ou non) de l'emploi du temps déjà généré. Les
  // créneaux libres consécutifs d'un même jour sont fusionnés en plage.
  buildCombinedAvailText() {
    if (this.combinedAvailSelected.size === 0) return '';
    const selectedProfs = Array.from(this.combinedAvailSelected)
      .map(id => this.state.profs.find(p => p.id === id))
      .filter(Boolean);
    if (selectedProfs.length === 0) return '';

    const activeDays = this.activeDayIndices();
    const openSlots = this.state.config.openSlots || [];
    const useSchedule = this.combinedAvailUseSchedule;
    const slots = this.state.config.slots;

    let text = `Disponibilités combinées — ${selectedProfs.map(p => p.name).join(', ')}\n`;
    activeDays.forEach(di => {
      const ranges = [];
      let start = null;
      for (let si = 0; si <= slots.length; si++) {
        const open = si < slots.length && (openSlots[di] || [])[si] !== false;
        const free = open && selectedProfs.every(p =>
          p.availability?.[di]?.[si] && (!useSchedule || !this.combinedAvailIsBusy(p.id, di, si))
        );
        if (free && start === null) start = si;
        if (!free && start !== null) {
          ranges.push(`${slots[start].start}–${slots[si - 1].end}`);
          start = null;
        }
      }
      text += `${this.state.config.days[di]}: ${ranges.length ? ranges.join(', ') : '—'}\n`;
    });
    return text;
  },

  renderCombinedAvail() {
    const chipsWrap = document.getElementById('combined-avail-profs');
    const gridWrap = document.getElementById('combined-avail-grid-wrap');
    if (!chipsWrap || !gridWrap) return;

    const toggle = document.getElementById('combined-avail-use-schedule');
    if (toggle) {
      toggle.checked = this.combinedAvailUseSchedule;
      toggle.onchange = () => {
        this.combinedAvailUseSchedule = toggle.checked;
        this.renderCombinedAvail();
      };
    }

    // Nettoie la sélection des profs supprimés entre-temps.
    const validIds = new Set(this.state.profs.map(p => p.id));
    for (const id of this.combinedAvailSelected) {
      if (!validIds.has(id)) this.combinedAvailSelected.delete(id);
    }

    chipsWrap.innerHTML = '';
    const sorted = this.state.profs.slice().sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    sorted.forEach(p => {
      const chip = document.createElement('span');
      chip.className = 'chip' + (this.combinedAvailSelected.has(p.id) ? ' active' : '');
      chip.textContent = p.name;
      chip.addEventListener('click', () => {
        if (this.combinedAvailSelected.has(p.id)) this.combinedAvailSelected.delete(p.id);
        else this.combinedAvailSelected.add(p.id);
        this.renderCombinedAvail();
      });
      chipsWrap.appendChild(chip);
    });

    gridWrap.innerHTML = '';
    if (this.combinedAvailSelected.size === 0) {
      gridWrap.innerHTML = '<p class="hint">Sélectionne au moins un prof ci-dessus.</p>';
      return;
    }

    const selectedIds = Array.from(this.combinedAvailSelected);
    const selectedProfs = selectedIds.map(id => this.state.profs.find(p => p.id === id)).filter(Boolean);
    const isBusy = (profId, d, s) => this.combinedAvailIsBusy(profId, d, s);

    const t = document.createElement('table');
    t.className = 'grid-table';
    const activeDays = new Set(this.activeDayIndices());
    const openSlots = this.state.config.openSlots || [];
    let html = '<thead><tr><th>Créneau</th>';
    this.state.config.days.forEach((d, i) => {
      if (activeDays.has(i)) html += `<th>${d}</th>`;
    });
    html += '</tr></thead><tbody>';
    this.state.config.slots.forEach((sl, si) => {
      html += `<tr><td class="slot-label">${sl.start} – ${sl.end}</td>`;
      this.state.config.days.forEach((_, di) => {
        if (!activeDays.has(di)) return;
        const open = (openSlots[di] || [])[si] !== false;
        if (!open) {
          html += `<td class="cell-avail closed" data-d="${di}" data-s="${si}" title="Fermé"></td>`;
          return;
        }
        const useSchedule = this.combinedAvailUseSchedule;
        const allFree = selectedProfs.every(p => p.availability?.[di]?.[si] && (!useSchedule || !isBusy(p.id, di, si)));
        const title = selectedProfs.map(p => {
          if (!p.availability?.[di]?.[si]) return `${p.name}: indispo`;
          return `${p.name}: ${useSchedule && isBusy(p.id, di, si) ? 'occupé' : 'libre'}`;
        }).join(' · ');
        html += `<td class="cell-avail ${allFree ? 'on' : ''}" data-d="${di}" data-s="${si}" title="${title}"></td>`;
      });
      html += '</tr>';
    });
    html += '</tbody>';
    t.innerHTML = html;
    gridWrap.appendChild(t);
  },

  renderLoadReport() {
    const cont = document.getElementById('load-report-container');
    if (!cont) return;
    if (this.state.profs.length === 0) {
      cont.innerHTML = '<p class="hint">Ajoute des profs d\'abord.</p>';
      return;
    }
    const res = Solver.analyzeProfLoad(this.state);
    if (!res.ok) {
      cont.innerHTML = `<p class="hint">${res.message}</p>`;
      return;
    }
    const statusLabel = { bloquant: 'Bloquant', tendu: 'Tendu', ok: 'OK' };
    let html = '<table class="load-report-table"><thead><tr>'
      + '<th>Prof</th><th>Charge incompressible</th><th>Dispo restante</th><th>Marge</th><th>Statut</th><th>Matières concernées</th>'
      + '</tr></thead><tbody>';
    res.rows.forEach(r => {
      if (r.exclusiveHours === 0) return; // rien d'exclusif chez lui : pas de signal utile ici
      html += `<tr class="load-row-${r.status}">`
        + `<td>${r.name}</td>`
        + `<td>${r.exclusiveHours}h</td>`
        + `<td>${r.netAvailability}</td>`
        + `<td>${r.margin >= 0 ? '+' : ''}${r.margin}</td>`
        + `<td>${statusLabel[r.status]}</td>`
        + `<td class="load-labels">${r.labels.join(', ')}</td>`
        + '</tr>';
    });
    html += '</tbody></table>';
    cont.innerHTML = html;
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

    const hrs = this.profScheduledHours(prof.id);
    document.getElementById('prof-name-title').textContent = prof.name + (hrs !== null ? ` — ${hrs}h/semaine` : '');
    const nameInp = document.getElementById('prof-name-input');
    nameInp.value = prof.name;
    nameInp.oninput = e => {
      prof.name = e.target.value;
      document.getElementById('prof-name-title').textContent = prof.name + (hrs !== null ? ` — ${hrs}h/semaine` : '');
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
    const activeDays = new Set(this.activeDayIndices());
    const isClosed = (d, s) => this.state.config.openSlots?.[d]?.[s] === false;

    let html = '<thead><tr><th>Créneau</th>';
    this.state.config.days.forEach((d, i) => {
      if (activeDays.has(i)) html += `<th>${d}</th>`;
    });
    html += '</tr></thead><tbody>';
    this.state.config.slots.forEach((sl, si) => {
      html += `<tr><td class="slot-label">${sl.start} – ${sl.end}</td>`;
      this.state.config.days.forEach((_, di) => {
        if (!activeDays.has(di)) return;
        if (isClosed(di, si)) {
          html += `<td class="cell-avail closed" data-d="${di}" data-s="${si}" title="Pas cours à ce créneau (fermé pour tout le monde)"></td>`;
          return;
        }
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
    // Les créneaux fermés globalement (.closed) ne sont pas peignables : la
    // disponibilité du prof n'y a aucun effet, le solveur les ignore déjà.
    const self = this;
    const cells = t.querySelectorAll('.cell-avail:not(.closed)');

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
