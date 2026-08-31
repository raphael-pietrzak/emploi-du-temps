// storage.js — persistance isolée derrière une interface simple.
// Aujourd'hui: localStorage. Demain: API réseau, sans toucher UI ni solveur.

const STORAGE_KEY = 'edt_state_v1';

const Storage = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.error('load failed', e);
      return null;
    }
  },

  save(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  },

  export(state) {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `emploi-du-temps-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  import(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try { resolve(JSON.parse(e.target.result)); }
        catch (err) { reject(err); }
      };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  },

  defaultState() {
    return {
      config: {
        days: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'],
        slots: [
          { start: '08:20', end: '09:20' },
          { start: '09:20', end: '10:10' },
          { start: '10:25', end: '11:15' },
          { start: '11:15', end: '12:05' },
          { start: '13:15', end: '14:05' },
          { start: '14:05', end: '14:55' },
          { start: '15:10', end: '16:00' },
        ],
        // openSlots[jour][créneau] = true -> il y a cours à ce moment-là (pour
        // tout le monde). Par défaut tout est ouvert ; on ferme des créneaux
        // précis (ex: mercredi après-midi) plutôt que des jours entiers.
        openSlots: [0, 1, 2, 3, 4].map(() => new Array(7).fill(true)),
        classes: ['6e', '5e', '4e', '3e'],
        subjects: ['Maths', 'Français', 'Anglais', 'Histoire-Géo', 'SVT', 'Physique', 'EPS', 'Arts', 'Musique', 'Techno'],
      },
      profs: [],
      volumes: {},  // "classe|matiere" -> heures (toutes les semaines)
      volumesA: {}, // "classe|matiere" -> heures EN PLUS, uniquement les semaines A
      volumesB: {}, // "classe|matiere" -> heures EN PLUS, uniquement les semaines B
      schedule: null,
      // Numéro de version auto-incrémenté (affiché "vMAJOR.MINOR") : major++
      // (et minor remis à 0) à chaque nouvelle génération/réparation, minor++
      // à chaque modification manuelle (échange de cellules) — voir
      // UI.bumpVersion. Sert de nom par défaut aux versions sauvegardées et
      // aux exports (js/ui/schedule.js, js/ui/capture.js).
      version: { major: 0, minor: 0 },
      savedSchedules: [], // [{ id, name, date, schedule, message, version }] — versions gardées de côté pour comparer, jamais écrasées par une nouvelle génération
      constraints: {
        pins: [],       // { id, subj, classes:[..], day, slot, profId?: null }
        groups: [],     // { id, subj, classes:[..] (>=2), hours, profId?: null } — regroupées, mais sans jour/créneau imposé
        spread: [],     // { id, subj, classes:[..] } — jamais 2h de cette matière le même jour, pour chaque classe listée
        meetings: [],   // { id, name, profIds:[..] (>=2, tous obligatoires), classes:[..] (0+), hours, subj?: null }
      },
      options: { spreadForClasses: true, noGapsForProfs: true },
    };
  },
};
