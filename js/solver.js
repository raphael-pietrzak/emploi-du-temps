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
  // Heures "semaine A" / "semaine B" : EN PLUS des heures communes (volumes),
  // pas à la place — une matière à "1h commun + 1h semaine A" a 1h toutes les
  // semaines ET 1h de plus les semaines A. N'interagissent PAS avec les
  // épingles/regroupements/réunions (hors périmètre v1, voir CLAUDE.md) : ce
  // sont des sessions "normales" indépendantes, juste taguées par semaine.
  const volumesA = state.volumesA || {};
  const volumesB = state.volumesB || {};
  const constraints = state.constraints || { pins: [] };
  const profsById = {};
  for (const p of profs) profsById[p.id] = p;
  // Il n'y a plus de notion de "jour désactivé" — la grille se ferme
  // créneau par créneau via config.openSlots[day][slot] (true = il y a
  // cours). Un jour "off" est simplement un jour dont tous les créneaux
  // sont fermés. `dayIdxs` reste utile comme raccourci "tous les indices
  // de jours" pour les boucles ci-dessous.
  const dayIdxs = config.days.map((_, i) => i);
  const slotCount = config.slots.length;
  const isOpen = (d, s) => config.openSlots?.[d]?.[s] !== false;
  let totalSlotsPerClass = 0;
  let openDayCount = 0; // nb de jours ayant au moins un créneau ouvert — utile pour les règles "jours différents"
  for (const d of dayIdxs) {
    let dayHasOpen = false;
    for (let s = 0; s < slotCount; s++) if (isOpen(d, s)) { totalSlotsPerClass++; dayHasOpen = true; }
    if (dayHasOpen) openDayCount++;
  }

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
      if (pin.slot < 0 || pin.slot >= slotCount) { pinErrors.push(`${label} : créneau invalide.`); continue; }
      if (!isOpen(pin.day, pin.slot)) { pinErrors.push(`${label} : ce créneau est fermé (pas cours à ce moment-là).`); continue; }
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

    // ---------- Réunions / cours à plusieurs profs obligatoires ----------
    // Une "réunion" : (profIds[] >=2, classes[] optionnel, hours, subj optionnel,
    // name) — contrairement à un groupe, les profs ne sont PAS choisis parmi
    // des éligibles : ils sont TOUS obligatoires simultanément (ex: réunion
    // pédagogique sans classe, ou cours co-enseigné à plusieurs profs). Si
    // `subj` est renseigné, décrémente le volume des classes listées comme un
    // groupe ; sinon c'est un simple blocage d'agenda (aucun volume touché).
    // Sans classe du tout (réunion pure), on invente une classe fictive
    // ("@meeting:id") qui ne fait partie d'aucune liste réelle — juste un
    // support pour que le modèle "sessions.classes" existant marche tel quel.
    const meetings = [];
    const meetingErrors = [];
    for (const m of (constraints.meetings || [])) {
      const label = `Réunion ${m.name || '(sans nom)'}`;
      if (!m.name) { meetingErrors.push(`${label} : nom manquant.`); continue; }
      const hours = m.hours || 0;
      if (hours < 1) { meetingErrors.push(`${label} : nombre d'heures invalide.`); continue; }
      const profIds = m.profIds || [];
      if (profIds.length < 2) { meetingErrors.push(`${label} : sélectionne au moins 2 profs.`); continue; }
      let bad = false;
      for (const pid of profIds) {
        if (!profsById[pid]) { meetingErrors.push(`${label} : prof inconnu.`); bad = true; }
      }
      if (bad) continue;
      const classes = m.classes || [];
      for (const cls of classes) {
        if (!config.classes.includes(cls)) { meetingErrors.push(`${label} : classe ${cls} inconnue.`); bad = true; }
      }
      if (bad) continue;
      if (m.subj) {
        if (!config.subjects.includes(m.subj)) { meetingErrors.push(`${label} : matière inconnue.`); continue; }
        if (classes.length === 0) { meetingErrors.push(`${label} : une matière est indiquée mais aucune classe n'est sélectionnée.`); continue; }
        for (const cls of classes) {
          const k = `${cls}|${m.subj}`;
          if ((demandMap[k] || 0) < hours) {
            meetingErrors.push(`${label} : ${cls} n'a que ${demandMap[k] || 0}h de ${m.subj} restante(s), il en faut ${hours}.`);
            bad = true;
          }
        }
        if (bad) continue;
        for (const cls of classes) {
          demandMap[`${cls}|${m.subj}`] -= hours;
          if (demandMap[`${cls}|${m.subj}`] === 0) delete demandMap[`${cls}|${m.subj}`];
        }
      }
      meetings.push({ id: m.id, name: m.name, subj: m.subj || null, classes, profIds, hours });
    }
    if (meetingErrors.length > 0) {
      return { ok: false, message: 'Réunions invalides :\n• ' + meetingErrors.join('\n• ') };
    }

    // Créneaux d'une classe consommés par des réunions (toutes matières
    // confondues, y compris les réunions sans matière) — comme groupSlotsByClass.
    const meetingSlotsByClass = {};
    for (const m of meetings) {
      for (const cls of m.classes) meetingSlotsByClass[cls] = (meetingSlotsByClass[cls] || 0) + m.hours;
    }

    // Reconstitution de la demande post-épingles/groupes/réunions.
    const demand = [];
    for (const cls of config.classes) {
      for (const subj of config.subjects) {
        const h = demandMap[`${cls}|${subj}`] || 0;
        if (h > 0) demand.push({ cls, subj, hours: h });
      }
    }
    // Demande "semaine A" / "semaine B" — indépendante de demandMap (pas de
    // décrément croisé avec épingles/groupes/réunions, hors périmètre).
    const demandA = [];
    const demandB = [];
    for (const cls of config.classes) {
      for (const subj of config.subjects) {
        const hA = volumesA[`${cls}|${subj}`] || 0;
        if (hA > 0) demandA.push({ cls, subj, hours: hA });
        const hB = volumesB[`${cls}|${subj}`] || 0;
        if (hB > 0) demandB.push({ cls, subj, hours: hB });
      }
    }
    if (demand.length === 0 && demandA.length === 0 && demandB.length === 0 && Object.keys(pinnedSchedule).length === 0 && groups.length === 0 && meetings.length === 0) {
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
          if (isOpen(d, s) && prof.availability[d]?.[s] && !pinnedBusyProf[`${prof.id}|${d}|${s}`]) n++;
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
      for (let i = 0; i < d.hours; i++) sessions.push({ classes: [d.cls], subj: d.subj, elig, spreadKey, week: 'both' });
    }
    for (const g of groups) {
      // Une règle de répartition ne s'applique qu'à une classe seule (elle
      // porte sur SA propre semaine) — pas de sens pour un groupe multi-classes.
      for (let i = 0; i < g.hours; i++) sessions.push({ classes: g.classes, subj: g.subj, elig: g.elig, spreadKey: null, week: 'both' });
    }
    for (const m of meetings) {
      const elig = m.profIds.map(pid => profsById[pid]);
      const classesForSession = m.classes.length ? m.classes : [`@meeting:${m.id}`];
      for (let i = 0; i < m.hours; i++) {
        sessions.push({
          classes: classesForSession, subj: m.subj || m.name, elig, allRequired: true,
          spreadKey: null, meetingId: m.id, meetingName: m.name, week: 'both',
        });
      }
    }
    // Sessions "semaine A" / "semaine B" : une session normale (1 classe, un
    // prof choisi parmi les éligibles), taguée `week` — n'occupe QUE la grille
    // d'occupation de sa propre semaine (voir solve()/repair() plus bas), donc
    // peut partager le même (jour, créneau, classe) qu'une session de l'AUTRE
    // semaine sans jamais être considérée en conflit avec elle. Pas de
    // `spreadKey` : la règle de répartition ne s'applique pas ici (hors périmètre).
    for (const d of demandA) {
      const elig = eligibleFor(d.subj, d.cls);
      for (let i = 0; i < d.hours; i++) sessions.push({ classes: [d.cls], subj: d.subj, elig, spreadKey: null, week: 'A' });
    }
    for (const d of demandB) {
      const elig = eligibleFor(d.subj, d.cls);
      for (let i = 0; i < d.hours; i++) sessions.push({ classes: [d.cls], subj: d.subj, elig, spreadKey: null, week: 'B' });
    }

    // Union de toutes les "classes" apparaissant dans les sessions — inclut
    // les classes réelles ET les classes fictives des réunions sans classe.
    // Sert à initialiser busyClass sur le bon ensemble de clés dans solve()/repair().
    const allSessionClasses = new Set(config.classes);
    sessions.forEach(s => s.classes.forEach(c => allSessionClasses.add(c)));

    return {
      ok: true, config, profs, options, dayIdxs, slotCount, totalSlotsPerClass, openDayCount, isOpen,
      demand, demandA, demandB, groups, meetings, sessions, allSessionClasses, pinnedSchedule, pinnedBusyClass, pinnedBusyProf,
      pinnedSlotsByClass, groupSlotsByClass, meetingSlotsByClass, spreadPairs, teachesPair, eligibleFor, availCountFor,
      profsById,
    };
}

const Solver = {
  solve(state) {
    const ctx = buildContext(state);
    if (!ctx.ok) return ctx;
    const {
      config, profs, options, dayIdxs, slotCount, totalSlotsPerClass, openDayCount, isOpen,
      demand, demandA, demandB, groups, meetings, sessions, allSessionClasses, pinnedSchedule, pinnedBusyClass, pinnedBusyProf,
      pinnedSlotsByClass, groupSlotsByClass, meetingSlotsByClass, spreadPairs, eligibleFor, availCountFor,
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
      if (spreadPairs.has(`${d.cls}|${d.subj}`) && d.hours > openDayCount) {
        errors.push(`${d.cls} · ${d.subj} : ${d.hours}h à répartir sur des jours différents, mais seulement ${openDayCount} jour(s) avec au moins un créneau ouvert dans la semaine.`);
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
          if (!isOpen(dayI, s)) continue; // créneau fermé (pas cours)
          if (pinnedBusyClass[`${d.cls}|${dayI}|${s}`]) continue; // classe déjà occupée par une épingle
          if (elig.some(p => p.availability?.[dayI]?.[s] && !pinnedBusyProf[`${p.id}|${dayI}|${s}`])) cap++;
        }
      }
      if (cap < d.hours) {
        errors.push(`${d.cls} · ${d.subj} : ${d.hours}h demandées mais seulement ${cap} créneau(x) réellement libre(s) (compte tenu des épingles déjà posées) où un prof éligible est dispo. Profs concernés : ${elig.map(p => p.name).join(', ') || '—'}. Ajoute des dispos à ces profs, déplace une épingle qui bloque ce créneau, ou réduis le volume.`);
        flaggedBySubject.add(d.subj);
      }
    }

    // Check 1-A/B et Check 2-A/B : mêmes vérifications que Check 1/2, mais
    // pour les heures "semaine A"/"semaine B" — indépendantes de `demand`,
    // donc signalées séparément avec un libellé explicite sur la semaine
    // concernée pour ne pas laisser croire que c'est la charge normale qui pose problème.
    const checkWeekDemand = (weekDemand, weekLabel) => {
      for (const d of weekDemand) {
        const elig = eligibleFor(d.subj, d.cls);
        if (elig.length === 0) {
          errors.push(`Aucun prof n'enseigne "${d.subj}" — mais ${d.hours}h sont demandées pour ${d.cls} (semaine ${weekLabel}). Va dans Professeurs et coche cette matière chez un prof.`);
          continue;
        }
        let cap = 0;
        for (const dayI of dayIdxs) {
          for (let s = 0; s < slotCount; s++) {
            if (!isOpen(dayI, s)) continue;
            if (pinnedBusyClass[`${d.cls}|${dayI}|${s}`]) continue;
            if (elig.some(p => p.availability?.[dayI]?.[s] && !pinnedBusyProf[`${p.id}|${dayI}|${s}`])) cap++;
          }
        }
        if (cap < d.hours) {
          errors.push(`${d.cls} · ${d.subj} (semaine ${weekLabel}) : ${d.hours}h demandées mais seulement ${cap} créneau(x) réellement libre(s) où un prof éligible est dispo. Profs concernés : ${elig.map(p => p.name).join(', ') || '—'}.`);
        }
      }
    };
    checkWeekDemand(demandA, 'A');
    checkWeekDemand(demandB, 'B');

    // Check 2bis : idem que Check 2 mais pour les regroupements — le créneau
    // doit convenir à TOUTES les classes du groupe en même temps.
    const flaggedGroups = new Set(); // index de groupe déjà signalé par Check 2bis
    groups.forEach((g, gi) => {
      let cap = 0;
      for (const dayI of dayIdxs) {
        for (let s = 0; s < slotCount; s++) {
          if (!isOpen(dayI, s)) continue;
          if (g.classes.some(cls => pinnedBusyClass[`${cls}|${dayI}|${s}`])) continue;
          if (g.elig.some(p => p.availability?.[dayI]?.[s] && !pinnedBusyProf[`${p.id}|${dayI}|${s}`])) cap++;
        }
      }
      if (cap < g.hours) {
        errors.push(`Groupe ${g.classes.join('+')} · ${g.subj} : ${g.hours}h à caser ensemble mais seulement ${cap} créneau(x) où TOUTES ces classes sont libres en même temps ET un prof éligible est dispo. Profs concernés : ${g.elig.map(p => p.name).join(', ') || '—'}.`);
        flaggedGroups.add(gi);
      }
    });

    // Check 2ter : idem que Check 2bis mais pour les réunions — le créneau doit
    // convenir à toutes les classes concernées (s'il y en a) ET à TOUS les
    // profs requis (pas de choix, ils doivent tous être libres à la fois).
    const flaggedMeetings = new Set();
    meetings.forEach((m, mi) => {
      let cap = 0;
      for (const dayI of dayIdxs) {
        for (let s = 0; s < slotCount; s++) {
          if (!isOpen(dayI, s)) continue;
          if (m.classes.some(cls => pinnedBusyClass[`${cls}|${dayI}|${s}`])) continue;
          if (m.profIds.some(pid => pinnedBusyProf[`${pid}|${dayI}|${s}`])) continue;
          if (m.profIds.every(pid => ctx.profsById[pid].availability?.[dayI]?.[s])) cap++;
        }
      }
      if (cap < m.hours) {
        const names = m.profIds.map(pid => ctx.profsById[pid].name).join(', ');
        errors.push(`Réunion "${m.name}" : ${m.hours}h à caser mais seulement ${cap} créneau(x) où TOUS ces profs (${names}) sont libres en même temps${m.classes.length ? ' et où ces classes sont libres' : ''}.`);
        flaggedMeetings.add(mi);
      }
    });

    // Check 3 : total d'heures d'une classe (hors épingles, donc "à caser" par le
    // solveur — y compris ses regroupements et réunions) > nombre de créneaux
    // VRAIMENT libres de la semaine, c'est-à-dire le total de la grille MOINS
    // les créneaux déjà pris par les épingles de cette classe.
    for (const cls of config.classes) {
      const commonTotal = demand.filter(d => d.cls === cls).reduce((s, d) => s + d.hours, 0) + (groupSlotsByClass[cls] || 0) + (meetingSlotsByClass[cls] || 0);
      const pinnedSlots = pinnedSlotsByClass[cls] || 0;
      const freeCapacity = totalSlotsPerClass - pinnedSlots;
      if (commonTotal > freeCapacity) {
        errors.push(
          `Classe ${cls} : ${commonTotal}h à caser mais seulement ${freeCapacity} créneau(x) libre(s) dans la semaine ` +
          `(${totalSlotsPerClass} créneau(x) ouvert(s) au total sur la grille` +
          (pinnedSlots > 0 ? `, dont ${pinnedSlots} déjà occupé(s) par des épingles` : '') +
          `). Réduis les volumes, ouvre plus de créneaux, ou déplace des épingles.`
        );
      }
      // Check 3-A/B : chaque semaine A/B porte les heures communes EN PLUS de
      // ses propres heures spécifiques — la grille physique (nb de créneaux)
      // est la même chaque semaine, donc chacune doit tenir dedans séparément.
      for (const [weekDemand, weekLabel] of [[demandA, 'A'], [demandB, 'B']]) {
        const weekExtra = weekDemand.filter(d => d.cls === cls).reduce((s, d) => s + d.hours, 0);
        if (weekExtra === 0) continue;
        const weekTotal = commonTotal + weekExtra;
        if (weekTotal > freeCapacity) {
          errors.push(
            `Classe ${cls}, semaine ${weekLabel} : ${commonTotal}h communes + ${weekExtra}h spécifiques à cette semaine = ${weekTotal}h à caser, mais seulement ${freeCapacity} créneau(x) libre(s) dans la grille. ` +
            `Réduis les heures semaine ${weekLabel}, ou déplace des heures communes vers l'autre semaine.`
          );
        }
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
    // Les réunions sont TOUJOURS exclusives pour chacun des profs requis (par
    // construction, personne d'autre ne peut les remplacer).
    meetings.forEach((m, mi) => {
      for (const pid of m.profIds) {
        exclusiveByProf[pid] = (exclusiveByProf[pid] || 0) + m.hours;
        if (!flaggedMeetings.has(mi)) {
          remainingByProf[pid] = (remainingByProf[pid] || 0) + m.hours;
          (subjectsByProf[pid] = subjectsByProf[pid] || new Set()).add(`${m.name} (réunion)`);
        }
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

    // Check 4-A/B : un prof peut être tranquille sur la charge commune seule,
    // mais dépassé une fois qu'on ajoute ses heures exclusives spécifiques à
    // une semaine (dispo hebdomadaire identique chaque semaine, donc chaque
    // semaine doit être vérifiée séparément contre la même dispo).
    for (const [weekDemand, weekLabel] of [[demandA, 'A'], [demandB, 'B']]) {
      const weekExclusiveByProf = {};
      const weekSubjectsByProf = {};
      for (const d of weekDemand) {
        const elig = eligibleFor(d.subj, d.cls);
        if (elig.length !== 1) continue;
        const pid = elig[0].id;
        weekExclusiveByProf[pid] = (weekExclusiveByProf[pid] || 0) + d.hours;
        (weekSubjectsByProf[pid] = weekSubjectsByProf[pid] || new Set()).add(`${d.subj} (${d.cls}, semaine ${weekLabel})`);
      }
      for (const p of profs) {
        const weekExtra = weekExclusiveByProf[p.id] || 0;
        if (weekExtra === 0) continue;
        const combined = (exclusiveByProf[p.id] || 0) + weekExtra;
        const avail = availCountFor(p);
        if (combined > avail) {
          const subs = [...weekSubjectsByProf[p.id]].join(', ');
          errors.push(`${p.name}, semaine ${weekLabel} : ${exclusiveByProf[p.id] || 0}h exclusives communes + ${weekExtra}h exclusives spécifiques (${subs}) = ${combined}h, mais seulement ${avail} créneau(x) de dispo.`);
        }
      }
    }

    if (errors.length > 0) {
      return {
        ok: false,
        message: 'Configuration infaisable — ' + errors.length + ' problème(s) :\n• ' + errors.join('\n• '),
      };
    }

    // ---------- Préparation de la recherche ----------
    // `allSessionClasses` inclut les classes réelles ET les classes fictives
    // des réunions sans classe (voir buildContext) — busyClass doit couvrir les deux.
    // Semaine A/B : DEUX grilles d'occupation par classe/prof (au lieu d'une)
    // — une session "both" (le cas normal : pins/groupes/réunions/demande
    // commune) occupe les DEUX grilles à la fois ; une session "A" ou "B"
    // n'occupe QUE la sienne, ce qui permet à une session "A" et une session
    // "B" du même (classe, jour, créneau) de coexister sans jamais se voir
    // comme en conflit — exactement le mécanisme qui permet à un créneau
    // d'alterner de contenu d'une semaine sur l'autre. `freeClass`/`freeProf`
    // et `markClass`/`markProf` sont le seul endroit qui sait traduire le tag
    // `week` d'une session en lecture/écriture sur la ou les bonnes grilles —
    // tout le reste du code (candidatesFor, domainSize, assign/undo) passe
    // par ces helpers plutôt que de toucher busyClassA/B directement.
    const busyClassA = {}, busyClassB = {};
    for (const cls of allSessionClasses) {
      busyClassA[cls] = config.days.map(() => new Array(slotCount).fill(false));
      busyClassB[cls] = config.days.map(() => new Array(slotCount).fill(false));
    }
    const busyProfA = {}, busyProfB = {};
    for (const p of profs) {
      busyProfA[p.id] = config.days.map(() => new Array(slotCount).fill(false));
      busyProfB[p.id] = config.days.map(() => new Array(slotCount).fill(false));
    }
    const freeClass = (cls, d, s, week) => {
      if (week === 'A') return !busyClassA[cls][d][s];
      if (week === 'B') return !busyClassB[cls][d][s];
      return !busyClassA[cls][d][s] && !busyClassB[cls][d][s];
    };
    const freeProf = (pid, d, s, week) => {
      if (week === 'A') return !busyProfA[pid][d][s];
      if (week === 'B') return !busyProfB[pid][d][s];
      return !busyProfA[pid][d][s] && !busyProfB[pid][d][s];
    };
    const markClass = (cls, d, s, week, val) => {
      if (week !== 'B') busyClassA[cls][d][s] = val;
      if (week !== 'A') busyClassB[cls][d][s] = val;
    };
    const markProf = (pid, d, s, week, val) => {
      if (week !== 'B') busyProfA[pid][d][s] = val;
      if (week !== 'A') busyProfB[pid][d][s] = val;
    };
    // Écriture/effacement d'une cellule de schedule, semaine-consciente : une
    // session "both" garde le format PLAT historique ({subj, profId, ...}) —
    // rétro-compatible avec tout le reste du code (rendu, swap, export). Une
    // session "A"/"B" ne peut JAMAIS partager une cellule avec une session
    // "both" (le busy-tracking ci-dessus l'empêche), donc {weekA, weekB} est
    // un format sans ambiguïté : sa seule présence signale "cette cellule
    // alterne selon la semaine" au reste de l'appli (rendu, texte copié...).
    const writeCell = (cls, d, s, week, cellData) => {
      const key = `${cls}|${d}|${s}`;
      if (week === 'both') { schedule[key] = cellData; return; }
      const existing = schedule[key] || {};
      existing[week === 'A' ? 'weekA' : 'weekB'] = cellData;
      schedule[key] = existing;
    };
    const clearCell = (cls, d, s, week) => {
      const key = `${cls}|${d}|${s}`;
      if (week === 'both') { delete schedule[key]; return; }
      const existing = schedule[key];
      if (!existing) return;
      delete existing[week === 'A' ? 'weekA' : 'weekB'];
      if (!existing.weekA && !existing.weekB) delete schedule[key];
    };

    const schedule = {};
    for (const k of Object.keys(pinnedSchedule)) {
      schedule[k] = pinnedSchedule[k];
      const [cls, d, s] = k.split('|');
      markClass(cls, +d, +s, 'both', true);
      const profId = pinnedSchedule[k].profId;
      if (profId) markProf(profId, +d, +s, 'both', true);
    }

    // Créneaux fermés (config.openSlots) : marqués "busy" pour TOUTES les
    // classes et TOUS les profs, dans les DEUX grilles — comme ça
    // candidatesFor/domainSize les excluent automatiquement, sans avoir
    // besoin d'un check `isOpen` séparé sur ce chemin très chaud.
    for (const d of dayIdxs) {
      for (let s = 0; s < slotCount; s++) {
        if (isOpen(d, s)) continue;
        for (const cls of allSessionClasses) markClass(cls, d, s, 'both', true);
        for (const p of profs) markProf(p.id, d, s, 'both', true);
      }
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
    const affectedBy = (classesArr, profIds, spreadKey) => {
      const set = new Set();
      for (const cls of classesArr) {
        for (const idx of (sessionsByClass[cls] || [])) set.add(idx);
      }
      for (const pid of profIds) {
        for (const idx of (sessionsByProf[pid] || [])) set.add(idx);
      }
      if (spreadKey) {
        for (const idx of (sessionsBySpreadKey[spreadKey] || [])) set.add(idx);
      }
      return set;
    };

    // Pour une session "allRequired" (réunion / cours co-enseigné), les profs
    // ne sont pas choisis parmi des éligibles : TOUS ceux de `elig` doivent
    // être libres au même (jour, slot) — un seul candidat possible par (jour,
    // slot), pas un par prof éligible comme pour une session normale.
    const candidatesFor = (sess) => {
      const list = [];
      const week = sess.week;
      for (const d of dayIdxs) {
        if (sess.spreadKey && spreadUsedDay[`${sess.spreadKey}|${d}`]) continue; // jour déjà pris par une autre heure de cette matière/classe
        for (let s = 0; s < slotCount; s++) {
          if (sess.classes.some(cls => !freeClass(cls, d, s, week))) continue; // TOUTES les classes doivent être libres (sur la/les semaine(s) de cette session)
          if (sess.allRequired) {
            if (sess.elig.some(p => !freeProf(p.id, d, s, week))) continue;
            if (sess.elig.some(p => !p.availability?.[d]?.[s])) continue;
            list.push({ day: d, slot: s, profIds: sess.elig.map(p => p.id) });
          } else {
            for (const prof of sess.elig) {
              if (!freeProf(prof.id, d, s, week)) continue;
              if (!prof.availability?.[d]?.[s]) continue;
              list.push({ day: d, slot: s, profIds: [prof.id] });
            }
          }
        }
      }
      return list;
    };
    // Comme candidatesFor mais ne construit pas la liste — appelé très
    // souvent (MRV + forward-checking), on évite l'allocation à chaque fois.
    const domainSize = (idx) => {
      const sess = sessions[idx];
      const week = sess.week;
      let n = 0;
      for (const d of dayIdxs) {
        if (sess.spreadKey && spreadUsedDay[`${sess.spreadKey}|${d}`]) continue;
        for (let s = 0; s < slotCount; s++) {
          if (sess.classes.some(cls => !freeClass(cls, d, s, week))) continue;
          if (sess.allRequired) {
            if (sess.elig.every(p => freeProf(p.id, d, s, week) && p.availability?.[d]?.[s])) n++;
          } else {
            for (const prof of sess.elig) {
              if (freeProf(prof.id, d, s, week) && prof.availability?.[d]?.[s]) n++;
            }
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
    const applyDelta = (classesArr, profIds, checkWipeout, spreadKey) => {
      const wiped = [];
      for (const idx of affectedBy(classesArr, profIds, spreadKey)) {
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
    // Le budget total est partagé entre PLUSIEURS tentatives (redémarrages),
    // pas consommé par une seule — voir le commentaire au-dessus de la boucle
    // de redémarrage plus bas pour pourquoi. `budgetOk`/`aborted`/`iterCount`
    // sont réaffectés à chaque tentative (via `let`, capturés par référence
    // dans `backtrack` qui est défini une seule fois) ; `totalIter` cumule
    // across tentatives pour le message final et pour la limite MAX_ITER globale.
    const startTime = Date.now();
    const TIME_BUDGET_MS = options.solverTimeBudgetMs || 8000;
    const MAX_ITER = options.solverMaxIter || 60000000;
    let totalIter = 0;
    let iterCount = 0;
    let aborted = false;
    let budgetOk = () => false;

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
          allRequired: p.sess.allRequired, meetingId: p.sess.meetingId, meetingName: p.sess.meetingName,
          week: p.sess.week, day: p.c.day, slot: p.c.slot, profIds: p.c.profIds,
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
              if (s >= 0 && s < slotCount && !freeClass(repCls, c.day, s, sess.week)) score--;
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
          markClass(cls, c.day, c.slot, sess.week, true);
          writeCell(cls, c.day, c.slot, sess.week, {
            profId: c.profIds[0], profIds: c.profIds, subj: sess.subj,
            grouped: sess.classes.length > 1, meeting: !!sess.meetingId, meetingId: sess.meetingId,
          });
        }
        for (const pid of c.profIds) markProf(pid, c.day, c.slot, sess.week, true);
        if (sess.spreadKey) {
          const k = `${sess.spreadKey}|${c.day}`;
          spreadUsedDay[k] = (spreadUsedDay[k] || 0) + 1;
        }
        placedStack.push({ sess, c });

        // Forward-checking : si ce placement vide le domaine d'une autre
        // session pas encore posée, inutile de récurser — c'est déjà mort.
        const wiped = applyDelta(sess.classes, c.profIds, true, sess.spreadKey);
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
          markClass(cls, c.day, c.slot, sess.week, false);
          clearCell(cls, c.day, c.slot, sess.week);
        }
        for (const pid of c.profIds) markProf(pid, c.day, c.slot, sess.week, false);
        if (sess.spreadKey) {
          const k = `${sess.spreadKey}|${c.day}`;
          spreadUsedDay[k]--;
          if (spreadUsedDay[k] === 0) delete spreadUsedDay[k];
        }
        applyDelta(sess.classes, c.profIds, false, sess.spreadKey);

        if (aborted) break;
      }

      assigned[idx] = false;
      remaining.push(idx);
      if (!aborted) bumpBlocked(idx); // aucun candidat n'a marché : session bloquée

      return false;
    };

    // ---------- Redémarrages : plusieurs tentatives dans le même budget ----------
    // L'ordre des candidats est mélangé à CHAQUE nœud (voir plus haut) : un
    // mauvais tirage tôt près de la racine de l'arbre peut faire échouer une
    // tentative entière en restant bloquée près du début, sans jamais aller
    // en profondeur — observé concrètement : une tentative peut plafonner à
    // 31/115 quand une autre, sur la même config, atteint 108/112. Une seule
    // tentative de 8s mise donc tout sur UN tirage ; en découpant le budget
    // total en plusieurs tentatives indépendantes (chacune avec un nouveau
    // mélange), on limite les dégâts d'un tirage malchanceux sans jamais
    // perdre le meilleur résultat obtenu (deepestCount/bestPlacements/
    // bestMissing/blockedInfo sont déclarés EN DEHORS de cette boucle : ils
    // cumulent sur TOUTES les tentatives, jamais réinitialisés entre deux).
    // Si UNE tentative va au bout de son sous-budget SANS être interrompue
    // (aborted reste false), c'est une preuve d'impossibilité valable pour
    // TOUTE la CSP indépendamment de l'ordre de tirage — inutile de retenter,
    // on s'arrête immédiatement avec ce verdict définitif.
    // Chaque tentative reçoit une TRANCHE plafonnée du budget restant (pas
    // "tout ce qui reste") — sinon la 1ère tentative épuiserait la quasi-
    // totalité du budget total et il n'y aurait jamais de second tirage en
    // pratique. `solverRestartChunkMs` est un réglage interne (pas exposé en
    // UI) utilisé pour mesurer/ajuster empiriquement la taille de tranche.
    const CHUNK_MS = options.solverRestartChunkMs || Math.max(500, Math.min(TIME_BUDGET_MS / 4, 2000));
    let ok = false;
    while (true) {
      const remainingMs = TIME_BUDGET_MS - (Date.now() - startTime);
      if (remainingMs <= 0 || totalIter >= MAX_ITER) { aborted = true; break; }
      const attemptBudgetMs = Math.min(CHUNK_MS, remainingMs);
      iterCount = 0;
      aborted = false;
      const attemptStart = Date.now();
      budgetOk = () => {
        iterCount++; totalIter++;
        if (totalIter > MAX_ITER) { aborted = true; return false; }
        if ((iterCount & 1023) === 0 && Date.now() - attemptStart > attemptBudgetMs) { aborted = true; return false; }
        return true;
      };
      ok = backtrack();
      if (ok || !aborted) break; // solution trouvée, ou impossibilité prouvée par cette tentative
    }

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
      const cellData = {
        profId: p.profIds[0], profIds: p.profIds, subj: p.subj,
        grouped: p.classes.length > 1, meeting: !!p.meetingId, meetingId: p.meetingId,
      };
      for (const cls of p.classes) {
        const key = `${cls}|${p.day}|${p.slot}`;
        if (p.week === 'both' || !p.week) {
          partialSchedule[key] = cellData;
        } else {
          const existing = partialSchedule[key] || {};
          existing[p.week === 'A' ? 'weekA' : 'weekB'] = cellData;
          partialSchedule[key] = existing;
        }
      }
    }
    const partial = { placements: bestPlacements, missing: bestMissing, schedule: partialSchedule };

    if (aborted) {
      return {
        ok: false,
        aborted: true,
        partial,
        message:
          `Recherche interrompue après ${totalIter.toLocaleString('fr')} itérations (${Date.now() - startTime}ms) ` +
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
    const { dayIdxs, slotCount, pinnedSchedule, pinnedBusyClass, pinnedBusyProf, isOpen } = ctx;

    // Un "item" = une session à placer, qu'elle soit déjà bien casée (dans
    // partial.placements) ou encore manquante (dans partial.missing). Toutes
    // sont mutables ici — y compris celles déjà bien placées : les déplacer
    // peut être nécessaire pour faire de la place aux manquantes. Seules les
    // épingles (pinnedBusyClass/pinnedBusyProf) restent strictement figées.
    const items = [];
    for (const p of partial.placements) {
      items.push({
        classes: p.classes, subj: p.subj, elig: p.elig, spreadKey: p.spreadKey || null,
        allRequired: !!p.allRequired, meetingId: p.meetingId || null, week: p.week || 'both',
        day: p.day, slot: p.slot, profIds: p.profIds || [p.profId],
      });
    }
    for (const m of partial.missing) {
      // Amorce arbitraire : premier (jour, slot) où le(s) prof(s) requis
      // sont réellement disponibles (hors épingles ou pas — min-conflicts va
      // de toute façon immédiatement chercher à résoudre le conflit s'il y en a).
      let seed = null;
      if (m.allRequired) {
        for (const d of dayIdxs) {
          for (let s = 0; s < slotCount; s++) {
            if (isOpen(d, s) && m.elig.every(prof => prof.availability?.[d]?.[s])) { seed = { day: d, slot: s, profIds: m.elig.map(p => p.id) }; break; }
          }
          if (seed) break;
        }
        if (!seed) seed = { day: dayIdxs[0], slot: 0, profIds: m.elig.map(p => p.id) };
      } else {
        for (const prof of m.elig) {
          for (const d of dayIdxs) {
            for (let s = 0; s < slotCount; s++) {
              if (isOpen(d, s) && prof.availability?.[d]?.[s]) { seed = { day: d, slot: s, profIds: [prof.id] }; break; }
            }
            if (seed) break;
          }
          if (seed) break;
        }
        if (!seed) seed = { day: dayIdxs[0], slot: 0, profIds: [m.elig[0].id] }; // ne devrait pas arriver (Check1/2 l'auraient déjà signalé)
      }
      items.push({
        classes: m.classes, subj: m.subj, elig: m.elig, spreadKey: m.spreadKey || null,
        allRequired: !!m.allRequired, meetingId: m.meetingId || null, week: m.week || 'both',
        day: seed.day, slot: seed.slot, profIds: seed.profIds,
      });
    }

    // Occupation courante de chaque (classe|jour|slot) et (prof|jour|slot) —
    // par nombre d'items présents (0 ou 1 = OK, 2+ = conflit). Les épingles
    // comptent comme un occupant permanent supplémentaire qu'on ne retire
    // jamais, pour qu'un item ne puisse jamais se poser dessus sans conflit.
    // Semaine A/B : les clés d'occupation portent un suffixe "|A" ou "|B" — un
    // item "both" occupe les DEUX clés (comme les épingles, toujours "both"),
    // un item "A"/"B" n'occupe QUE la sienne, ce qui permet à un item "A" et
    // un item "B" de partager le même (classe/prof, jour, slot) sans jamais
    // se voir en conflit — même mécanisme que `markClass`/`markProf` dans
    // `solve()`, transposé au modèle "compteur d'occupants" de repair().
    const classOcc = {};  // "cls|d|s|A-ou-B" -> count
    const profOcc = {};   // "profId|d|s|A-ou-B" -> count
    const spreadOcc = {}; // "spreadKey|d" -> count de sessions de cette matière/classe déjà ce jour-là
    const bump = (map, key, delta) => { map[key] = (map[key] || 0) + delta; };
    const weekKeys = (week) => week === 'A' ? ['A'] : week === 'B' ? ['B'] : ['A', 'B'];
    for (const key of Object.keys(pinnedBusyClass)) { bump(classOcc, key + '|A', 1); bump(classOcc, key + '|B', 1); }
    for (const key of Object.keys(pinnedBusyProf)) { bump(profOcc, key + '|A', 1); bump(profOcc, key + '|B', 1); }
    const place = (it, delta) => {
      for (const wk of weekKeys(it.week)) {
        for (const cls of it.classes) bump(classOcc, `${cls}|${it.day}|${it.slot}|${wk}`, delta);
        for (const pid of it.profIds) bump(profOcc, `${pid}|${it.day}|${it.slot}|${wk}`, delta);
      }
      if (it.spreadKey) bump(spreadOcc, `${it.spreadKey}|${it.day}`, delta);
    };
    items.forEach(it => place(it, 1));

    // Conflits d'un item = somme, sur chacune de ses classes ET sur son prof
    // (pour chaque semaine que cet item occupe), du nombre d'AUTRES occupants
    // au même (jour, slot, semaine), PLUS (si une règle de répartition
    // s'applique) le nombre d'autres heures de la même matière/classe déjà
    // posées CE JOUR-LÀ. On retire d'abord sa propre contribution pour ne
    // compter que les autres.
    const conflictsOf = (it) => {
      let n = 0;
      for (const wk of weekKeys(it.week)) {
        for (const cls of it.classes) n += (classOcc[`${cls}|${it.day}|${it.slot}|${wk}`] || 0) - 1;
        for (const pid of it.profIds) n += (profOcc[`${pid}|${it.day}|${it.slot}|${wk}`] || 0) - 1;
      }
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
      const occScore = (day, slot) => {
        let score = 0;
        for (const wk of weekKeys(it.week)) {
          for (const cls of it.classes) score += (classOcc[`${cls}|${day}|${slot}|${wk}`] || 0);
        }
        return score;
      };
      for (const day of dayIdxs) {
        if (it.spreadKey && (spreadOcc[`${it.spreadKey}|${day}`] || 0) > 0) continue; // jour déjà pris par une autre heure de cette matière/classe
        for (let slot = 0; slot < slotCount; slot++) {
          if (!isOpen(day, slot)) continue; // créneau fermé (pas cours)
          if (it.classes.some(cls => pinnedBusyClass[`${cls}|${day}|${slot}`])) continue;
          if (it.allRequired) {
            if (it.elig.some(p => pinnedBusyProf[`${p.id}|${day}|${slot}`])) continue;
            if (it.elig.some(p => !p.availability?.[day]?.[slot])) continue;
            let score = occScore(day, slot);
            for (const wk of weekKeys(it.week)) {
              for (const p of it.elig) score += (profOcc[`${p.id}|${day}|${slot}|${wk}`] || 0);
            }
            const opt = { day, slot, profIds: it.elig.map(p => p.id) };
            allOptions.push(opt);
            if (score < bestScore) { bestScore = score; bestOptions = [opt]; }
            else if (score === bestScore) bestOptions.push(opt);
          } else {
            for (const prof of it.elig) {
              if (pinnedBusyProf[`${prof.id}|${day}|${slot}`]) continue;
              if (!prof.availability?.[day]?.[slot]) continue;
              let score = occScore(day, slot);
              for (const wk of weekKeys(it.week)) score += (profOcc[`${prof.id}|${day}|${slot}|${wk}`] || 0);
              const opt = { day, slot, profIds: [prof.id] };
              allOptions.push(opt);
              if (score < bestScore) { bestScore = score; bestOptions = [opt]; }
              else if (score === bestScore) bestOptions.push(opt);
            }
          }
        }
      }
      const pool = (allOptions.length > 0 && Math.random() < 0.1) ? allOptions : bestOptions;
      const choice = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : { day: it.day, slot: it.slot, profIds: it.profIds };
      it.day = choice.day; it.slot = choice.slot; it.profIds = choice.profIds;
      place(it, 1);
    }

    const stillConflicted = items.filter(it => conflictsOf(it) > 0);
    const dtMs = Date.now() - startTime;

    if (stillConflicted.length === 0) {
      const schedule = {};
      for (const k of Object.keys(pinnedSchedule)) schedule[k] = pinnedSchedule[k];
      for (const it of items) {
        const cellData = {
          profId: it.profIds[0], profIds: it.profIds, subj: it.subj,
          grouped: it.classes.length > 1, meeting: !!it.meetingId, meetingId: it.meetingId,
        };
        for (const cls of it.classes) {
          const key = `${cls}|${it.day}|${it.slot}`;
          if (it.week === 'both' || !it.week) {
            schedule[key] = cellData;
          } else {
            const existing = schedule[key] || {};
            existing[it.week === 'A' ? 'weekA' : 'weekB'] = cellData;
            schedule[key] = existing;
          }
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
    const { profs, demand, demandA, demandB, groups, meetings, eligibleFor, availCountFor } = ctx;

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
    // Les réunions sont toujours exclusives pour tous les profs requis.
    for (const m of meetings) {
      for (const pid of m.profIds) {
        exclusiveHours[pid] = (exclusiveHours[pid] || 0) + m.hours;
        (exclusiveLabels[pid] = exclusiveLabels[pid] || new Set()).add(`${m.name} (réunion)`);
      }
    }
    // Semaine A/B : un prof ne porte JAMAIS les deux à la fois (elles
    // n'arrivent jamais la même semaine) — on ajoute donc le pire des deux
    // (la semaine la plus chargée) plutôt que la somme, pour que la marge
    // affichée reflète la semaine réellement la plus tendue.
    const weekExclusive = (weekDemand) => {
      const byProf = {};
      for (const d of weekDemand) {
        const elig = eligibleFor(d.subj, d.cls);
        if (elig.length !== 1) continue;
        const pid = elig[0].id;
        byProf[pid] = (byProf[pid] || 0) + d.hours;
      }
      return byProf;
    };
    const exclusiveA = weekExclusive(demandA);
    const exclusiveB = weekExclusive(demandB);
    for (const p of profs) {
      const worst = Math.max(exclusiveA[p.id] || 0, exclusiveB[p.id] || 0);
      if (worst === 0) continue;
      exclusiveHours[p.id] = (exclusiveHours[p.id] || 0) + worst;
      const weekLabel = (exclusiveA[p.id] || 0) >= (exclusiveB[p.id] || 0) ? 'A' : 'B';
      (exclusiveLabels[p.id] = exclusiveLabels[p.id] || new Set()).add(`+${worst}h semaine ${weekLabel} (pire semaine)`);
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
