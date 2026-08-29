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

    document.getElementById('copy-btn').addEventListener('click', () => {
      const text = this.buildScheduleText();
      const status = document.getElementById('solver-status');
      if (!text) {
        status.className = 'status err';
        status.textContent = 'Rien à copier : génère (ou répare) un emploi du temps d\'abord.';
        return;
      }
      navigator.clipboard.writeText(text).then(() => {
        status.className = 'status ok';
        status.textContent = 'Emploi du temps (texte) copié dans le presse-papiers.';
      }).catch(() => {
        status.className = 'status err';
        status.textContent = 'Échec de la copie (presse-papiers refusé par le navigateur).';
      });
    });

    this.updateRepairButton();
  },

  // Rendu texte brut de toutes les classes (+ réunions sans classe) d'un coup —
  // pensé pour être collé ailleurs (chat, ticket) afin de déboguer ensemble.
  // Utilise state.schedule si un emploi du temps complet existe, sinon le
  // dernier essai partiel (lastPartial) s'il y en a un, pour ne jamais copier
  // du vide alors qu'un résultat exploitable est affiché à l'écran.
  buildScheduleText() {
    const schedule = this.state.schedule || this.lastPartial?.schedule;
    if (!schedule || Object.keys(schedule).length === 0) return '';

    const { days, slots } = this.state.config;
    const activeDays = this.activeDayIndices();
    const cellLabel = (cell) => {
      if (!cell) return '(libre)';
      const names = (cell.profIds || [cell.profId])
        .map(pid => this.state.profs.find(p => p.id === pid)?.name || pid)
        .join(', ');
      return `${cell.subj} — ${names || '—'}`;
    };

    const blocks = [];
    const renderBlock = (title, keyFor) => {
      const lines = [`=== ${title} ===`];
      slots.forEach((sl, si) => {
        activeDays.forEach(di => {
          lines.push(`${days[di]} ${sl.start}–${sl.end} : ${cellLabel(schedule[keyFor(di, si)])}`);
        });
      });
      blocks.push(lines.join('\n'));
    };

    this.state.config.classes.forEach(cls => renderBlock(`Classe ${cls}`, (d, s) => `${cls}|${d}|${s}`));
    this.meetingsWithoutClass().forEach(m => renderBlock(`Réunion — ${m.name}`, (d, s) => `@meeting:${m.id}|${d}|${s}`));

    return blocks.join('\n\n');
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
        this.meetingsWithoutClass().forEach(m => cont.appendChild(this.buildMeetingBlock(m)));
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
        this.meetingsWithoutClass().forEach(m => cont.appendChild(this.buildMeetingBlock(m, schedule)));
      }
      return;
    }

    cont.innerHTML = '<p class="hint">Aucun emploi du temps généré. Clique sur "Générer".</p>';
  },

  // Réunions n'impliquant aucune classe réelle : elles vivent sous une clé
  // fictive "@meeting:<id>" (voir buildContext dans solver.js) et n'apparaissent
  // donc jamais via buildClassBlock — il leur faut leur propre bloc d'affichage.
  meetingsWithoutClass() {
    return (this.state.constraints.meetings || []).filter(m => !m.classes || m.classes.length === 0);
  },

  buildMeetingBlock(meeting, schedule = this.state.schedule) {
    const pseudoKey = `@meeting:${meeting.id}`;
    const wrap = document.createElement('div');
    wrap.className = 'class-block';
    const h = document.createElement('h3');
    h.textContent = 'Réunion — ' + meeting.name;
    wrap.appendChild(h);
    const grid = this.buildScheduleGrid((d, s) => {
      const cell = schedule[`${pseudoKey}|${d}|${s}`];
      if (!cell) return null;
      const names = (cell.profIds || [cell.profId])
        .map(pid => this.state.profs.find(p => p.id === pid)?.name || pid)
        .join(', ');
      return { top: meeting.name, bottom: names, pinned: false };
    });
    // Lecture seule : le swap ne sait pas gérer les cellules multi-profs sans classe.
    wrap.appendChild(grid);
    return wrap;
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
      const profIds = cell.profIds || [cell.profId];
      const names = profIds.map(pid => this.state.profs.find(p => p.id === pid)?.name || pid).join(', ');
      return { top: cell.subj, bottom: names || '—', pinned: !!cell.pinned };
    });
    // Marque chaque cellule avec sa classe : le swap peut être cross-classe.
    grid.querySelectorAll('.cell-sched').forEach(td => {
      td.dataset.cls = cls;
      const key = `${cls}|${td.dataset.d}|${td.dataset.s}`;
      const cell = schedule[key];
      if (cell?.pinned) td.classList.add('pinned');
      // Épingle, lecture seule, ou cellule multi-profs (réunion/cours co-enseigné) :
      // le swap suppose un seul prof par cellule, donc pas de swap ici.
      if (readOnly || cell?.pinned || cell?.meeting) return;
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
    // Une réunion sans classe vit sous une clé fictive "@meeting:<id>" (voir
    // buildContext dans solver.js) : il faut aussi la scanner ici pour que ce
    // prof la voie apparaître dans SON emploi du temps.
    const meetingKeys = this.meetingsWithoutClass().map(m => `@meeting:${m.id}`);
    wrap.appendChild(this.buildScheduleGrid((d, s) => {
      // Un prof peut apparaître sur plusieurs classes (épingle/groupe multi-classes)
      // et/ou via une réunion à plusieurs profs obligatoires (cell.profIds).
      const found = [];
      for (const cls of this.state.config.classes.concat(meetingKeys)) {
        const cell = schedule[`${cls}|${d}|${s}`];
        if (cell && (cell.profIds || [cell.profId]).includes(profId)) found.push({ cls, cell });
      }
      if (found.length === 0) return null;
      const pinned = found.some(f => f.cell.pinned);
      return {
        top: found[0].cell.subj,
        bottom: found.map(f => f.cls.startsWith('@meeting:') ? 'réunion' : f.cls).join(', '),
        pinned,
      };
    }));
    return wrap;
  },

  buildScheduleGrid(cellFor) {
    const t = document.createElement('table');
    t.className = 'grid-table';
    const activeDays = new Set(this.activeDayIndices());
    let html = '<thead><tr><th>Créneau</th>';
    this.state.config.days.forEach((d, i) => {
      if (activeDays.has(i)) html += `<th>${d}</th>`;
    });
    html += '</tr></thead><tbody>';
    this.state.config.slots.forEach((sl, si) => {
      html += `<tr><td class="slot-label">${sl.start}–${sl.end}</td>`;
      this.state.config.days.forEach((_, di) => {
        if (!activeDays.has(di)) return;
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
