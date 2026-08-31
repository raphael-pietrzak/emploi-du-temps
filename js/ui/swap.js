// swap.js — échange interactif de deux cellules dans la grille d'emploi du temps.
//
// Modèle : chaque session déplace QUAND elle a lieu, jamais QUOI ni POUR QUI —
// (classe, matière, prof) reste attaché à sa session d'origine, seul le
// (jour, créneau) de chacune des deux sessions est échangé. C'est le contraire
// d'un "échange de contenu à position fixe" (qui swappe subj/profId entre les
// deux clés de planning sans bouger leur créneau) : ce dernier modèle produit
// un no-op silencieux quand les deux sessions ont exactement le même contenu
// (même prof, même matière, cas fréquent) et interdit à tort un swap entre
// classes différentes de matières différentes (aucune raison de l'interdire :
// les volumes de chaque classe restent inchangés puisque chaque session garde
// sa propre matière, seul le moment où elle a lieu change).
Object.assign(UI, {
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
      const clsA = this._swap.cls, d1 = this._swap.d, s1 = this._swap.s;
      this.clearSwapHighlight();
      this._swap = null;
      if (cell && !this.isLocked(cell) && confirm(
        'Cet échange n\'est pas directement possible (prof indisponible ou déjà occupé ailleurs). ' +
        'Chercher un moyen de le faire quand même, en déplaçant ce qui bloque ?'
      )) {
        this.runForceSwap(clsA, d1, s1, cls, d, s);
      }
      return;
    }

    this.performSwap(this._swap.cls, this._swap.d, this._swap.s, cls, d, s);
    this._swap = null;
    this.onChange();
    this.renderSchedule();
  },

  // Tente un échange non directement valide en cherchant où reloger les
  // sessions qui bloquent (forceSwap), demande confirmation avant d'agir,
  // applique le résultat si trouvé, et prévient sinon pourquoi c'est
  // impossible. Partagé entre la vue classe et la vue prof.
  runForceSwap(clsA, d1, s1, clsB, d2, s2) {
    const res = this.forceSwap(clsA, d1, s1, clsB, d2, s2);
    if (!res.ok) {
      alert(`Échange impossible : ${res.reason}`);
      return;
    }
    this.onChange();
    this.renderSchedule();
    if (res.relocated.length) {
      const fmt = (d, s) => `${this.state.config.days[d]} ${this.state.config.slots[s].start}`;
      const lines = res.relocated.map(r => `• ${r.subj} (${r.cls}) : ${fmt(r.from[0], r.from[1])} → ${fmt(r.to[0], r.to[1])}`);
      alert(`Échange effectué. Pour que ça rentre, en plus :\n${lines.join('\n')}`);
    }
  },

  isLocked(cell) {
    return !!(cell.pinned || cell.meeting || cell.weekA || cell.weekB);
  },

  // Vrai si `cell` occupe profId, à N'IMPORTE QUELLE semaine — y compris une
  // cellule alternante (weekA/weekB) dont le prof n'est PAS exposé au niveau
  // plat (cell.profId) mais sous cell.weekA.profId / cell.weekB.profId. Une
  // session déplacée par un swap est toujours 'both' (les cellules weekA/
  // weekB elles-mêmes ne peuvent pas être déplacées, cf isLocked), donc elle
  // couvrirait les DEUX semaines à la nouvelle position : un conflit sur une
  // seule semaine (A seule ou B seule) chez une autre classe suffit déjà à
  // bloquer l'échange. Sans ce contrôle, un swap pouvait mettre le même prof
  // sur deux classes différentes au même créneau une semaine A ou B donnée.
  cellOccupiesProf(cell, profId) {
    if (!cell) return false;
    const has = (c) => !!c && ((c.profIds && c.profIds.includes(profId)) || c.profId === profId);
    return has(cell) || has(cell.weekA) || has(cell.weekB);
  },

  // Cherche comment rendre possible l'échange (clsA,d1,s1) ↔ (clsB,d2,s2)
  // quand canSwap le refuse directement : identifie les sessions qui
  // bloquent (une AUTRE session de clsA/clsB déjà présente à la position
  // visée, ou un prof déjà occupé ailleurs à la nouvelle heure), cherche pour
  // chacune un créneau de repli valide, et n'applique QUE si une solution
  // complète a été trouvée pour tous les blocages (tout ou rien — jamais un
  // échange à moitié fait).
  forceSwap(clsA, d1, s1, clsB, d2, s2) {
    const a = this.state.schedule[`${clsA}|${d1}|${s1}`];
    const b = this.state.schedule[`${clsB}|${d2}|${s2}`];
    if (!a || this.isLocked(a)) {
      return { ok: false, reason: 'Le créneau de départ est épinglé, une réunion, ou alterne semaine A/B — impossible à déplacer.' };
    }
    if (b && this.isLocked(b)) {
      return { ok: false, reason: 'Le créneau cible est épinglé, une réunion, ou alterne semaine A/B — impossible à déplacer.' };
    }

    const blockers = []; // { cls, d, s, cell }
    const collect = (cls, d, s) => {
      if (cls === clsA && d === d1 && s === s1) return true; // A lui-même
      if (cls === clsB && d === d2 && s === s2) return true; // B lui-même
      const cell = this.state.schedule[`${cls}|${d}|${s}`];
      if (!cell) return true;
      if (this.isLocked(cell)) return false;
      if (!blockers.some(x => x.cls === cls && x.d === d && x.s === s)) blockers.push({ cls, d, s, cell });
      return true;
    };

    // Conflit de position : clsA (resp. clsB) a déjà SA PROPRE session au
    // créneau visé.
    if (clsA !== clsB) {
      if (!collect(clsA, d2, s2)) return { ok: false, reason: `${clsA} a déjà une session verrouillée à ce créneau.` };
      if (b && !collect(clsB, d1, s1)) return { ok: false, reason: `${clsB} a déjà une session verrouillée à ce créneau.` };
    }

    const profA = this.state.profs.find(p => p.id === a.profId);
    if (!profA || !profA.availability?.[d2]?.[s2]) {
      return { ok: false, reason: `${profA ? profA.name : a.profId} n'est pas disponible à ce créneau — indisponibilité fixe, pas contournable.` };
    }
    for (const c of this.state.config.classes) {
      if (c === clsA || c === clsB) continue;
      const cell = this.state.schedule[`${c}|${d2}|${s2}`];
      if (this.cellOccupiesProf(cell, profA.id)) {
        if (!collect(c, d2, s2)) return { ok: false, reason: `${profA.name} est déjà occupé ailleurs à ce créneau par une session verrouillée.` };
      }
    }
    if (b) {
      const profB = this.state.profs.find(p => p.id === b.profId);
      if (!profB || !profB.availability?.[d1]?.[s1]) {
        return { ok: false, reason: `${profB ? profB.name : b.profId} n'est pas disponible à ce créneau — indisponibilité fixe, pas contournable.` };
      }
      for (const c of this.state.config.classes) {
        if (c === clsA || c === clsB) continue;
        const cell = this.state.schedule[`${c}|${d1}|${s1}`];
        if (this.cellOccupiesProf(cell, profB.id)) {
          if (!collect(c, d1, s1)) return { ok: false, reason: `${profB.name} est déjà occupé ailleurs à ce créneau par une session verrouillée.` };
        }
      }
    }

    if (blockers.length === 0) {
      this.performSwap(clsA, d1, s1, clsB, d2, s2);
      return { ok: true, relocated: [] };
    }

    // Une place de repli par blocage — réservées au fur et à mesure pour que
    // deux blocages ne se voient pas attribuer le même créneau.
    const reserved = new Set([`${clsA}|${d2}|${s2}`, `${clsB}|${d1}|${s1}`]);
    const relocations = [];
    for (const blk of blockers) {
      const spot = this.findRelocationSlot(blk.cls, blk.cell, blk.d, blk.s, reserved);
      if (!spot) {
        return { ok: false, reason: `Aucun créneau de repli disponible pour ${blk.cell.subj} (${blk.cls}), qui bloque l'échange.` };
      }
      relocations.push({ ...blk, newD: spot.d, newS: spot.s });
      reserved.add(`${blk.cls}|${spot.d}|${spot.s}`);
    }

    for (const r of relocations) this.performSwap(r.cls, r.d, r.s, r.cls, r.newD, r.newS);
    this.performSwap(clsA, d1, s1, clsB, d2, s2);
    return {
      ok: true,
      relocated: relocations.map(r => ({ cls: r.cls, subj: r.cell.subj, from: [r.d, r.s], to: [r.newD, r.newS] })),
    };
  },

  // Un créneau de repli valide pour (cls, cell) : ouvert, pas déjà pris pour
  // cette classe (ni réservé par un autre relogement de cette même
  // recherche), prof disponible et non occupé ailleurs à ce moment. Ordre
  // mélangé (comme le solveur) pour ne pas retomber toujours sur le même
  // schéma déterministe.
  findRelocationSlot(cls, cell, oldD, oldS, reserved) {
    const openSlots = this.state.config.openSlots || [];
    const days = this.state.config.days.map((_, i) => i).sort(() => Math.random() - 0.5);
    const slots = this.state.config.slots.map((_, i) => i).sort(() => Math.random() - 0.5);
    const prof = this.state.profs.find(p => p.id === cell.profId);
    if (!prof) return null;
    for (const d of days) {
      for (const s of slots) {
        if (d === oldD && s === oldS) continue;
        if ((openSlots[d] || [])[s] === false) continue;
        const key = `${cls}|${d}|${s}`;
        if (reserved.has(key) || this.state.schedule[key]) continue;
        if (!prof.availability?.[d]?.[s]) continue;
        let busy = false;
        for (const c of this.state.config.classes) {
          if (c === cls) continue;
          const other = this.state.schedule[`${c}|${d}|${s}`];
          if (this.cellOccupiesProf(other, prof.id)) { busy = true; break; }
        }
        if (busy) continue;
        return { d, s };
      }
    }
    return null;
  },

  // Exécute l'échange : chaque session (identifiée par sa propre classe) est
  // réécrite sous SA classe mais au NOUVEAU créneau — jamais de contenu qui
  // change de classe. Capture les deux valeurs avant toute mutation pour ne
  // pas dépendre de l'ordre des delete/write, y compris quand clsA===clsB
  // (les 4 clés se recouvrent alors deux à deux : c'est le swap classique
  // "deux créneaux d'une même classe", qui retombe naturellement sur ce cas).
  performSwap(clsA, d1, s1, clsB, d2, s2) {
    const aOldKey = `${clsA}|${d1}|${s1}`;
    const bOldKey = `${clsB}|${d2}|${s2}`;
    const aVal = this.state.schedule[aOldKey];
    const bVal = this.state.schedule[bOldKey];
    delete this.state.schedule[aOldKey];
    delete this.state.schedule[bOldKey];
    this.state.schedule[`${clsA}|${d2}|${s2}`] = aVal;
    if (bVal) this.state.schedule[`${clsB}|${d1}|${s1}`] = bVal;
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

  // Un swap A↔B (chacun gardant sa classe/matière/prof, seul le créneau
  // bouge) est valide si :
  //  1. Ni A ni B (s'il existe) n'est épinglé, réunion/multi-prof, ou
  //     alternant semaine A/B — cette logique ne gère qu'un seul profId et
  //     une seule matière par cellule.
  //  2. Si clsA≠clsB : la classe A n'a pas déjà sa PROPRE session à (d2,s2),
  //     et symétriquement la classe B n'a pas déjà la sienne à (d1,s1) — sans
  //     ce garde-fou on écraserait une session tierce de cette classe-là.
  //     (Si clsA===clsB, ces deux positions sont exactement A et B elles-mêmes
  //     en train d'être échangées : pas un conflit, juste le swap classique.)
  //  3. prof_A disponible et libre à (d2, s2) — en excluant clsB (qui libère
  //     ce créneau) et clsA (qui y écrit désormais).
  //  4. Symétrique pour prof_B à (d1, s1) si B est occupé.
  canSwap(clsA, d1, s1, a, clsB, d2, s2, b) {
    if (a.pinned || b?.pinned || a.meeting || b?.meeting || a.weekA || a.weekB || b?.weekA || b?.weekB) return false;

    if (clsA !== clsB) {
      if (this.state.schedule[`${clsA}|${d2}|${s2}`]) return false;
      if (b && this.state.schedule[`${clsB}|${d1}|${s1}`]) return false;
    }

    const profA = this.state.profs.find(p => p.id === a.profId);
    if (!profA || !profA.availability?.[d2]?.[s2]) return false;
    for (const c of this.state.config.classes) {
      if (c === clsB || c === clsA) continue;
      const cell = this.state.schedule[`${c}|${d2}|${s2}`];
      if (this.cellOccupiesProf(cell, profA.id)) return false;
    }

    if (b) {
      const profB = this.state.profs.find(p => p.id === b.profId);
      if (!profB || !profB.availability?.[d1]?.[s1]) return false;
      for (const c of this.state.config.classes) {
        if (c === clsA || c === clsB) continue;
        const cell = this.state.schedule[`${c}|${d1}|${s1}`];
        if (this.cellOccupiesProf(cell, profB.id)) return false;
      }
    }
    return true;
  },

  // Même mécanique que handleSwapClick, mais pour la vue "emploi du temps
  // d'un prof" : les cellules y sont indexées par classe comme ailleurs, mais
  // une cellule vide n'a pas de classe associée dans CETTE vue (le prof est
  // juste libre) — highlightProfSwapTargets le résout dynamiquement.
  handleProfSwapClick(td, profId) {
    const cls = td.dataset.cls || td.dataset.swapCls;
    const d = +td.dataset.d, s = +td.dataset.s;
    const key = `${cls}|${d}|${s}`;
    const cell = this.state.schedule[key];

    if (!this._swap) {
      if (!cell) return;
      this._swap = { cls, d, s };
      td.classList.add('swap-selected');
      this.highlightProfSwapTargets(profId, cls, d, s);
      return;
    }

    if (this._swap.cls === cls && this._swap.d === d && this._swap.s === s) {
      this.clearSwapHighlight();
      this._swap = null;
      return;
    }

    if (!td.classList.contains('swap-target')) {
      // Pas de cible directe. Le créneau cliqué peut quand même porter une
      // vraie session pour une classe quelconque (invisible dans CETTE vue
      // prof si un autre prof l'enseigne) : on la cherche pour proposer de
      // forcer l'échange plutôt que de simplement annuler la sélection.
      let targetCls = cls, targetCell = cell;
      if (!targetCls) {
        for (const c of this.state.config.classes) {
          const found = this.state.schedule[`${c}|${d}|${s}`];
          if (found) { targetCls = c; targetCell = found; break; }
        }
      }
      const clsA = this._swap.cls, d1 = this._swap.d, s1 = this._swap.s;
      this.clearSwapHighlight();
      this._swap = null;
      if (targetCls && targetCell && !this.isLocked(targetCell) && confirm(
        'Cet échange n\'est pas directement possible (prof indisponible ou déjà occupé ailleurs). ' +
        'Chercher un moyen de le faire quand même, en déplaçant ce qui bloque ?'
      )) {
        this.runForceSwap(clsA, d1, s1, targetCls, d, s);
      }
      return;
    }

    this.performSwap(this._swap.cls, this._swap.d, this._swap.s, cls, d, s);
    this._swap = null;
    this.onChange();
    this.renderSchedule();
  },

  highlightProfSwapTargets(profId, clsA, d, s) {
    const cellA = this.state.schedule[`${clsA}|${d}|${s}`];
    if (!cellA) return;
    document.querySelectorAll('#schedule-container .cell-sched').forEach(td => {
      const d2 = +td.dataset.d, s2 = +td.dataset.s;
      if (d2 === d && s2 === s) return;
      const existingCls = td.dataset.cls;
      if (existingCls) {
        // Cellule où CE prof enseigne déjà (à une autre classe) : cible directe.
        const cellB = this.state.schedule[`${existingCls}|${d2}|${s2}`];
        if (this.canSwap(clsA, d, s, cellA, existingCls, d2, s2, cellB)) {
          td.classList.add('swap-target');
        }
        return;
      }
      // Cellule vide dans la vue de ce prof : soit occupée par une AUTRE
      // classe — donnée par un AUTRE prof, donc invisible dans cette vue —
      // (échange croisé, prioritaire : il y a un vrai contenu à échanger là,
      // peu importe sa matière), soit un créneau réellement libre pour clsA
      // (simple déplacement, en dernier recours seulement : sinon on
      // masquerait l'échange croisé derrière un déplacement trivial).
      let match = null;
      for (const clsCandidate of this.state.config.classes) {
        if (clsCandidate === clsA) continue;
        const cellB = this.state.schedule[`${clsCandidate}|${d2}|${s2}`];
        if (!cellB) continue; // rien à échanger avec une classe qui n'a rien ici
        if (this.canSwap(clsA, d, s, cellA, clsCandidate, d2, s2, cellB)) {
          match = clsCandidate;
          break;
        }
      }
      if (!match && this.canSwap(clsA, d, s, cellA, clsA, d2, s2, undefined)) {
        match = clsA;
      }
      if (match) {
        // Attribut dédié (jamais dataset.cls, réservé aux vraies sessions posées
        // au rendu) : sinon la mutation persiste sur ce <td> après annulation
        // (clearSwapHighlight ne touchait pas dataset.cls) et pollue la
        // recherche de cible au prochain essai — un ancien match figé sur une
        // case en réalité vide se faisait alors passer pour "le prof y enseigne
        // déjà", court-circuitant le vrai calcul cross-classe et ne laissant
        // plus apparaître que les échanges de la même classe.
        td.dataset.swapCls = match; // fige la classe cible pour le clic suivant
        td.classList.add('swap-target');
      }
    });
  },

  // Une réunion sans classe vit sous une clé fictive "@meeting:<id>" (voir
  // buildContext dans solver.js) — c'est un créneau à profs multiples, sans
  // matière ni volumes à préserver, donc pas de "swap" au sens de canSwap
  // (qui suppose un seul prof) : juste un DÉPLACEMENT vers un créneau libre
  // où TOUS les profs requis sont à la fois disponibles et non occupés
  // ailleurs (autre classe ou autre réunion) à ce moment-là.
  handleMeetingSwapClick(td, meetingId) {
    const d = +td.dataset.d, s = +td.dataset.s;
    const pseudoKey = `@meeting:${meetingId}`;
    const key = `${pseudoKey}|${d}|${s}`;
    const cell = this.state.schedule[key];

    if (!this._swap) {
      if (!cell) return;
      this._swap = { meetingId, d, s };
      td.classList.add('swap-selected');
      this.highlightMeetingSwapTargets(meetingId, d, s);
      return;
    }

    if (this._swap.meetingId === meetingId && this._swap.d === d && this._swap.s === s) {
      this.clearSwapHighlight();
      this._swap = null;
      return;
    }

    if (!td.classList.contains('swap-target')) {
      this.clearSwapHighlight();
      this._swap = null;
      return;
    }

    const aKey = `${pseudoKey}|${this._swap.d}|${this._swap.s}`;
    const a = this.state.schedule[aKey];
    delete this.state.schedule[aKey];
    this.state.schedule[key] = a;
    this._swap = null;
    this.onChange();
    this.renderSchedule();
  },

  highlightMeetingSwapTargets(meetingId, d, s) {
    const meeting = this.state.constraints.meetings.find(m => m.id === meetingId);
    if (!meeting) return;
    document.querySelectorAll('#schedule-container .cell-sched[data-meeting]').forEach(td => {
      if (td.dataset.meeting !== meetingId) return;
      const d2 = +td.dataset.d, s2 = +td.dataset.s;
      if (d2 === d && s2 === s) return;
      if (this.canMoveMeeting(meeting, d2, s2)) {
        td.classList.add('swap-target');
      }
    });
  },

  // Vrai si le créneau (d2,s2) est ouvert et si TOUS les profs requis par la
  // réunion y sont disponibles et non occupés ailleurs. Ne gère que le cas
  // "déplacer vers une case vide" : la cible ne doit pas déjà porter cette
  // réunion (cellule vide, pas d'autre réunion en même temps).
  canMoveMeeting(meeting, d2, s2) {
    const openSlots = this.state.config.openSlots || [];
    if ((openSlots[d2] || [])[s2] === false) return false;
    if (this.state.schedule[`@meeting:${meeting.id}|${d2}|${s2}`]) return false;

    for (const profId of meeting.profIds) {
      const prof = this.state.profs.find(p => p.id === profId);
      if (!prof || !prof.availability?.[d2]?.[s2]) return false;
      // Classes (dont les réunions co-enseignées AVEC classes, qui écrivent
      // directement sous la clé de la classe comme une session normale).
      for (const c of this.state.config.classes) {
        const cell = this.state.schedule[`${c}|${d2}|${s2}`];
        if (this.cellOccupiesProf(cell, profId)) return false;
      }
      // Autres réunions SANS classe (clé fictive "@meeting:<id>").
      for (const m of this.state.constraints.meetings || []) {
        if (m.id === meeting.id || (m.classes && m.classes.length > 0)) continue;
        const cell = this.state.schedule[`@meeting:${m.id}|${d2}|${s2}`];
        if (this.cellOccupiesProf(cell, profId)) return false;
      }
    }
    return true;
  },

  clearSwapHighlight() {
    document.querySelectorAll('.swap-selected, .swap-target').forEach(el => {
      el.classList.remove('swap-selected', 'swap-target');
      delete el.dataset.swapCls;
    });
  },
});
