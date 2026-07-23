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
    subjects.forEach((sj, sjIdx) => {
      html += `<tr data-row="${sjIdx}"><td class="subj-col">${sj}</td>`;
      let rowTotal = 0;
      classes.forEach((cl, i) => {
        const key = `${cl}|${sj}`;
        const v = this.state.volumes[key] || 0;
        rowTotal += v;
        colTotals[i] += v;
        const zeroCls = v === 0 ? ' is-zero' : '';
        const noProfCls = (v > 0 && !hasProf(sj, cl)) ? ' no-prof' : '';
        const title = (v > 0 && !hasProf(sj, cl)) ? `Aucun prof n'enseigne ${sj} en ${cl}.` : '';
        html += `<td><input class="vol-input${zeroCls}${noProfCls}" type="number" min="0" value="${v}" data-key="${key}" data-row="${sjIdx}" data-col="${i}" title="${title}"></td>`;
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
    const recomputeTotals = () => {
      const colT = classes.map(() => 0);
      const rows = t.querySelectorAll('tbody tr:not(.totals-row)');
      rows.forEach((tr, si) => {
        let rowT = 0;
        tr.querySelectorAll('.vol-input').forEach((inp, i) => {
          const v = parseInt(inp.value) || 0;
          rowT += v;
          colT[i] += v;
        });
        tr.querySelector('.total-cell').textContent = rowT || '·';
      });
      const totRow = t.querySelector('tr.totals-row');
      const cells = totRow.querySelectorAll('.total-cell');
      colT.forEach((v, i) => { cells[i].textContent = v || '·'; });
      cells[cells.length - 1].textContent = colT.reduce((a, b) => a + b, 0);
    };
    const inputs = Array.from(t.querySelectorAll('.vol-input'));
    const updateCell = (inp) => {
      const v = parseInt(inp.value) || 0;
      const [cl, sj] = inp.dataset.key.split('|');
      this.state.volumes[inp.dataset.key] = v;
      inp.classList.toggle('is-zero', v === 0);
      const bad = v > 0 && !hasProf(sj, cl);
      inp.classList.toggle('no-prof', bad);
      inp.title = bad ? `Aucun prof n'enseigne ${sj} en ${cl}.` : '';
      recomputeTotals();
      this.onChange();
    };

    inputs.forEach(inp => {
      inp.addEventListener('input', () => updateCell(inp));

      // Molette : incrémente / décrémente (uniquement quand le champ a le focus).
      inp.addEventListener('wheel', e => {
        if (document.activeElement !== inp) return;
        e.preventDefault();
        const delta = e.deltaY < 0 ? 1 : -1;
        const nv = Math.max(0, (parseInt(inp.value) || 0) + delta);
        inp.value = nv;
        updateCell(inp);
      }, { passive: false });

      // Flèches ← → ↑ ↓ : navigue entre cellules (comme Excel).
      inp.addEventListener('keydown', e => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        // ← → : seulement si le curseur est au bord du champ (sinon on écrase la navigation texte).
        if (e.key === 'ArrowLeft' && inp.selectionStart > 0) return;
        if (e.key === 'ArrowRight' && inp.selectionEnd < inp.value.length) return;
        e.preventDefault();
        const row = +inp.dataset.row, col = +inp.dataset.col;
        const dr = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
        const dc = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
        const next = inputs.find(x => +x.dataset.row === row + dr && +x.dataset.col === col + dc);
        if (next) { next.focus(); next.select(); }
      });
    });

    // Copier-ligne : applique la 1ʳᵉ valeur non-nulle de la ligne à toutes les classes.
    t.querySelectorAll('.copy-row').forEach(btn => {
      btn.addEventListener('click', () => {
        const sj = btn.dataset.subj;
        const rowInputs = inputs.filter(x => x.dataset.key.endsWith('|' + sj));
        const src = rowInputs.find(x => (parseInt(x.value) || 0) > 0);
        if (!src) { alert('Renseigne une valeur > 0 dans la ligne d\'abord.'); return; }
        const val = parseInt(src.value) || 0;
        rowInputs.forEach(x => { x.value = val; updateCell(x); });
      });
    });
  },
});
