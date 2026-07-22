// solver.js — moteur de génération d'emploi du temps.
// Fonction pure : prend un état, rend {schedule, ok, message}.
// Algorithme: backtracking avec heuristiques (MRV + assign le plus contraint d'abord).
//
// Modèle:
//   - "session" = 1 créneau de cours à placer (classe × matière)
//   - Pour chaque volume horaire N (ex: Maths 6e = 4h), on crée N sessions.
//   - Chaque session doit trouver: (jour, slot, prof) tel que
//       * prof enseigne cette matière
//       * prof libre à ce (jour, slot)  ET  dispo (availability = true)
//       * classe libre à ce (jour, slot)

const Solver = {
  solve(state) {
    const { config, profs, volumes, options } = state;
    const constraints = state.constraints || { pins: [], timePref: {} };
    const dayIdxs = config.activeDays.map((a, i) => a ? i : -1).filter(i => i >= 0);
    const slotCount = config.slots.length;
    const totalSlotsPerClass = dayIdxs.length * slotCount;

    // ---------- Construction de la demande (volumes bruts) ----------
    // On les stocke dans un dict pour pouvoir décrémenter avec les épingles.
    const demandMap = {}; // "cls|subj" -> heures restantes
    for (const cls of config.classes) {
      for (const subj of config.subjects) {
        const h = volumes[`${cls}|${subj}`] || 0;
        if (h > 0) demandMap[`${cls}|${subj}`] = h;
      }
    }

    // ---------- Application des épingles ----------
    // Chaque épingle : (subj, classes[], day, slot, profId?) → placée en dur.
    // Effets : décrémente demandMap, marque busy, écrit dans schedule.
    // Erreurs claires si : classe/matière/prof inconnus, jour désactivé, volume
    // déjà épuisé, conflit prof, conflit classe, prof indispo.
    const pinnedSchedule = {};
    const pinnedBusyClass = {}; // "cls|d|s" -> true
    const pinnedBusyProf = {};  // "profId|d|s" -> true
    const pinErrors = [];

    for (const pin of (constraints.pins || [])) {
      const label = `Épingle ${pin.subj} · ${(pin.classes || []).join('+')} · ${config.days[pin.day]} #${pin.slot + 1}`;
      if (!config.subjects.includes(pin.subj)) { pinErrors.push(`${label} : matière inconnue.`); continue; }
      if (!config.activeDays[pin.day]) { pinErrors.push(`${label} : jour désactivé.`); continue; }
      if (pin.slot < 0 || pin.slot >= slotCount) { pinErrors.push(`${label} : créneau invalide.`); continue; }
      let bad = false;
      for (const cls of pin.classes) {
        if (!config.classes.includes(cls)) { pinErrors.push(`${label} : classe ${cls} inconnue.`); bad = true; }
      }
      if (bad) continue;

      // Volume dispo dans chaque classe ?
      for (const cls of pin.classes) {
        const k = `${cls}|${pin.subj}`;
        if ((demandMap[k] || 0) < 1) {
          pinErrors.push(`${label} : ${cls} n'a plus d'heure de ${pin.subj} à placer (volume horaire épuisé ou nul).`);
          bad = true;
        }
      }
      if (bad) continue;

      // Prof : si spécifié, vérifie qu'il enseigne la matière pour chaque classe.
      let profId = pin.profId || null;
      if (profId) {
        const prof = profs.find(p => p.id === profId);
        if (!prof) { pinErrors.push(`${label} : prof inconnu.`); continue; }
        for (const cls of pin.classes) {
          if (!(prof.subjectClasses?.[pin.subj] || []).includes(cls)) {
            pinErrors.push(`${label} : ${prof.name} n'enseigne pas ${pin.subj} en ${cls}.`);
            bad = true;
          }
        }
        if (bad) continue;
        if (!prof.availability?.[pin.day]?.[pin.slot]) {
          pinErrors.push(`${label} : ${prof.name} est indisponible sur ce créneau.`);
          continue;
        }
        if (pinnedBusyProf[`${profId}|${pin.day}|${pin.slot}`]) {
          pinErrors.push(`${label} : ${prof.name} est déjà pris par une autre épingle sur ce créneau.`);
          continue;
        }
      }

      // Conflits classe
      for (const cls of pin.classes) {
        if (pinnedBusyClass[`${cls}|${pin.day}|${pin.slot}`]) {
          pinErrors.push(`${label} : ${cls} déjà occupée par une autre épingle sur ce créneau.`);
          bad = true;
        }
      }
      if (bad) continue;

      // Appliquer.
      for (const cls of pin.classes) {
        demandMap[`${cls}|${pin.subj}`] -= 1;
        if (demandMap[`${cls}|${pin.subj}`] === 0) delete demandMap[`${cls}|${pin.subj}`];
        pinnedBusyClass[`${cls}|${pin.day}|${pin.slot}`] = true;
        pinnedSchedule[`${cls}|${pin.day}|${pin.slot}`] = { profId, subj: pin.subj, pinned: true };
      }
      if (profId) pinnedBusyProf[`${profId}|${pin.day}|${pin.slot}`] = true;
    }

    if (pinErrors.length > 0) {
      return { ok: false, message: 'Épingles invalides :\n• ' + pinErrors.join('\n• ') };
    }

    // Reconstitution de la demande post-épingles.
    const demand = [];
    for (const cls of config.classes) {
      for (const subj of config.subjects) {
        const h = demandMap[`${cls}|${subj}`] || 0;
        if (h > 0) demand.push({ cls, subj, hours: h });
      }
    }
    if (demand.length === 0 && Object.keys(pinnedSchedule).length === 0) {
      return { ok: false, message: 'Aucun volume horaire renseigné. Va dans Configuration → Volumes horaires.' };
    }

    // ---------- Pré-vérifications ----------
    const errors = [];
    // Un prof est éligible pour (matière, classe) s'il enseigne la matière
    // ET si la classe est dans sa liste (absence de liste = toutes les classes).
    // Un prof enseigne une (matière, classe) si :
    // - nouveau modèle : subjectClasses[subj] contient cls, OU
    // - ancien modèle (rétro-compat) : subjects contient subj ET (classes contient cls, ou classes est absent)
    const teachesPair = (p, subj, cls) => {
      if (p.subjectClasses) {
        return (p.subjectClasses[subj] || []).includes(cls);
      }
      if (!(p.subjects || []).includes(subj)) return false;
      return p.classes === undefined || p.classes.includes(cls);
    };
    const eligibleFor = (subj, cls) => profs.filter(p => teachesPair(p, subj, cls));
    // Temps déjà consommé par les épingles pour chaque prof — à défalquer de sa dispo effective.
    const pinnedProfCount = {};
    for (const pin of (constraints.pins || [])) {
      if (pin.profId) pinnedProfCount[pin.profId] = (pinnedProfCount[pin.profId] || 0) + 1;
    }
    const availCountFor = (prof) => {
      if (!prof.availability) return 0;
      let n = 0;
      for (const d of dayIdxs) {
        for (let s = 0; s < slotCount; s++) {
          if (prof.availability[d]?.[s]) n++;
        }
      }
      return n - (pinnedProfCount[prof.id] || 0);
    };

    // Check 1 : chaque matière demandée doit avoir au moins un prof.
    for (const d of demand) {
      if (eligibleFor(d.subj, d.cls).length === 0) {
        errors.push(`Aucun prof n'enseigne "${d.subj}" — mais ${d.hours}h sont demandées pour ${d.cls}. Va dans Professeurs et coche cette matière chez un prof.`);
      }
    }

    // Check 2 : pour chaque (classe, matière), il faut au moins autant de créneaux où
    // un prof éligible est dispo que d'heures demandées.
    const flaggedBySubject = new Set(); // matières déjà signalées par Check 2
    for (const d of demand) {
      const elig = eligibleFor(d.subj, d.cls);
      if (elig.length === 0) continue;
      let cap = 0;
      for (const dayI of dayIdxs) {
        for (let s = 0; s < slotCount; s++) {
          if (elig.some(p => p.availability?.[dayI]?.[s])) cap++;
        }
      }
      if (cap < d.hours) {
        errors.push(`${d.cls} · ${d.subj} : ${d.hours}h demandées mais seulement ${cap} créneau(x) où un prof éligible est dispo. Profs concernés : ${elig.map(p => p.name).join(', ') || '—'}. Ajoute des dispos à ces profs ou réduis le volume.`);
        flaggedBySubject.add(d.subj);
      }
    }

    // Check 3 : total d'heures d'une classe > nombre de créneaux dans la semaine.
    for (const cls of config.classes) {
      const total = demand.filter(d => d.cls === cls).reduce((s, d) => s + d.hours, 0);
      if (total > totalSlotsPerClass) {
        errors.push(`Classe ${cls} : ${total}h à caser mais seulement ${totalSlotsPerClass} créneaux dans la semaine (${dayIdxs.length} jours × ${slotCount} créneaux). Réduis les volumes ou ajoute des créneaux/jours.`);
      }
    }

    // Check 4 : si une matière n'a qu'UN seul prof éligible, sa charge exclusive
    // ne doit pas dépasser ses dispos totales.
    // On ignore les matières déjà signalées par Check 2 pour éviter les doublons —
    // cette vérif n'est utile que pour détecter la SOMME sur plusieurs matières.
    const exclusiveByProf = {};   // total charge exclusive
    const remainingByProf = {};   // charge exclusive non déjà couverte par Check 2
    const subjectsByProf = {};    // matières exclusives non couvertes
    for (const d of demand) {
      const elig = eligibleFor(d.subj, d.cls);
      if (elig.length !== 1) continue;
      const pid = elig[0].id;
      exclusiveByProf[pid] = (exclusiveByProf[pid] || 0) + d.hours;
      if (!flaggedBySubject.has(d.subj)) {
        remainingByProf[pid] = (remainingByProf[pid] || 0) + d.hours;
        (subjectsByProf[pid] = subjectsByProf[pid] || new Set()).add(d.subj);
      }
    }
    for (const p of profs) {
      const remaining = remainingByProf[p.id] || 0;
      if (remaining === 0) continue;  // tout déjà signalé plus finement par Check 2
      const avail = availCountFor(p);
      if (remaining > avail) {
        const subs = [...subjectsByProf[p.id]].join(', ');
        errors.push(`${p.name} : seul prof pour ${remaining}h cumulées (${subs}) mais seulement ${avail} créneau(x) de dispo. Ajoute des dispos ou fais enseigner ces matières par un autre prof.`);
      }
    }

    if (errors.length > 0) {
      return {
        ok: false,
        message: 'Configuration infaisable — ' + errors.length + ' problème(s) :\n• ' + errors.join('\n• '),
      };
    }

    // ---------- Backtracking ----------
    const busyClass = {};
    for (const cls of config.classes) {
      busyClass[cls] = config.days.map(() => new Array(slotCount).fill(false));
    }
    const busyProf = {};
    for (const p of profs) {
      busyProf[p.id] = config.days.map(() => new Array(slotCount).fill(false));
    }

    const schedule = {};
    for (const k of Object.keys(pinnedSchedule)) {
      schedule[k] = pinnedSchedule[k];
      const [cls, d, s] = k.split('|');
      busyClass[cls][+d][+s] = true;
      const profId = pinnedSchedule[k].profId;
      if (profId) busyProf[profId][+d][+s] = true;
    }
    const placed = [];

    // Préférence horaire par matière : biaise l'ordre des candidats.
    // early → petit slot d'abord ; late → grand slot d'abord ; any → neutre.
    const timePref = constraints.timePref || {};
    const timeScore = (subj, slot) => {
      const pref = timePref[subj];
      if (pref === 'early') return slot;              // + petit = mieux
      if (pref === 'late')  return -slot;             // + grand = mieux (donc score négatif)
      return 0;
    };

    const sessions = [];
    for (const d of demand) {
      for (let i = 0; i < d.hours; i++) sessions.push({ cls: d.cls, subj: d.subj });
    }
    // Trier : les sessions les plus contraintes d'abord (peu de profs éligibles).
    sessions.sort((a, b) => eligibleFor(a.subj, a.cls).length - eligibleFor(b.subj, b.cls).length);

    const candidatesFor = (sess) => {
      const elig = eligibleFor(sess.subj, sess.cls);
      const list = [];
      for (const d of dayIdxs) {
        for (let s = 0; s < slotCount; s++) {
          if (busyClass[sess.cls][d][s]) continue;
          for (const prof of elig) {
            if (busyProf[prof.id][d][s]) continue;
            if (!prof.availability?.[d]?.[s]) continue;
            list.push({ day: d, slot: s, profId: prof.id });
          }
        }
      }
      return list;
    };

    // Suivi de la session la plus profonde jamais atteinte, pour diagnostic si échec.
    let deepestIdx = -1;
    let deepestSnapshot = [];

    // Budget d'itérations : si un pré-check laisse passer une infaisabilité subtile
    // (ex: contention cumulée entre plusieurs profs / classes), on abandonne au lieu de figer la page.
    let iterCount = 0;
    const MAX_ITER = 500000;
    let aborted = false;

    const backtrack = (idx) => {
      if (aborted) return false;
      if (++iterCount > MAX_ITER) { aborted = true; return false; }
      if (idx > deepestIdx) {
        deepestIdx = idx;
        deepestSnapshot = placed.map(p => ({ ...p.sess }));
      }
      if (idx >= sessions.length) return true;
      const sess = sessions[idx];
      const cands = candidatesFor(sess);
      if (cands.length === 0) return false;

      if (options.randomize) {
        // Fisher-Yates : ordre aléatoire des candidats.
        // Le backtracking reste complet : l'ordre n'élimine aucune solution.
        for (let i = cands.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [cands[i], cands[j]] = [cands[j], cands[i]];
        }
        if (options.noGapsForStudents) {
          // Stable : on garde le mélange comme tie-breaker.
          cands.sort((a, b) => {
            const compact = (c) => {
              let score = 0;
              for (let s = c.slot - 1; s <= c.slot + 1; s++) {
                if (s >= 0 && s < slotCount && busyClass[sess.cls][c.day][s]) score--;
              }
              return score;
            };
            return compact(a) - compact(b);
          });
        }
      } else {
        cands.sort((a, b) => {
          if (options.noGapsForStudents) {
            const compact = (c) => {
              let score = 0;
              for (let s = c.slot - 1; s <= c.slot + 1; s++) {
                if (s >= 0 && s < slotCount && busyClass[sess.cls][c.day][s]) score--;
              }
              return score;
            };
            const dc = compact(a) - compact(b);
            if (dc !== 0) return dc;
          }
          const dt = timeScore(sess.subj, a.slot) - timeScore(sess.subj, b.slot);
          if (dt !== 0) return dt;
          return a.slot - b.slot;
        });
      }

      for (const c of cands) {
        busyClass[sess.cls][c.day][c.slot] = true;
        busyProf[c.profId][c.day][c.slot] = true;
        schedule[`${sess.cls}|${c.day}|${c.slot}`] = { profId: c.profId, subj: sess.subj };
        placed.push({ sess, c });

        if (backtrack(idx + 1)) return true;

        busyClass[sess.cls][c.day][c.slot] = false;
        busyProf[c.profId][c.day][c.slot] = false;
        delete schedule[`${sess.cls}|${c.day}|${c.slot}`];
        placed.pop();
      }
      return false;
    };

    const ok = backtrack(0);
    if (ok) {
      const nPins = Object.keys(pinnedSchedule).length;
      const suffix = nPins > 0 ? ` (${nPins} épinglé(s))` : '';
      return { ok: true, schedule, message: `Emploi du temps généré : ${sessions.length + nPins} créneaux placés${suffix}.` };
    }

    if (aborted) {
      return {
        ok: false,
        message:
          `Recherche interrompue après ${MAX_ITER.toLocaleString('fr')} itérations : la configuration semble infaisable ou trop contrainte.\n` +
          `Vérifie les épingles (elles bloquent des créneaux) et les profs uniques sur plusieurs matières.`,
      };
    }

    // ---------- Diagnostic post-échec ----------
    // À la profondeur maximale atteinte, on regarde quelle session a bloqué,
    // et on rapporte ce qui a pu être casé pour la même (classe, matière).
    const blocking = sessions[deepestIdx];
    const sameDone = deepestSnapshot.filter(s => s.cls === blocking.cls && s.subj === blocking.subj).length;
    const totalSame = sessions.filter(s => s.cls === blocking.cls && s.subj === blocking.subj).length;
    const elig = eligibleFor(blocking.subj, blocking.cls);

    // Récap par (classe, matière) : combien placés au moment du blocage
    const summary = {};
    for (const s of deepestSnapshot) {
      const k = `${s.cls} · ${s.subj}`;
      summary[k] = (summary[k] || 0) + 1;
    }
    const lines = [];
    for (const d of demand) {
      const k = `${d.cls} · ${d.subj}`;
      const done = summary[k] || 0;
      if (done < d.hours) {
        lines.push(`  ${k} : ${done}/${d.hours}h casées`);
      }
    }

    return {
      ok: false,
      message:
        `Impossible de placer la ${sameDone + 1}ᵉ heure de ${blocking.subj} en ${blocking.cls} ` +
        `(${sameDone}/${totalSame}h placées avant blocage).\n` +
        `Profs éligibles pour ${blocking.subj} : ${elig.map(p => p.name).join(', ')}.\n` +
        `Cause probable : leurs dispos sont déjà prises par d'autres cours de cette classe ou par les autres classes.\n\n` +
        `État au moment du blocage — cours non complétés :\n${lines.join('\n')}\n\n` +
        `Piste : donne plus de dispos aux profs de ${blocking.subj}, ou ajoute un prof pour cette matière, ou réduis le volume.`,
    };
  },
};
