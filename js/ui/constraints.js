// constraints.js — onglet Contraintes : épingles et regroupements de classes.

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

    document.getElementById('add-group').addEventListener('click', () => {
      const subj = document.getElementById('group-subj').value;
      const hours = +document.getElementById('group-hours').value;
      const profId = document.getElementById('group-prof').value || null;
      const classes = Array.from(document.querySelectorAll('#group-classes .chip.active'))
        .map(el => el.dataset.cls);
      if (!subj) { alert('Choisis une matière.'); return; }
      if (classes.length < 2) { alert('Sélectionne au moins 2 classes à regrouper.'); return; }
      if (!Number.isInteger(hours) || hours < 1) { alert('Indique un nombre d\'heures valide.'); return; }
      this.state.constraints.groups.push({
        id: 'group_' + Date.now(),
        subj, classes, hours, profId,
      });
      document.getElementById('group-hours').value = '';
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
        this.updateEligibleProfOptions('pin-subj', 'pin-classes', 'pin-prof');
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
    subjSel.onchange = () => this.updateEligibleProfOptions('pin-subj', 'pin-classes', 'pin-prof');
    this.updateEligibleProfOptions('pin-subj', 'pin-classes', 'pin-prof');

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

    // ---------- Regroupements de classes ----------
    const gSubjSel = document.getElementById('group-subj');
    const prevGSubj = gSubjSel.value;
    gSubjSel.innerHTML = '<option value="">Matière…</option>' +
      subjects.map(s => `<option value="${s}">${s}</option>`).join('');
    if (subjects.includes(prevGSubj)) gSubjSel.value = prevGSubj;

    const gClsWrap = document.getElementById('group-classes');
    const prevGActive = new Set(
      Array.from(gClsWrap.querySelectorAll('.chip.active')).map(el => el.dataset.cls)
    );
    gClsWrap.innerHTML = '';
    classes.forEach(cl => {
      const chip = document.createElement('span');
      chip.className = 'chip' + (prevGActive.has(cl) ? ' active' : '');
      chip.dataset.cls = cl;
      chip.textContent = cl;
      chip.addEventListener('click', () => {
        chip.classList.toggle('active');
        this.updateEligibleProfOptions('group-subj', 'group-classes', 'group-prof');
      });
      gClsWrap.appendChild(chip);
    });

    gSubjSel.onchange = () => this.updateEligibleProfOptions('group-subj', 'group-classes', 'group-prof');
    this.updateEligibleProfOptions('group-subj', 'group-classes', 'group-prof');

    const gList = document.getElementById('groups-list');
    gList.innerHTML = '';
    (this.state.constraints.groups || []).forEach(g => {
      const li = document.createElement('li');
      const prof = g.profId ? this.state.profs.find(p => p.id === g.profId) : null;
      const profTxt = prof ? prof.name : 'sans prof imposé';
      li.innerHTML = `<span><strong>${g.subj}</strong> — ${g.classes.join(' + ')} — ${g.hours}h ensemble — ${profTxt}</span><button title="Retirer">×</button>`;
      li.querySelector('button').addEventListener('click', () => {
        this.state.constraints.groups = this.state.constraints.groups.filter(x => x.id !== g.id);
        this.onChange();
        this.renderConstraints();
      });
      gList.appendChild(li);
    });
  },

  // Remplit un <select> de profs avec ceux qui enseignent `subj` à TOUTES les
  // classes cochées dans `classesWrapId` — utilisé par le formulaire d'épingle
  // et par celui de regroupement. Présélectionne le seul prof possible s'il
  // n'y en a qu'un (mais laisse "Sans prof" sélectionnable si vraiment voulu).
  updateEligibleProfOptions(subjSelId, classesWrapId, profSelId) {
    const subj = document.getElementById(subjSelId).value;
    const classes = Array.from(document.querySelectorAll(`#${classesWrapId} .chip.active`))
      .map(el => el.dataset.cls);
    const profSel = document.getElementById(profSelId);
    const prev = profSel.value;
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
    if (elig.some(p => p.id === prev)) {
      profSel.value = prev;
    } else if (elig.length === 1) {
      profSel.value = elig[0].id;
    }
  },
});
