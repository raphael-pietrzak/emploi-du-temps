// schedule.js — onglet Emploi du temps : génération, réparation, sélection de vue et rendus (classe / prof / global).

const MAX_SAVED_SCHEDULES = 15;

Object.assign(UI, {
  lastPartial: null, // dernier essai partiel (Solver.solve échoué) : { schedule, placements, missing }
  viewingSavedId: null, // id d'une version sauvegardée en cours de consultation (lecture seule), ou null = état courant

  bindSchedule() {
    document.getElementById('generate-btn').addEventListener('click', () => {
      const btn = document.getElementById('generate-btn');
      const status = document.getElementById('solver-status');
      this.setStatus(status, null, 'Calcul en cours…');
      btn.disabled = true;
      setTimeout(() => {
        const t0 = performance.now();
        const res = Solver.solve(this.state);
        const dt = Math.round(performance.now() - t0);
        if (res.ok) {
          this.state.schedule = res.schedule;
          this.lastPartial = null;
          this.setStatus(status, 'ok', `${res.message} (${dt}ms)`);
          this.onChange();
        } else {
          this.state.schedule = null;
          this.lastPartial = res.partial || null;
          this.setStatus(status, 'err', res.message);
        }
        btn.disabled = false;
        this.viewingSavedId = null;
        this.updateRepairButton();
        this.updateSaveButton();
        this.renderSchedule();
      }, 10);
    });

    document.getElementById('repair-btn').addEventListener('click', () => {
      if (!this.lastPartial || !this.lastPartial.missing.length) return;
      const status = document.getElementById('solver-status');
      this.setStatus(status, null, 'Réparation en cours (recherche locale)…');
      setTimeout(() => {
        const t0 = performance.now();
        const res = Solver.repair(this.state, this.lastPartial);
        const dt = Math.round(performance.now() - t0);
        if (res.ok) {
          this.state.schedule = res.schedule;
          this.lastPartial = null;
          this.setStatus(status, 'ok', `${res.message} (${dt}ms)`);
          this.onChange();
        } else {
          this.setStatus(status, 'err', `${res.message} (${dt}ms)`);
        }
        this.viewingSavedId = null;
        this.updateRepairButton();
        this.updateSaveButton();
        this.renderSchedule();
      }, 10);
    });

    document.getElementById('view-select').addEventListener('change', () => this.renderSchedule());

    document.getElementById('copy-btn').addEventListener('click', () => {
      const text = this.buildScheduleText();
      const status = document.getElementById('solver-status');
      if (!text) {
        this.setStatus(status, 'err', 'Rien à copier : génère (ou répare) un emploi du temps d\'abord.');
        return;
      }
      navigator.clipboard.writeText(text).then(() => {
        this.setStatus(status, 'ok', 'Emploi du temps (texte) copié dans le presse-papiers.');
      }).catch(() => {
        this.setStatus(status, 'err', 'Échec de la copie (presse-papiers refusé par le navigateur).');
      });
    });

    document.getElementById('save-schedule-btn').addEventListener('click', () => {
      if (!this.state.schedule) return;
      if (this.state.savedSchedules.length >= MAX_SAVED_SCHEDULES) {
        alert(`Limite de ${MAX_SAVED_SCHEDULES} versions atteinte — supprime-en une avant d'en sauvegarder une nouvelle.`);
        return;
      }
      const defaultName = new Date().toLocaleString('fr', { dateStyle: 'short', timeStyle: 'short' });
      const name = prompt('Nom de cette version :', defaultName);
      if (name === null) return; // annulé
      this.state.savedSchedules.push({
        id: 'saved_' + Date.now(),
        name: name.trim() || defaultName,
        date: new Date().toISOString(),
        schedule: this.state.schedule,
        message: document.getElementById('solver-status').textContent,
      });
      this.onChange();
      this.renderSavedSchedules();
    });

    this.updateRepairButton();
    this.updateSaveButton();
    this.renderSavedSchedules();
  },

  updateSaveButton() {
    const btn = document.getElementById('save-schedule-btn');
    if (!btn) return;
    btn.disabled = !this.state.schedule;
  },

  renderSavedSchedules() {
    const list = document.getElementById('saved-schedules-list');
    if (!list) return;
    list.innerHTML = '';
    if (this.state.savedSchedules.length === 0) {
      list.innerHTML = '<li class="hint">Aucune version sauvegardée pour l\'instant.</li>';
      return;
    }
    // Plus récentes en premier.
    this.state.savedSchedules.slice().reverse().forEach(saved => {
      const li = document.createElement('li');
      const dateTxt = new Date(saved.date).toLocaleString('fr', { dateStyle: 'short', timeStyle: 'short' });
      const activeTxt = this.viewingSavedId === saved.id ? ' (en cours de consultation)' : '';
      li.innerHTML = `<span><strong>${saved.name}</strong> — ${dateTxt}${activeTxt}</span>`;
      const actions = document.createElement('span');
      actions.className = 'saved-actions';

      const viewBtn = document.createElement('button');
      viewBtn.textContent = this.viewingSavedId === saved.id ? 'Revenir à l\'actuel' : 'Voir';
      viewBtn.addEventListener('click', () => {
        this.viewingSavedId = this.viewingSavedId === saved.id ? null : saved.id;
        this.renderSchedule();
        this.renderSavedSchedules();
      });
      actions.appendChild(viewBtn);

      const restoreBtn = document.createElement('button');
      restoreBtn.textContent = 'Restaurer';
      restoreBtn.title = 'Remplace l\'emploi du temps actuel par cette version';
      restoreBtn.addEventListener('click', () => {
        if (!confirm(`Remplacer l'emploi du temps actuel par "${saved.name}" ?`)) return;
        this.state.schedule = saved.schedule;
        this.lastPartial = null;
        this.viewingSavedId = null;
        this.onChange();
        this.updateRepairButton();
        this.updateSaveButton();
        this.renderSchedule();
        this.renderSavedSchedules();
      });
      actions.appendChild(restoreBtn);

      const renameBtn = document.createElement('button');
      renameBtn.textContent = 'Renommer';
      renameBtn.addEventListener('click', () => {
        const name = prompt('Nouveau nom de cette version :', saved.name);
        if (name === null) return; // annulé
        const trimmed = name.trim();
        if (!trimmed) return;
        saved.name = trimmed;
        this.onChange();
        this.renderSavedSchedules();
      });
      actions.appendChild(renameBtn);

      const delBtn = document.createElement('button');
      delBtn.textContent = '×';
      delBtn.title = 'Supprimer cette version';
      delBtn.addEventListener('click', () => {
        if (!confirm(`Supprimer la version "${saved.name}" ?`)) return;
        this.state.savedSchedules = this.state.savedSchedules.filter(s => s.id !== saved.id);
        if (this.viewingSavedId === saved.id) this.viewingSavedId = null;
        this.onChange();
        this.renderSchedule();
        this.renderSavedSchedules();
      });
      actions.appendChild(delBtn);

      li.appendChild(actions);
      list.appendChild(li);
    });
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
    const nameOf = pid => this.state.profs.find(p => p.id === pid)?.name || pid;
    const cellLabel = (cell) => {
      if (!cell) return '(libre)';
      if (cell.weekA || cell.weekB) {
        const partFor = wc => wc ? `${wc.subj} — ${(wc.profIds || [wc.profId]).map(nameOf).join(', ') || '—'}` : '(libre)';
        return `[semaine A] ${partFor(cell.weekA)}  ·  [semaine B] ${partFor(cell.weekB)}`;
      }
      const names = (cell.profIds || [cell.profId]).map(nameOf).join(', ');
      return `${cell.subj} — ${names || '—'}`;
    };

    const blocks = [];
    const renderBlock = (title, keyFor) => {
      const lines = [`=== ${title} ===`];
      activeDays.forEach(di => {
        lines.push(`-- ${days[di]} --`);
        slots.forEach((sl, si) => {
          lines.push(`${sl.start}–${sl.end} : ${cellLabel(schedule[keyFor(di, si)])}`);
        });
      });
      blocks.push(lines.join('\n'));
    };

    // Ne copie que ce que l'onglet affiche réellement : la vue courante du
    // sélecteur ("Toutes les classes" / une classe / un prof), pas tout le
    // planning à chaque fois — sinon le texte copié en vue "Prof X" contient
    // les autres profs et classes, ce qui n'est pas ce que l'utilisateur voit
    // à l'écran ni ce qu'il veut coller ailleurs (ex: partager à ce seul prof).
    const view = document.getElementById('view-select').value;
    if (view.startsWith('class:')) {
      const cls = view.slice(6);
      renderBlock(`Classe ${cls}`, (d, s) => `${cls}|${d}|${s}`);
    } else if (view.startsWith('prof:')) {
      const profId = view.slice(5);
      const prof = this.state.profs.find(p => p.id === profId);
      const lines = [`=== Prof ${prof ? prof.name : profId} ===`];
      const boxLabel = box => box ? `${box.top} — ${box.bottom}` : '(libre)';
      activeDays.forEach(di => {
        lines.push(`-- ${days[di]} --`);
        slots.forEach((sl, si) => {
          const { descriptor } = this.profCellData(profId, di, si, schedule);
          let label = '(libre)';
          if (descriptor) {
            label = descriptor.alt
              ? `[semaine A] ${boxLabel(descriptor.weekA)}  ·  [semaine B] ${boxLabel(descriptor.weekB)}`
              : boxLabel(descriptor);
          }
          lines.push(`${sl.start}–${sl.end} : ${label}`);
        });
      });
      blocks.push(lines.join('\n'));
    } else {
      this.state.config.classes.forEach(cls => renderBlock(`Classe ${cls}`, (d, s) => `${cls}|${d}|${s}`));
      this.meetingsWithoutClass().forEach(m => renderBlock(`Réunion — ${m.name}`, (d, s) => `@meeting:${m.id}|${d}|${s}`));
    }

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

    // Consultation d'une version sauvegardée : prioritaire sur tout le reste,
    // toujours en lecture seule (le swap suppose qu'on édite state.schedule,
    // pas un instantané figé) — l'utilisateur doit explicitement "Restaurer"
    // pour la rendre éditable.
    if (this.viewingSavedId) {
      const saved = this.state.savedSchedules.find(s => s.id === this.viewingSavedId);
      if (saved) {
        const banner = document.createElement('p');
        banner.className = 'hint partial-banner';
        banner.textContent = `Consultation de "${saved.name}" (lecture seule) — ceci n'est pas l'emploi du temps actuel.`;
        cont.appendChild(banner);
        const schedule = saved.schedule;
        if (view.startsWith('prof:')) {
          cont.appendChild(this.buildProfGrid(view.slice(5), schedule, true));
        } else if (view.startsWith('class:')) {
          cont.appendChild(this.buildClassBlock(view.slice(6), schedule, true));
        } else {
          this.state.config.classes.forEach(cls => cont.appendChild(this.buildClassBlock(cls, schedule, true)));
          this.meetingsWithoutClass().forEach(m => cont.appendChild(this.buildMeetingBlock(m, schedule)));
        }
        return;
      }
      this.viewingSavedId = null; // référence caduque (version supprimée) : on retombe sur l'état courant
    }

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
        cont.appendChild(this.buildProfGrid(view.slice(5), schedule, true));
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
    const grid = this.buildScheduleGrid((d, s) => this.cellDescriptor(schedule[`${pseudoKey}|${d}|${s}`]));
    // Éditable uniquement sur l'état courant (pas sur une version sauvegardée
    // ou un essai partiel, passés ici avec un `schedule` différent de l'état) :
    // on peut déplacer le créneau de la réunion vers un autre créneau où TOUS
    // les profs concernés sont dispos et libres (voir canMoveMeeting).
    if (schedule === this.state.schedule) {
      grid.querySelectorAll('.cell-sched').forEach(td => {
        td.dataset.meeting = meeting.id;
        td.classList.add('swappable');
        td.addEventListener('click', () => this.handleMeetingSwapClick(td, meeting.id));
      });
    }
    wrap.appendChild(grid);
    return wrap;
  },

  // Traduit une cellule brute de `schedule` (format plat {subj,profId,profIds,
  // pinned} pour une session "toutes les semaines", ou {weekA?, weekB?} pour
  // une cellule qui alterne — voir buildContext/solve() dans solver.js) en
  // descripteur d'affichage consommé par buildScheduleGrid : soit {top,bottom,
  // pinned} (une seule boîte), soit {alt:true, weekA, weekB} (deux boîtes).
  cellDescriptor(cell) {
    if (!cell) return null;
    const nameOf = pid => this.state.profs.find(p => p.id === pid)?.name || pid;
    if (cell.weekA || cell.weekB) {
      const boxFor = wc => wc ? { top: wc.subj, bottom: (wc.profIds || [wc.profId]).map(nameOf).join(', ') || '—' } : null;
      return { alt: true, weekA: boxFor(cell.weekA), weekB: boxFor(cell.weekB) };
    }
    const names = (cell.profIds || [cell.profId]).map(nameOf).join(', ');
    return { top: cell.subj, bottom: names || '—', pinned: !!cell.pinned };
  },

  buildClassBlock(cls, schedule = this.state.schedule, readOnly = false) {
    const wrap = document.createElement('div');
    wrap.className = 'class-block';
    const h = document.createElement('h3');
    h.textContent = 'Classe ' + cls;
    wrap.appendChild(h);
    const grid = this.buildScheduleGrid((d, s) => this.cellDescriptor(schedule[`${cls}|${d}|${s}`]));
    // Marque chaque cellule avec sa classe : le swap peut être cross-classe.
    grid.querySelectorAll('.cell-sched').forEach(td => {
      td.dataset.cls = cls;
      const key = `${cls}|${td.dataset.d}|${td.dataset.s}`;
      const cell = schedule[key];
      if (cell?.pinned) td.classList.add('pinned');
      // Épingle, lecture seule, cellule multi-profs (réunion/cours co-enseigné),
      // ou cellule alternant semaine A/B : le swap suppose un seul prof et une
      // seule matière par cellule, donc pas de swap sur ces cas-là.
      if (readOnly || cell?.pinned || cell?.meeting || cell?.weekA || cell?.weekB) return;
      td.classList.add('swappable');
      td.addEventListener('click', () => this.handleSwapClick(td));
    });
    wrap.appendChild(grid);
    return wrap;
  },

  // Descripteur de cellule pour LA vue d'un prof donné, à (d, s) — factorisé
  // hors de buildProfGrid pour être réutilisable telle quelle par l'export PDF
  // (capture.js), qui a besoin de la même logique sans passer par le DOM.
  // Un prof peut apparaître sur plusieurs classes (épingle/groupe multi-classes)
  // et/ou via une réunion à plusieurs profs obligatoires (cell.profIds), et/ou
  // dans une SEULE des deux semaines d'une cellule alternante (cell.weekA/weekB)
  // — les trois cas doivent être distingués pour que sa vue perso alterne
  // correctement elle aussi, pas seulement la vue par classe.
  // Retourne { descriptor, singleCls } : singleCls est la classe à utiliser
  // pour le swap quand la cellule est un cas "simple" (une seule classe, pas
  // d'épingle, pas de réunion), sinon null.
  profCellData(profId, d, s, schedule) {
    const meetingKeys = this.meetingsWithoutClass().map(m => `@meeting:${m.id}`);
    const nameOfCls = cls => cls.startsWith('@meeting:') ? 'réunion' : cls;
    const found = []; // sessions "both" (multi-classes possible)
    let weekABox = null, weekBBox = null;
    for (const cls of this.state.config.classes.concat(meetingKeys)) {
      const cell = schedule[`${cls}|${d}|${s}`];
      if (!cell) continue;
      if (cell.weekA || cell.weekB) {
        if (cell.weekA && (cell.weekA.profIds || [cell.weekA.profId]).includes(profId)) {
          weekABox = { top: cell.weekA.subj, bottom: nameOfCls(cls) };
        }
        if (cell.weekB && (cell.weekB.profIds || [cell.weekB.profId]).includes(profId)) {
          weekBBox = { top: cell.weekB.subj, bottom: nameOfCls(cls) };
        }
      } else if ((cell.profIds || [cell.profId]).includes(profId)) {
        found.push({ cls, cell });
      }
    }
    if (weekABox || weekBBox) return { descriptor: { alt: true, weekA: weekABox, weekB: weekBBox }, singleCls: null };
    if (found.length === 0) return { descriptor: null, singleCls: null };
    const singleCls = (found.length === 1 && !found[0].cell.pinned && !found[0].cell.meeting) ? found[0].cls : null;
    const pinned = found.some(f => f.cell.pinned);
    return {
      descriptor: { top: found[0].cell.subj, bottom: found.map(f => nameOfCls(f.cls)).join(', '), pinned },
      singleCls,
    };
  },

  buildProfGrid(profId, schedule = this.state.schedule, readOnly = false) {
    const prof = this.state.profs.find(p => p.id === profId);
    const wrap = document.createElement('div');
    wrap.className = 'class-block';
    const h = document.createElement('h3');
    h.textContent = 'Prof ' + (prof ? prof.name : profId);
    wrap.appendChild(h);
    // "d|s" -> classe, uniquement pour les créneaux échangeables : une seule
    // classe/session simple à cet instant (pas de groupe multi-classes, pas
    // de réunion, pas d'épingle, pas d'alternance A/B) — le swap suppose un
    // seul (classe, prof) par cellule, comme pour la vue classe.
    const singleClsFor = {};
    const grid = this.buildScheduleGrid((d, s) => {
      const { descriptor, singleCls } = this.profCellData(profId, d, s, schedule);
      if (singleCls) singleClsFor[`${d}|${s}`] = singleCls;
      return descriptor;
    });
    if (!readOnly) {
      grid.querySelectorAll('.cell-sched').forEach(td => {
        const d = +td.dataset.d, s = +td.dataset.s;
        const cls = singleClsFor[`${d}|${s}`];
        if (cls) {
          td.dataset.cls = cls;
          td.classList.add('swappable');
        }
        // Écouteur posé sur TOUTE cellule (y compris vides) : une cellule vide
        // peut devenir cible d'un échange une fois une source sélectionnée
        // (voir highlightProfSwapTargets qui lui assigne dataset.cls à la volée).
        td.addEventListener('click', () => this.handleProfSwapClick(td, profId));
      });
    }
    wrap.appendChild(grid);
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
    const openSlots = this.state.config.openSlots || [];
    this.state.config.slots.forEach((sl, si) => {
      html += `<tr><td class="slot-label">${sl.start}–${sl.end}</td>`;
      this.state.config.days.forEach((_, di) => {
        if (!activeDays.has(di)) return;
        const open = (openSlots[di] || [])[si] !== false;
        const c = cellFor(di, si);
        if (c?.alt) {
          const box = (wc, label) => `<div class="week-box${wc ? '' : ' week-empty'}"><span class="week-tag">${label}</span>${wc ? `<div class="subject">${wc.top}</div><div class="prof">${wc.bottom}</div>` : ''}</div>`;
          html += `<td class="cell-sched filled alt-week" data-d="${di}" data-s="${si}"><div class="alt-week-row">${box(c.weekA, 'A')}${box(c.weekB, 'B')}</div></td>`;
        } else if (c) {
          const pinCls = c.pinned ? ' pinned' : '';
          html += `<td class="cell-sched filled${pinCls}" data-d="${di}" data-s="${si}"><div class="subject">${c.top}</div><div class="prof">${c.bottom}</div></td>`;
        } else {
          html += `<td class="cell-sched${open ? '' : ' closed'}" data-d="${di}" data-s="${si}"></td>`;
        }
      });
      html += '</tr>';
    });
    html += '</tbody>';
    t.innerHTML = html;
    return t;
  },
});
