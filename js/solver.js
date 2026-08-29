// solver.js — moteur de génération d'emploi du temps.
// Fonction pure : prend un état, rend {schedule, ok, message}.
//
// Algorithme : CSP par backtracking avec :
//   - MRV dynamique : à CHAQUE nœud (pas une fois au départ), on choisit la
//     session dont le domaine courant (nb de (jour,slot,prof) encore valides)
//     est le plus petit — la "session la plus contrainte" change au fil de
//     la recherche à mesure que les créneaux se remplissent.
//   - Forward-checking : après un placement d'essai, on vérifie si une autre
//     session non placée se retrouve avec un domaine vide ; si oui on élague
//     immédiatement (sans récurser dedans) — ça anticipe les blocages futurs
//     au lieu de les découvrir plusieurs niveaux plus bas.
//   - Budget itérations + temps réel : garantit que la recherche se termine
//     toujours (le CSP reste NP-difficile, MRV+FC réduisent juste énormément
//     le nombre de nœuds explorés en pratique sur des instances scolaires).
//   - Diagnostic par agrégation de conflits : chaque impasse et chaque
//     wipeout de forward-checking est comptabilisé pendant toute la
//     recherche ; en cas d'échec, on explique les points de blocage les
//     plus fréquents plutôt qu'un simple "point le plus profond atteint".
//     On distingue aussi "prouvé impossible" (recherche exhaustive) de
//     "budget dépassé" (indéterminé).
//
// Modèle:
//   - "session" = 1 créneau de cours à placer (classe × matière)
//   - Pour chaque volume horaire N (ex: Maths 6e = 4h), on crée N sessions.
//   - Chaque session doit trouver: (jour, slot, prof) tel que
//       * prof enseigne cette matière
//       * prof libre à ce (jour, slot)  ET  dispo (availability = true)
//       * classe libre à ce (jour, slot)

// Construit le contexte partagé entre `solve()` et `analyzeProfLoad()` :
// applique épingles + regroupements sur la demande brute, et prépare les
// helpers d'éligibilité/disponibilité. Centralisé ici pour qu'il n'existe
// qu'UNE SEULE définition de "combien d'heures un prof doit-il couvrir" —
// deux implémentations qui divergent est une classe de bug déjà rencontrée
// dans ce fichier (voir CLAUDE.md).
function buildContext(state) {
  const { config, profs, volumes, options } = state;
  const constraints = state.constraints || { pins: [] };
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

    // ---------- Application des regroupements de classes ----------
    // Un "groupe" : (subj, classes[], hours, profId?) — N heures de cette
    // matière que ces classes suivent TOUJOURS ensemble (même prof, même
    // créneau), mais SANS jour/créneau imposé : contrairement à une épingle,
    // c'est le solveur qui choisit quand (comme pour une session normale).
    // Effet : décrémente demandMap comme une épingle, mais au lieu d'écrire
    // directement dans schedule, alimente `groups`, qui donnera des sessions
    // multi-classes à la recherche (voir plus bas).
    const groups = [];
    const groupErrors = [];

    for (const g of (constraints.groups || [])) {
      const label = `Groupe ${g.subj} · ${(g.classes || []).join('+')}`;
      if (!config.subjects.includes(g.subj)) { groupErrors.push(`${label} : matière inconnue.`); continue; }
      const hours = g.hours || 0;
      if (hours < 1) { groupErrors.push(`${label} : nombre d'heures invalide.`); continue; }
      if ((g.classes || []).length < 2) { groupErrors.push(`${label} : un groupe doit contenir au moins 2 classes.`); continue; }
      let bad = false;
      for (const cls of g.classes) {
        if (!config.classes.includes(cls)) { groupErrors.push(`${label} : classe ${cls} inconnue.`); bad = true; }
      }
      if (bad) continue;

      // Volume dispo dans chaque classe ?
      for (const cls of g.classes) {
        const k = `${cls}|${g.subj}`;
        if ((demandMap[k] || 0) < hours) {
          groupErrors.push(`${label} : ${cls} n'a que ${demandMap[k] || 0}h de ${g.subj} restante(s), il en faut ${hours} pour ce groupe.`);
          bad = true;
        }
      }
      if (bad) continue;

      // Profs éligibles = ceux qui enseignent la matière à TOUTES les classes du groupe à la fois.
      let elig = profs.filter(p => g.classes.every(cls => teachesPair(p, g.subj, cls)));
      if (g.profId) {
        const prof = profs.find(p => p.id === g.profId);
        if (!prof) { groupErrors.push(`${label} : prof inconnu.`); continue; }
        if (!elig.some(p => p.id === g.profId)) {
          groupErrors.push(`${label} : ${prof.name} n'enseigne pas ${g.subj} à toutes les classes du groupe.`);
          continue;
        }
        elig = [prof];
      }
      if (elig.length === 0) {
        groupErrors.push(`${label} : aucun prof n'enseigne ${g.subj} à toutes ces classes à la fois.`);
        continue;
      }

      // Appliquer : décrémente le volume de chaque classe du groupe.
      for (const cls of g.classes) {
        demandMap[`${cls}|${g.subj}`] -= hours;
        if (demandMap[`${cls}|${g.subj}`] === 0) delete demandMap[`${cls}|${g.subj}`];
      }
      groups.push({ subj: g.subj, classes: g.classes, hours, elig });
    }

    if (groupErrors.length > 0) {
      return { ok: false, message: 'Regroupements invalides :\n• ' + groupErrors.join('\n• ') };
    }

    // ---------- Répartition sur des jours différents ----------
    // Une règle "spread" : (subj, classes[]) — pour CHAQUE classe listée,
    // interdit à la recherche de placer 2 heures de cette matière le même
    // jour. Contrairement à une épingle, ne fixe NI le jour NI le créneau :
    // le solveur garde toute liberté, juste avec cette restriction en plus.
    // `spreadPairs` : Set de "cls|subj" auxquels la règle s'applique.
    const spreadPairs = new Set();
    const spreadErrors = [];
    for (const sp of (constraints.spread || [])) {
      const label = `Répartition ${sp.subj} · ${(sp.classes || []).join('+')}`;
      if (!config.subjects.includes(sp.subj)) { spreadErrors.push(`${label} : matière inconnue.`); continue; }
      if (!(sp.classes || []).length) { spreadErrors.push(`${label} : aucune classe sélectionnée.`); continue; }
      let bad = false;
      for (const cls of sp.classes) {
        if (!config.classes.includes(cls)) { spreadErrors.push(`${label} : classe ${cls} inconnue.`); bad = true; }
      }
      if (bad) continue;
      for (const cls of sp.classes) spreadPairs.add(`${cls}|${sp.subj}`);
    }
    if (spreadErrors.length > 0) {
      return { ok: false, message: 'Règles de répartition invalides :\n• ' + spreadErrors.join('\n• ') };
    }

    // Reconstitution de la demande post-épingles/groupes.
    const demand = [];
    for (const cls of config.classes) {
      for (const subj of config.subjects) {
        const h = demandMap[`${cls}|${subj}`] || 0;
        if (h > 0) demand.push({ cls, subj, hours: h });
      }
    }
    if (demand.length === 0 && Object.keys(pinnedSchedule).length === 0 && groups.length === 0) {
      return { ok: false, message: 'Aucun volume horaire renseigné. Va dans Configuration → Volumes horaires.' };
    }

    // Dispo effective d'un prof = ses disponibilités déclarées MOINS les
    // créneaux déjà consommés par des épingles (peu importe la matière de
    // l'épingle : un prof épinglé ailleurs à 10h n'est plus libre à 10h).
    const availCountFor = (prof) => {
      if (!prof.availability) return 0;
      let n = 0;
      for (const d of dayIdxs) {
        for (let s = 0; s < slotCount; s++) {
          if (prof.availability[d]?.[s] && !pinnedBusyProf[`${prof.id}|${d}|${s}`]) n++;
        }
      }
      return n;
    };
    // Nombre de créneaux d'une classe déjà consommés par des épingles (toutes matières
    // confondues) — à défalquer de sa capacité brute pour connaître ses créneaux VRAIMENT libres.
    const pinnedSlotsByClass = {};
    for (const key of Object.keys(pinnedBusyClass)) {
      const cls = key.split('|')[0];
      pinnedSlotsByClass[cls] = (pinnedSlotsByClass[cls] || 0) + 1;
    }
    // Idem pour les regroupements : chaque heure de groupe consomme 1 créneau
    // dans CHAQUE classe du groupe (même si elles le partagent), à ajouter à
    // la charge de la classe pour le Check 3.
    const groupSlotsByClass = {};
    for (const g of groups) {
      for (const cls of g.classes) {
        groupSlotsByClass[cls] = (groupSlotsByClass[cls] || 0) + g.hours;
      }
    }

    // ---------- Variables (sessions) et domaines ----------
    // Une "session" = une heure de (classes[], matière) à placer — `classes`
    // contient 1 classe pour une session normale, ou plusieurs pour un
    // regroupement (elles doivent toutes être libres au même (jour, slot),
    // et partagent le même prof). Construit ici (pas dans `solve()`) car
    // `repair()` (recherche locale) en a besoin aussi, sur la même base.
    const sessions = [];
    for (const d of demand) {
      const elig = eligibleFor(d.subj, d.cls);
      const pairKey = `${d.cls}|${d.subj}`;
      const spreadKey = spreadPairs.has(pairKey) ? pairKey : null;
      for (let i = 0; i < d.hours; i++) sessions.push({ classes: [d.cls], subj: d.subj, elig, spreadKey });
    }
    for (const g of groups) {
      // Une règle de répartition ne s'applique qu'à une classe seule (elle
      // porte sur SA propre semaine) — pas de sens pour un groupe multi-classes.
      for (let i = 0; i < g.hours; i++) sessions.push({ classes: g.classes, subj: g.subj, elig: g.elig, spreadKey: null });
    }

    return {
      ok: true, config, profs, options, dayIdxs, slotCount, totalSlotsPerClass,
      demand, groups, sessions, pinnedSchedule, pinnedBusyClass, pinnedBusyProf,
      pinnedSlotsByClass, groupSlotsByClass, spreadPairs, teachesPair, eligibleFor, availCountFor,
    };
}

const Solver = {
  solve(state) {
    const ctx = buildContext(state);
    if (!ctx.ok) return ctx;
    const {
      config, profs, options, dayIdxs, slotCount, totalSlotsPerClass,
      demand, groups, sessions, pinnedSchedule, pinnedBusyClass, pinnedBusyProf,
      pinnedSlotsByClass, groupSlotsByClass, spreadPairs, eligibleFor, availCountFor,
    } = ctx;

    // ---------- Pré-vérifications ----------
    const errors = [];

    // Check 1 : chaque matière demandée doit avoir au moins un prof.
    for (const d of demand) {
      if (eligibleFor(d.subj, d.cls).length === 0) {
        errors.push(`Aucun prof n'enseigne "${d.subj}" — mais ${d.hours}h sont demandées pour ${d.cls}. Va dans Professeurs et coche cette matière chez un prof.`);
      }
    }

    // Check 1bis : une règle "jours différents" demande mécaniquement au moins
    // autant de jours actifs que d'heures à répartir.
    for (const d of demand) {
      if (spreadPairs.has(`${d.cls}|${d.subj}`) && d.hours > dayIdxs.length) {
        errors.push(`${d.cls} · ${d.subj} : ${d.hours}h à répartir sur des jours différents, mais seulement ${dayIdxs.length} jour(s) actif(s) dans la semaine.`);
      }
    }

    // Check 2 : pour chaque (classe, matière), il faut au moins autant de créneaux
    // VRAIMENT libres (prof dispo ET pas déjà pris par une épingle, classe pas déjà
    // occupée par une épingle sur une autre matière) que d'heures demandées.
    const flaggedBySubject = new Set(); // matières déjà signalées par Check 2
    for (const d of demand) {
      const elig = eligibleFor(d.subj, d.cls);
      if (elig.length === 0) continue;
      let cap = 0;
      for (const dayI of dayIdxs) {
        for (let s = 0; s < slotCount; s++) {
          if (pinnedBusyClass[`${d.cls}|${dayI}|${s}`]) continue; // classe déjà occupée par une épingle
          if (elig.some(p => p.availability?.[dayI]?.[s] && !pinnedBusyProf[`${p.id}|${dayI}|${s}`])) cap++;
        }
      }
      if (cap < d.hours) {
        errors.push(`${d.cls} · ${d.subj} : ${d.hours}h demandées mais seulement ${cap} créneau(x) réellement libre(s) (compte tenu des épingles déjà posées) où un prof éligible est dispo. Profs concernés : ${elig.map(p => p.name).join(', ') || '—'}. Ajoute des dispos à ces profs, déplace une épingle qui bloque ce créneau, ou réduis le volume.`);
        flaggedBySubject.add(d.subj);
      }
    }

    // Check 2bis : idem que Check 2 mais pour les regroupements — le créneau
    // doit convenir à TOUTES les classes du groupe en même temps.
    const flaggedGroups = new Set(); // index de groupe déjà signalé par Check 2bis
    groups.forEach((g, gi) => {
      let cap = 0;
      for (const dayI of dayIdxs) {
        for (let s = 0; s < slotCount; s++) {
          if (g.classes.some(cls => pinnedBusyClass[`${cls}|${dayI}|${s}`])) continue;
          if (g.elig.some(p => p.availability?.[dayI]?.[s] && !pinnedBusyProf[`${p.id}|${dayI}|${s}`])) cap++;
        }
      }
      if (cap < g.hours) {
        errors.push(`Groupe ${g.classes.join('+')} · ${g.subj} : ${g.hours}h à caser ensemble mais seulement ${cap} créneau(x) où TOUTES ces classes sont libres en même temps ET un prof éligible est dispo. Profs concernés : ${g.elig.map(p => p.name).join(', ') || '—'}.`);
        flaggedGroups.add(gi);
      }
    });

    // Check 3 : total d'heures d'une classe (hors épingles, donc "à caser" par le
    // solveur — y compris ses regroupements) > nombre de créneaux VRAIMENT libres
    // de la semaine, c'est-à-dire le total de la grille MOINS les créneaux déjà
    // pris par les épingles de cette classe.
    for (const cls of config.classes) {
      const total = demand.filter(d => d.cls === cls).reduce((s, d) => s + d.hours, 0) + (groupSlotsByClass[cls] || 0);
      const pinnedSlots = pinnedSlotsByClass[cls] || 0;
      const freeCapacity = totalSlotsPerClass - pinnedSlots;
      if (total > freeCapacity) {
        errors.push(
          `Classe ${cls} : ${total}h à caser mais seulement ${freeCapacity} créneau(x) libre(s) dans la semaine ` +
          `(${totalSlotsPerClass} créneaux au total = ${dayIdxs.length} jours × ${slotCount}` +
          (pinnedSlots > 0 ? `, dont ${pinnedSlots} déjà occupé(s) par des épingles` : '') +
          `). Réduis les volumes, ajoute des créneaux/jours, ou déplace des épingles.`
        );
      }
    }

    // Check 4 : si une matière (ou un regroupement) n'a qu'UN seul prof éligible,
    // sa charge exclusive ne doit pas dépasser ses dispos totales.
    // On ignore ce qui est déjà signalé par Check 2/2bis pour éviter les doublons —
    // cette vérif n'est utile que pour détecter la SOMME sur plusieurs matières/groupes.
    const exclusiveByProf = {};   // total charge exclusive
    const remainingByProf = {};   // charge exclusive non déjà couverte par Check 2/2bis
    const subjectsByProf = {};    // matières/groupes exclusifs non couverts
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
    groups.forEach((g, gi) => {
      if (g.elig.length !== 1) return;
      const pid = g.elig[0].id;
      exclusiveByProf[pid] = (exclusiveByProf[pid] || 0) + g.hours;
      if (!flaggedGroups.has(gi)) {
        remainingByProf[pid] = (remainingByProf[pid] || 0) + g.hours;
        (subjectsByProf[pid] = subjectsByProf[pid] || new Set()).add(`${g.subj} (groupe ${g.classes.join('+')})`);
      }
    });
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

    // ---------- Préparation de la recherche ----------
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

    // Jours déjà utilisés par une paire (cls,subj) sous règle de répartition —
    // "spreadKey|day" -> nb de sessions de cette paire déjà posées ce jour-là.
    // Tant que ça reste à 0, ce jour est ouvert pour cette paire ; dès qu'une
    // session s'y pose, il devient interdit aux AUTRES sessions de la même paire.
    const spreadUsedDay = {};

    // `sessions` (une heure de classes[]/matière à placer) vient de ctx — voir buildContext.

    // Index pour ne recalculer les domaines QUE des sessions concernées quand
    // on occupe (classes, day, slot) ou (profId, day, slot) : seules les
    // sessions partageant une de ces classes, ou éligibles pour ce prof,
    // peuvent voir leur domaine changer. Ça évite de tout recalculer à
    // chaque nœud (coûteux si on a des centaines de sessions).
    const sessionsByClass = {};
    const sessionsByProf = {};
    const sessionsBySpreadKey = {};
    sessions.forEach((sess, idx) => {
      for (const cls of sess.classes) {
        (sessionsByClass[cls] = sessionsByClass[cls] || []).push(idx);
      }
      for (const p of sess.elig) {
        (sessionsByProf[p.id] = sessionsByProf[p.id] || []).push(idx);
      }
      if (sess.spreadKey) {
        (sessionsBySpreadKey[sess.spreadKey] = sessionsBySpreadKey[sess.spreadKey] || []).push(idx);
      }
    });
    const affectedBy = (classesArr, profId, spreadKey) => {
      const set = new Set();
      for (const cls of classesArr) {
        for (const idx of (sessionsByClass[cls] || [])) set.add(idx);
      }
      for (const idx of (sessionsByProf[profId] || [])) set.add(idx);
      if (spreadKey) {
        for (const idx of (sessionsBySpreadKey[spreadKey] || [])) set.add(idx);
      }
      return set;
    };

    const candidatesFor = (sess) => {
      const list = [];
      for (const d of dayIdxs) {
        if (sess.spreadKey && spreadUsedDay[`${sess.spreadKey}|${d}`]) continue; // jour déjà pris par une autre heure de cette matière/classe
        for (let s = 0; s < slotCount; s++) {
          if (sess.classes.some(cls => busyClass[cls][d][s])) continue; // TOUTES les classes doivent être libres
          for (const prof of sess.elig) {
            if (busyProf[prof.id][d][s]) continue;
            if (!prof.availability?.[d]?.[s]) continue;
            list.push({ day: d, slot: s, profId: prof.id });
          }
        }
      }
      return list;
    };
    // Comme candidatesFor mais ne construit pas la liste — appelé très
    // souvent (MRV + forward-checking), on évite l'allocation à chaque fois.
    const domainSize = (idx) => {
      const sess = sessions[idx];
      let n = 0;
      for (const d of dayIdxs) {
        if (sess.spreadKey && spreadUsedDay[`${sess.spreadKey}|${d}`]) continue;
        for (let s = 0; s < slotCount; s++) {
          if (sess.classes.some(cls => busyClass[cls][d][s])) continue;
          for (const prof of sess.elig) {
            if (!busyProf[prof.id][d][s] && prof.availability?.[d]?.[s]) n++;
          }
        }
      }
      return n;
    };

    const assigned = new Array(sessions.length).fill(false);
    const domCache = sessions.map((_, idx) => domainSize(idx));
    let remaining = sessions.map((_, idx) => idx);

    // Recalcule (toujours par calcul exact, jamais par incrément approximatif,
    // pour rester correct dans les deux sens assignation/annulation) le
    // domaine des sessions affectées par un (dé)placement sur (classes, profId,
    // spreadKey). Si checkWipeout, renvoie la liste des sessions dont le
    // domaine vient de tomber à 0 : c'est le forward-checking qui anticipe un
    // blocage futur AVANT de récurser dedans, au lieu de le découvrir
    // plusieurs niveaux plus bas.
    const applyDelta = (classesArr, profId, checkWipeout, spreadKey) => {
      const wiped = [];
      for (const idx of affectedBy(classesArr, profId, spreadKey)) {
        if (assigned[idx]) continue;
        domCache[idx] = domainSize(idx);
        if (checkWipeout && domCache[idx] === 0) wiped.push(idx);
      }
      return wiped;
    };

    // MRV dynamique : à CHAQUE nœud (pas une fois au départ), on choisit la
    // session dont le domaine courant est le plus petit — en cas d'égalité,
    // celle qui a le moins de profs éligibles (la plus structurellement
    // contrainte). Comme les domaines évoluent au fil du remplissage de la
    // grille, la session "la plus urgente" change pendant la recherche.
    const pickNext = () => {
      let bestPos = 0;
      for (let i = 1; i < remaining.length; i++) {
        const a = remaining[i], b = remaining[bestPos];
        if (domCache[a] < domCache[b] ||
            (domCache[a] === domCache[b] && sessions[a].elig.length < sessions[b].elig.length)) {
          bestPos = i;
        }
      }
      return bestPos;
    };

    // ---------- Suivi des conflits pour le diagnostic ----------
    // On cumule TOUTES les causes de blocage rencontrées pendant TOUTE la
    // recherche (impasses + wipeouts de forward-checking), pas seulement le
    // dernier échec : ça permet d'expliquer la cause la plus probable par
    // fréquence plutôt que par un seul point de blocage arbitraire.
    const blockedInfo = {}; // key -> { count, label, elig }
    const bumpBlocked = (idx) => {
      const s = sessions[idx];
      const key = s.classes.slice().sort().join('+') + '|' + s.subj;
      if (!blockedInfo[key]) {
        blockedInfo[key] = { count: 0, label: `${s.classes.join('+')} · ${s.subj}`, elig: s.elig };
      }
      blockedInfo[key].count++;
    };
    let deepestCount = 0; // nb max de sessions casées simultanément, atteint pendant la recherche
    let bestMissing = []; // sessions encore non placées à CE moment précis (snapshot, pas un cumul)
    let bestPlacements = []; // { classes, subj, elig, day, slot, profId } des sessions casées à ce moment
    const placedStack = []; // pile courante des sessions casées, pour pouvoir snapshotter bestPlacements

    // ---------- Budget : garantit que la recherche se termine TOUJOURS ----------
    // Le CSP reste NP-difficile en théorie : rien ne garantit de trouver une
    // solution existante en temps fini raisonnable sur un cas pathologique.
    // MRV + forward-checking réduisent énormément le nombre de nœuds explorés
    // en pratique sur des instances de taille scolaire, mais on garde un
    // filet de sécurité en itérations ET en temps réel pour toujours rendre
    // une réponse nette ("indéterminé" au pire) plutôt que boucler sans fin.
    // Attention : ce budget ne rend PAS la recherche asynchrone — le calcul
    // reste synchrone et bloque l'onglet du navigateur pendant toute sa durée
    // (pas de Web Worker). C'est pour ça que le budget en itérations est fixé
    // très haut par défaut : c'est le temps réel (piloté par l'utilisateur
    // via l'UI) qui doit gouverner en pratique, pas ce filet de sécurité.
    const startTime = Date.now();
    const TIME_BUDGET_MS = options.solverTimeBudgetMs || 8000;
    const MAX_ITER = options.solverMaxIter || 60000000;
    let iterCount = 0;
    let aborted = false;
    const budgetOk = () => {
      iterCount++;
      if (iterCount > MAX_ITER) { aborted = true; return false; }
      if ((iterCount & 1023) === 0 && Date.now() - startTime > TIME_BUDGET_MS) { aborted = true; return false; }
      return true;
    };

    const backtrack = () => {
      if (!budgetOk()) return false;
      if (remaining.length === 0) return true;

      const pos = pickNext();
      const idx = remaining[pos];
      const sess = sessions[idx];

      const placedNow = sessions.length - remaining.length;
      if (placedNow > deepestCount) {
        deepestCount = placedNow;
        // `remaining` contient encore idx à ce stade (pas retiré) : c'est
        // exactement l'ensemble des sessions non casées à ce moment précis.
        bestMissing = remaining.map(i => sessions[i]);
        // Snapshot (copie, pas référence : placedStack continue de bouger)
        // du placement complet à ce moment — c'est la base que `repair()`
        // utilisera pour tenter de compléter par recherche locale.
        bestPlacements = placedStack.map(p => ({
          classes: p.sess.classes, subj: p.sess.subj, elig: p.sess.elig, spreadKey: p.sess.spreadKey,
          day: p.c.day, slot: p.c.slot, profId: p.c.profId,
        }));
      }

      if (domCache[idx] === 0) {
        // Impasse : la session la plus contrainte du front de recherche n'a
        // plus aucun (jour, slot, prof) possible.
        bumpBlocked(idx);
        return false;
      }

      const cands = candidatesFor(sess);
      // Heuristique "pas de trous" : approximée sur la première classe du
      // groupe (pour une session multi-classes, un compromis suffit — on ne
      // peut de toute façon pas optimiser simultanément pour chaque classe).
      const repCls = sess.classes[0];

      // --- ordre des candidats ---
      // Toujours mélangé (Fisher-Yates) : un ordre fixe (ex. toujours le
      // créneau le plus tôt) peut faire tomber le backtracking dans une
      // impasse arbitraire et y rester bloqué à l'identique à chaque essai —
      // observé concrètement : un ordre déterministe restait figé à 30/112
      // sur un cas réel, contre 107-110/112 en mélangeant (phénomène connu
      // en recherche combinatoire). Le backtracking reste complet quel que
      // soit l'ordre : ça ne change que la vitesse, jamais la faisabilité.
      for (let i = cands.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cands[i], cands[j]] = [cands[j], cands[i]];
      }
      if (options.noGapsForStudents) {
        // Stable : le mélange sert de tie-breaker pour les créneaux à égalité de compacité.
        cands.sort((a, b) => {
          const compact = (c) => {
            let score = 0;
            for (let s = c.slot - 1; s <= c.slot + 1; s++) {
              if (s >= 0 && s < slotCount && busyClass[repCls][c.day][s]) score--;
            }
            return score;
          };
          return compact(a) - compact(b);
        });
      }

      // Retirer idx de "remaining" (swap-pop) pendant qu'on essaie ses candidats.
      remaining[pos] = remaining[remaining.length - 1];
      remaining.pop();
      assigned[idx] = true;

      for (const c of cands) {
        for (const cls of sess.classes) {
          busyClass[cls][c.day][c.slot] = true;
          schedule[`${cls}|${c.day}|${c.slot}`] = { profId: c.profId, subj: sess.subj, grouped: sess.classes.length > 1 };
        }
        busyProf[c.profId][c.day][c.slot] = true;
        if (sess.spreadKey) {
          const k = `${sess.spreadKey}|${c.day}`;
          spreadUsedDay[k] = (spreadUsedDay[k] || 0) + 1;
        }
        placedStack.push({ sess, c });

        // Forward-checking : si ce placement vide le domaine d'une autre
        // session pas encore posée, inutile de récurser — c'est déjà mort.
        const wiped = applyDelta(sess.classes, c.profId, true, sess.spreadKey);
        let success = false;
        if (wiped.length === 0) {
          success = backtrack();
        } else {
          wiped.forEach(bumpBlocked);
        }

        if (success) return true;

        // Annuler ce candidat avant d'essayer le suivant.
        placedStack.pop();
        for (const cls of sess.classes) {
          busyClass[cls][c.day][c.slot] = false;
          delete schedule[`${cls}|${c.day}|${c.slot}`];
        }
        busyProf[c.profId][c.day][c.slot] = false;
        if (sess.spreadKey) {
          const k = `${sess.spreadKey}|${c.day}`;
          spreadUsedDay[k]--;
          if (spreadUsedDay[k] === 0) delete spreadUsedDay[k];
        }
        applyDelta(sess.classes, c.profId, false, sess.spreadKey);

        if (aborted) break;
      }

      assigned[idx] = false;
      remaining.push(idx);
      if (!aborted) bumpBlocked(idx); // aucun candidat n'a marché : session bloquée

      return false;
    };

    const ok = backtrack();

    if (ok) {
      const nPinnedCells = Object.keys(pinnedSchedule).length;
      const nSearchCells = sessions.reduce((s, x) => s + x.classes.length, 0);
      const suffix = nPinnedCells > 0 ? ` (${nPinnedCells} épinglé(s))` : '';
      return { ok: true, schedule, message: `Emploi du temps généré : ${nSearchCells + nPinnedCells} créneaux placés${suffix}.` };
    }

    // ---------- Explication de l'échec ----------
    const totalSessions = sessions.length;

    // Fait concret et fiable dans tous les cas : au meilleur essai atteint,
    // quelles (classe(s), matière) précises n'ont pas pu être casées. Contrairement
    // aux points de blocage ci-dessous (une statistique agrégée), c'est un
    // constat direct sur le meilleur essai réellement trouvé.
    const missingSummary = {};
    for (const s of bestMissing) {
      const key = s.classes.slice().sort().join('+') + '|' + s.subj;
      if (!missingSummary[key]) missingSummary[key] = { label: `${s.classes.join('+')} · ${s.subj}`, count: 0 };
      missingSummary[key].count++;
    }
    const explainMissing = () => {
      const rows = Object.values(missingSummary).sort((a, b) => b.count - a.count);
      if (rows.length === 0) return '';
      const lines = rows.map(m => `  ${m.label} : ${m.count}h non casée(s)`);
      return `\n\nMatières non casées au meilleur essai :\n${lines.join('\n')}`;
    };

    // Points de blocage : agrégés sur TOUTE la recherche (impasses + wipeouts
    // de forward-checking). Fiable comme "cause probable" UNIQUEMENT si la
    // recherche est allée au bout (aborted === false) : elle a alors examiné
    // tout l'espace, donc la fréquence reflète vraiment la contrainte la
    // plus dure. Si la recherche a été interrompue par le budget, un score
    // élevé peut juste vouloir dire que la recherche s'est enlisée dans UNE
    // zone du problème sans jamais en explorer d'autres — ce n'est pas
    // fiable comme diagnostic global, seulement comme indice.
    const topBlocked = Object.values(blockedInfo).sort((a, b) => b.count - a.count).slice(0, 5);
    const explainBlocked = () => {
      if (topBlocked.length === 0) return '';
      const lines = topBlocked.map(b => {
        const names = b.elig.map(p => p.name).join(', ') || '—';
        return `  ${b.label} : bloqué(e) ${b.count} fois pendant la recherche. Profs éligibles : ${names}.`;
      });
      const title = aborted
        ? `Sessions qui ont le plus résisté pendant cette recherche (indicatif seulement — la recherche n'a pas été jusqu'au bout, ça peut juste être une zone où elle s'est enlisée, pas forcément la vraie cause) :`
        : `Points de blocage les plus fréquents (cause probable, confirmée par l'exploration exhaustive de tout l'espace de recherche) :`;
      return `\n\n${title}\n${lines.join('\n')}\n\n` +
             `Piste : ajoute des disponibilités à ces profs, ajoute un prof sur ces matières, ou réduis le volume horaire concerné.`;
    };

    // `partial` : base exploitable par `repair()` (recherche locale) pour
    // tenter de compléter ce meilleur essai — voir plus bas. `partial.schedule`
    // est aussi affichable tel quel dans la grille : ça donne une vue concrète
    // du meilleur essai (avec des trous sur ce qui manque) plutôt que rien.
    const partialSchedule = {};
    for (const k of Object.keys(pinnedSchedule)) partialSchedule[k] = pinnedSchedule[k];
    for (const p of bestPlacements) {
      for (const cls of p.classes) {
        partialSchedule[`${cls}|${p.day}|${p.slot}`] = { profId: p.profId, subj: p.subj, grouped: p.classes.length > 1 };
      }
    }
    const partial = { placements: bestPlacements, missing: bestMissing, schedule: partialSchedule };

    if (aborted) {
      return {
        ok: false,
        aborted: true,
        partial,
        message:
          `Recherche interrompue après ${iterCount.toLocaleString('fr')} itérations (${Date.now() - startTime}ms) ` +
          `sans conclusion : la configuration n'est ni prouvée possible, ni prouvée impossible — l'espace de recherche est trop grand pour l'explorer entièrement dans le budget imparti.\n` +
          `Meilleur essai atteint : ${deepestCount}/${totalSessions} heures casées simultanément avant blocage.` +
          explainMissing(),
      };
    }

    return {
      ok: false,
      aborted: false,
      partial,
      message:
        `Aucun emploi du temps possible : la recherche a exploré exhaustivement toutes les combinaisons ` +
        `(dans la limite du budget) et prouve qu'il n'existe aucune solution avec la configuration actuelle (${totalSessions}h à placer).\n` +
        `Meilleur essai atteint pendant la recherche : ${deepestCount}/${totalSessions} heures casées simultanément.` +
        explainMissing() +
        explainBlocked(),
    };
  },

  // ---------- Réparation par recherche locale (min-conflicts) ----------
  // Complémentaire du backtracking de solve() : celui-ci construit TOUJOURS
  // un état partiel valide (aucun conflit) et garantit de trouver une
  // solution si elle existe, mais peut être lent à progresser quand une
  // configuration est très contrainte. `repair()` fait l'inverse : il part
  // d'un état COMPLET mais avec des conflits (le meilleur essai de solve(),
  // complété de force pour les heures manquantes), puis répare itérativement
  // en déplaçant à chaque étape une session en conflit vers la position qui
  // en crée le moins — c'est souvent bien plus rapide pour TROUVER une
  // solution existante. En contrepartie, il ne peut jamais prouver qu'une
  // configuration est impossible : s'il n'aboutit pas, on ne sait pas si
  // c'est parce que ça n'existe pas ou parce qu'il est resté coincé dans un
  // optimum local. C'est pour ça que les deux méthodes sont complémentaires
  // plutôt que l'une ne remplace l'autre.
  repair(state, partial) {
    const ctx = buildContext(state);
    if (!ctx.ok) return ctx;
    const { dayIdxs, slotCount, pinnedSchedule, pinnedBusyClass, pinnedBusyProf } = ctx;

    // Un "item" = une session à placer, qu'elle soit déjà bien casée (dans
    // partial.placements) ou encore manquante (dans partial.missing). Toutes
    // sont mutables ici — y compris celles déjà bien placées : les déplacer
    // peut être nécessaire pour faire de la place aux manquantes. Seules les
    // épingles (pinnedBusyClass/pinnedBusyProf) restent strictement figées.
    const items = [];
    for (const p of partial.placements) {
      items.push({ classes: p.classes, subj: p.subj, elig: p.elig, spreadKey: p.spreadKey || null, day: p.day, slot: p.slot, profId: p.profId });
    }
    for (const m of partial.missing) {
      // Amorce arbitraire : premier (jour, slot, prof éligible) où le prof est
      // réellement disponible (hors épingles ou pas — min-conflicts va de
      // toute façon immédiatement chercher à résoudre le conflit s'il y en a).
      let seed = null;
      for (const prof of m.elig) {
        for (const d of dayIdxs) {
          for (let s = 0; s < slotCount; s++) {
            if (prof.availability?.[d]?.[s]) { seed = { day: d, slot: s, profId: prof.id }; break; }
          }
          if (seed) break;
        }
        if (seed) break;
      }
      if (!seed) seed = { day: dayIdxs[0], slot: 0, profId: m.elig[0].id }; // ne devrait pas arriver (Check1/2 l'auraient déjà signalé)
      items.push({ classes: m.classes, subj: m.subj, elig: m.elig, spreadKey: m.spreadKey || null, day: seed.day, slot: seed.slot, profId: seed.profId });
    }

    // Occupation courante de chaque (classe|jour|slot) et (prof|jour|slot) —
    // par nombre d'items présents (0 ou 1 = OK, 2+ = conflit). Les épingles
    // comptent comme un occupant permanent supplémentaire qu'on ne retire
    // jamais, pour qu'un item ne puisse jamais se poser dessus sans conflit.
    const classOcc = {};  // "cls|d|s" -> count
    const profOcc = {};   // "profId|d|s" -> count
    const spreadOcc = {}; // "spreadKey|d" -> count de sessions de cette matière/classe déjà ce jour-là
    const bump = (map, key, delta) => { map[key] = (map[key] || 0) + delta; };
    for (const key of Object.keys(pinnedBusyClass)) bump(classOcc, key, 1);
    for (const key of Object.keys(pinnedBusyProf)) bump(profOcc, key, 1);
    const place = (it, delta) => {
      for (const cls of it.classes) bump(classOcc, `${cls}|${it.day}|${it.slot}`, delta);
      bump(profOcc, `${it.profId}|${it.day}|${it.slot}`, delta);
      if (it.spreadKey) bump(spreadOcc, `${it.spreadKey}|${it.day}`, delta);
    };
    items.forEach(it => place(it, 1));

    // Conflits d'un item = somme, sur chacune de ses classes ET sur son prof,
    // du nombre d'AUTRES occupants au même (jour, slot), PLUS (si une règle de
    // répartition s'applique) le nombre d'autres heures de la même matière/
    // classe déjà posées CE JOUR-LÀ. On retire d'abord sa propre contribution
    // (1 par classe + 1 pour le prof + 1 pour la répartition) pour ne compter
    // que les autres.
    const conflictsOf = (it) => {
      let n = 0;
      for (const cls of it.classes) n += (classOcc[`${cls}|${it.day}|${it.slot}`] || 0) - 1;
      n += (profOcc[`${it.profId}|${it.day}|${it.slot}`] || 0) - 1;
      if (it.spreadKey) n += (spreadOcc[`${it.spreadKey}|${it.day}`] || 0) - 1;
      return n;
    };

    const TIME_BUDGET_MS = state.options?.repairTimeBudgetMs || 5000;
    const MAX_ITER = 2000000;
    const startTime = Date.now();
    let iter = 0;

    while (iter < MAX_ITER) {
      iter++;
      if ((iter & 511) === 0 && Date.now() - startTime > TIME_BUDGET_MS) break;

      const conflicted = items.filter(it => conflictsOf(it) > 0);
      if (conflicted.length === 0) break; // plus aucun conflit : réparé !

      const it = conflicted[Math.floor(Math.random() * conflicted.length)];
      place(it, -1); // le retirer le temps d'évaluer les positions possibles

      // Toutes les positions valides (dispo prof respectée, règle de répartition
      // respectée — contraintes dures ; épingles jamais utilisées comme cible) ;
      // on garde celle(s) qui minimisent le conflit résultant, tie-break
      // aléatoire. 10% du temps, mouvement purement aléatoire (pas forcément
      // le meilleur) pour échapper aux optimums locaux — classique en
      // recherche locale (style WalkSAT).
      let bestScore = Infinity;
      let bestOptions = [];
      const allOptions = [];
      for (const day of dayIdxs) {
        if (it.spreadKey && (spreadOcc[`${it.spreadKey}|${day}`] || 0) > 0) continue; // jour déjà pris par une autre heure de cette matière/classe
        for (let slot = 0; slot < slotCount; slot++) {
          if (it.classes.some(cls => pinnedBusyClass[`${cls}|${day}|${slot}`])) continue;
          for (const prof of it.elig) {
            if (pinnedBusyProf[`${prof.id}|${day}|${slot}`]) continue;
            if (!prof.availability?.[day]?.[slot]) continue;
            let score = 0;
            for (const cls of it.classes) score += (classOcc[`${cls}|${day}|${slot}`] || 0);
            score += (profOcc[`${prof.id}|${day}|${slot}`] || 0);
            const opt = { day, slot, profId: prof.id };
            allOptions.push(opt);
            if (score < bestScore) { bestScore = score; bestOptions = [opt]; }
            else if (score === bestScore) bestOptions.push(opt);
          }
        }
      }
      const pool = (allOptions.length > 0 && Math.random() < 0.1) ? allOptions : bestOptions;
      const choice = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : { day: it.day, slot: it.slot, profId: it.profId };
      it.day = choice.day; it.slot = choice.slot; it.profId = choice.profId;
      place(it, 1);
    }

    const stillConflicted = items.filter(it => conflictsOf(it) > 0);
    const dtMs = Date.now() - startTime;

    if (stillConflicted.length === 0) {
      const schedule = {};
      for (const k of Object.keys(pinnedSchedule)) schedule[k] = pinnedSchedule[k];
      for (const it of items) {
        for (const cls of it.classes) {
          schedule[`${cls}|${it.day}|${it.slot}`] = { profId: it.profId, subj: it.subj, grouped: it.classes.length > 1 };
        }
      }
      return {
        ok: true, schedule,
        message: `Réparation réussie en ${dtMs}ms (${iter.toLocaleString('fr')} itérations) : emploi du temps complet trouvé par recherche locale.`,
      };
    }

    const labels = {};
    for (const it of stillConflicted) {
      const key = it.classes.slice().sort().join('+') + '|' + it.subj;
      labels[key] = `${it.classes.join('+')} · ${it.subj}`;
    }
    const lines = Object.values(labels).map(l => `  ${l}`).join('\n');
    return {
      ok: false,
      message:
        `La réparation n'a pas réussi à éliminer tous les conflits après ${dtMs}ms (${iter.toLocaleString('fr')} itérations).\n` +
        `Sessions encore en conflit :\n${lines}\n\n` +
        `Ça ne prouve pas que c'est impossible (la recherche locale peut rester coincée dans un optimum local) — mais si ça persiste après plusieurs essais, la configuration est probablement réellement trop contrainte à cet endroit.`,
    };
  },

  // Diagnostic proactif (n'exécute PAS la recherche) : pour chaque prof, sa
  // "charge incompressible" = somme des heures des (classe, matière) ou
  // regroupements dont il est l'UNIQUE prof éligible — c'est-à-dire les
  // heures qu'il n'a d'autre choix que de couvrir lui-même — comparée à sa
  // disponibilité réellement restante (nette des épingles). Une marge nulle
  // ou négative est le signe d'une configuration fragile ou bloquante AVANT
  // même de lancer une recherche potentiellement longue et infructueuse.
  analyzeProfLoad(state) {
    const ctx = buildContext(state);
    if (!ctx.ok) return ctx;
    const { profs, demand, groups, eligibleFor, availCountFor } = ctx;

    const exclusiveHours = {};   // profId -> heures
    const exclusiveLabels = {};  // profId -> Set de libellés "matière (classe)"
    for (const d of demand) {
      const elig = eligibleFor(d.subj, d.cls);
      if (elig.length !== 1) continue;
      const pid = elig[0].id;
      exclusiveHours[pid] = (exclusiveHours[pid] || 0) + d.hours;
      (exclusiveLabels[pid] = exclusiveLabels[pid] || new Set()).add(`${d.subj} (${d.cls})`);
    }
    for (const g of groups) {
      if (g.elig.length !== 1) continue;
      const pid = g.elig[0].id;
      exclusiveHours[pid] = (exclusiveHours[pid] || 0) + g.hours;
      (exclusiveLabels[pid] = exclusiveLabels[pid] || new Set()).add(`${g.subj} (${g.classes.join('+')}, groupe)`);
    }

    const rows = profs.map(p => {
      const hours = exclusiveHours[p.id] || 0;
      const netAvailability = availCountFor(p);
      const margin = netAvailability - hours;
      let status = 'ok';
      if (margin < 0) status = 'bloquant';
      else if (margin <= 1) status = 'tendu';
      return {
        id: p.id,
        name: p.name,
        exclusiveHours: hours,
        netAvailability,
        margin,
        status,
        labels: [...(exclusiveLabels[p.id] || [])],
      };
    });
    rows.sort((a, b) => a.margin - b.margin);
    return { ok: true, rows };
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = Solver;
