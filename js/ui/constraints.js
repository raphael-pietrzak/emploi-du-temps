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

    document.getElementById('add-spread').addEventListener('click', () => {
      const subj = document.getElementById('spread-subj').value;
      const classes = Array.from(document.querySelectorAll('#spread-classes .chip.active'))
        .map(el => el.dataset.cls);
      if (!subj) { alert('Choisis une matière.'); return; }
      if (classes.length === 0) { alert('Sélectionne au moins une classe.'); return; }
      this.state.constraints.spread.push({
        id: 'spread_' + Date.now(),
        subj, classes,
      });
      this.onChange();
      this.renderConstraints();
    });

    document.getElementById('add-meeting').addEventListener('click', () => {
      const name = document.getElementById('meeting-name').value.trim();
      const subj = document.getElementById('meeting-subj').value || null;
      const hours = +document.getElementById('meeting-hours').value;
      const classes = Array.from(document.querySelectorAll('#meeting-classes .chip.active'))
        .map(el => el.dataset.cls);
      const profIds = Array.from(document.querySelectorAll('#meeting-profs .chip.active'))
        .map(el => el.dataset.profId);
      if (!name) { alert('Indique un nom.'); return; }
      if (profIds.length < 2) { alert('Sélectionne au moins 2 profs (tous obligatoires).'); return; }
      if (subj && classes.length === 0) { alert('Une matière est indiquée : sélectionne au moins une classe.'); return; }
      if (!Number.isInteger(hours) || hours < 1) { alert('Indique un nombre d\'heures valide.'); return; }
      this.state.constraints.meetings.push({
        id: 'meeting_' + Date.now(),
        name, subj, classes, profIds, hours,
      });
      document.getElementById('meeting-name').value = '';
      document.getElementById('meeting-hours').value = '1';
      this.onChange();
      this.renderConstraints();
    });
  },

  renderConstraints() {
    const { subjects, classes, days, slots } = this.state.config;
    const activeDays = new Set(this.activeDayIndices());

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
      days.map((d, i) => activeDays.has(i) ? `<option value="${i}">${d}</option>` : '').join('');
    if (prevDay !== '' && activeDays.has(+prevDay)) daySel.value = prevDay;

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

    // ---------- Répartition sur des jours différents ----------
    const spSubjSel = document.getElementById('spread-subj');
    const prevSpSubj = spSubjSel.value;
    spSubjSel.innerHTML = '<option value="">Matière…</option>' +
      subjects.map(s => `<option value="${s}">${s}</option>`).join('');
    if (subjects.includes(prevSpSubj)) spSubjSel.value = prevSpSubj;

    const spClsWrap = document.getElementById('spread-classes');
    const prevSpActive = new Set(
      Array.from(spClsWrap.querySelectorAll('.chip.active')).map(el => el.dataset.cls)
    );
    spClsWrap.innerHTML = '';
    classes.forEach(cl => {
      const chip = document.createElement('span');
      chip.className = 'chip' + (prevSpActive.has(cl) ? ' active' : '');
      chip.dataset.cls = cl;
      chip.textContent = cl;
      chip.addEventListener('click', () => chip.classList.toggle('active'));
      spClsWrap.appendChild(chip);
    });

    const spList = document.getElementById('spread-list');
    spList.innerHTML = '';
    (this.state.constraints.spread || []).forEach(sp => {
      const li = document.createElement('li');
      li.innerHTML = `<span><strong>${sp.subj}</strong> — ${sp.classes.join(', ')} — jours différents</span><button title="Retirer">×</button>`;
      li.querySelector('button').addEventListener('click', () => {
        this.state.constraints.spread = this.state.constraints.spread.filter(x => x.id !== sp.id);
        this.onChange();
        this.renderConstraints();
      });
      spList.appendChild(li);
    });

    // ---------- Réunions & cours à plusieurs profs ----------
    const mSubjSel = document.getElementById('meeting-subj');
    const prevMSubj = mSubjSel.value;
    mSubjSel.innerHTML = '<option value="">Aucune (réunion sans matière)</option>' +
      subjects.map(s => `<option value="${s}">${s}</option>`).join('');
    if (subjects.includes(prevMSubj)) mSubjSel.value = prevMSubj;

    const mClsWrap = document.getElementById('meeting-classes');
    const prevMActive = new Set(
      Array.from(mClsWrap.querySelectorAll('.chip.active')).map(el => el.dataset.cls)
    );
    mClsWrap.innerHTML = '';
    classes.forEach(cl => {
      const chip = document.createElement('span');
      chip.className = 'chip' + (prevMActive.has(cl) ? ' active' : '');
      chip.dataset.cls = cl;
      chip.textContent = cl;
      chip.addEventListener('click', () => chip.classList.toggle('active'));
      mClsWrap.appendChild(chip);
    });

    const mProfWrap = document.getElementById('meeting-profs');
    const prevMProfActive = new Set(
      Array.from(mProfWrap.querySelectorAll('.chip.active')).map(el => el.dataset.profId)
    );
    mProfWrap.innerHTML = '';
    this.state.profs.forEach(p => {
      const chip = document.createElement('span');
      chip.className = 'chip' + (prevMProfActive.has(p.id) ? ' active' : '');
      chip.dataset.profId = p.id;
      chip.textContent = p.name;
      chip.addEventListener('click', () => chip.classList.toggle('active'));
      mProfWrap.appendChild(chip);
    });

    const mList = document.getElementById('meetings-list');
    mList.innerHTML = '';
    (this.state.constraints.meetings || []).forEach(m => {
      const li = document.createElement('li');
      const profNames = m.profIds.map(pid => this.state.profs.find(p => p.id === pid)?.name || pid).join(', ');
      const clsTxt = m.classes.length ? m.classes.join(' + ') : 'aucune classe';
      const subjTxt = m.subj ? ` (${m.subj})` : '';
      li.innerHTML = `<span><strong>${m.name}</strong>${subjTxt} — ${clsTxt} — ${m.hours}h — profs obligatoires : ${profNames}</span><button title="Retirer">×</button>`;
      li.querySelector('button').addEventListener('click', () => {
        this.state.constraints.meetings = this.state.constraints.meetings.filter(x => x.id !== m.id);
        this.onChange();
        this.renderConstraints();
      });
      mList.appendChild(li);
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
