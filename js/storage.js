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
        activeDays: [true, true, true, true, true],
        slots: [
          { start: '08:20', end: '09:20' },
          { start: '09:20', end: '10:10' },
          { start: '10:25', end: '11:15' },
          { start: '11:15', end: '12:05' },
          { start: '13:15', end: '14:05' },
          { start: '14:05', end: '14:55' },
          { start: '15:10', end: '16:00' },
        ],
        classes: ['6e', '5e', '4e', '3e'],
        subjects: ['Maths', 'Français', 'Anglais', 'Histoire-Géo', 'SVT', 'Physique', 'EPS', 'Arts', 'Musique', 'Techno'],
      },
      profs: [],
      volumes: {},  // "classe|matiere" -> heures
      schedule: null,
      constraints: {
        pins: [],       // { id, subj, classes:[..], day, slot, profId?: null }
        timePref: {},   // { [subj]: 'early' | 'late' | 'any' }
      },
      options: { noGapsForStudents: false, randomize: true },
    };
  },
};
