// constraints.js — onglet Contraintes : épingles et préférences horaires par matière.

Object.assign(UI, {
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
});
