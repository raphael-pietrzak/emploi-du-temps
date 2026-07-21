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
    const dayIdxs = config.activeDays.map((a, i) => a ? i : -1).filter(i => i >= 0);
    const slotCount = config.slots.length;

    // 1. Construire les sessions à placer
    const sessions = [];
    for (const cls of config.classes) {
      for (const subj of config.subjects) {
        const hours = volumes[`${cls}|${subj}`] || 0;
        for (let i = 0; i < hours; i++) {
          sessions.push({ cls, subj });
        }
      }
    }

    // 2. Structures d'occupation
    // busyClass[cls][day][slot] = true|false
    // busyProf[profId][day][slot] = true|false
    const busyClass = {};
    for (const cls of config.classes) {
      busyClass[cls] = config.days.map(() => new Array(slotCount).fill(false));
    }
    const busyProf = {};
    for (const p of profs) {
      busyProf[p.id] = config.days.map(() => new Array(slotCount).fill(false));
    }

    // 3. Helper: liste des placements possibles pour une session
    const candidatesFor = (sess) => {
      const eligible = profs.filter(p => (p.subjects || []).includes(sess.subj));
      const list = [];
      for (const d of dayIdxs) {
        for (let s = 0; s < slotCount; s++) {
          if (busyClass[sess.cls][d][s]) continue;
          for (const prof of eligible) {
            if (busyProf[prof.id][d][s]) continue;
            const avail = prof.availability?.[d]?.[s];
            if (!avail) continue;
            list.push({ day: d, slot: s, profId: prof.id });
          }
        }
      }
      return list;
    };

    // 4. Vérification préliminaire: chaque session doit avoir au moins un candidat.
    for (const sess of sessions) {
      const eligible = profs.filter(p => (p.subjects || []).includes(sess.subj));
      if (eligible.length === 0) {
        return { ok: false, message: `Aucun prof n'enseigne "${sess.subj}" (requis pour ${sess.cls}).` };
      }
    }

    // 5. Placement par backtracking avec MRV (choisir la session la plus contrainte)
    const schedule = {}; // "cls|day|slot" -> {prof, subj}
    const placed = [];

    const totalSlotsAvailPerClass = dayIdxs.length * slotCount;
    for (const cls of config.classes) {
      const need = sessions.filter(s => s.cls === cls).length;
      if (need > totalSlotsAvailPerClass) {
        return { ok: false, message: `Classe ${cls}: ${need}h à caser mais seulement ${totalSlotsAvailPerClass} créneaux dispos.` };
      }
    }

    const remaining = [...sessions];

    // Bonus : trier par difficulté grossière (moins de profs eligibles = plus dur)
    remaining.sort((a, b) => {
      const na = profs.filter(p => (p.subjects || []).includes(a.subj)).length;
      const nb = profs.filter(p => (p.subjects || []).includes(b.subj)).length;
      return na - nb;
    });

    const backtrack = (idx) => {
      if (idx >= remaining.length) return true;
      const sess = remaining[idx];
      const cands = candidatesFor(sess);
      if (cands.length === 0) return false;

      // Heuristique: préférer les créneaux du matin d'abord, et si "no gaps",
      // préférer les créneaux adjacents à ceux déjà pris pour la classe.
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
        return a.slot - b.slot;
      });

      for (const c of cands) {
        busyClass[sess.cls][c.day][c.slot] = true;
        busyProf[c.profId][c.day][c.slot] = true;
        schedule[`${sess.cls}|${c.day}|${c.slot}`] = { profId: c.profId, subj: sess.subj };
        placed.push({ sess, c });

        if (backtrack(idx + 1)) return true;

        // undo
        busyClass[sess.cls][c.day][c.slot] = false;
        busyProf[c.profId][c.day][c.slot] = false;
        delete schedule[`${sess.cls}|${c.day}|${c.slot}`];
        placed.pop();
      }
      return false;
    };

    const ok = backtrack(0);
    if (!ok) {
      return { ok: false, message: `Impossible de placer tous les cours. Vérifie les dispos des profs et les volumes.` };
    }
    return { ok: true, schedule, message: `Emploi du temps généré : ${sessions.length} créneaux placés.` };
  },
};
