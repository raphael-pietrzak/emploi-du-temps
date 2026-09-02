// ics.js — export iCalendar (.ics) de l'emploi du temps, en zip (un fichier
// par classe + un par prof), pour import dans Google Agenda, Apple Calendar,
// Outlook, etc. Purement client (pas de backend, cf. CLAUDE.md) : pas d'URL
// d'abonnement live (webcal://) qui se mettrait à jour automatiquement —
// l'utilisateur ré-exporte et redistribue le zip après un changement notable.
//
// Pas de date demandée à l'utilisateur : on ancre chaque évènement sur le
// prochain lundi (ou aujourd'hui si on est déjà lundi) et on le fait
// récurrer chaque semaine indéfiniment (RRULE FREQ=WEEKLY, sans UNTIL) — le
// calendrier importé n'a pas besoin de connaître "la vraie date de la
// rentrée", juste répéter le bon jour de la semaine au bon horaire.
//
// Un créneau qui alterne semaine A/B (cell.weekA/weekB, voir solver.js) n'a
// pas de vraie date d'ancrage disponible ici (on ne sait pas laquelle des
// deux tombe la semaine du lundi choisi) : au lieu d'une récurrence
// INTERVAL=2 forcément fausse une semaine sur deux, on met les deux dans LE
// MÊME évènement récurrent hebdomadaire (résumé "Maths (semaine A) / Anglais
// (semaine B)") — l'utilisateur voit chaque semaine les deux possibilités et
// sait laquelle s'applique via l'affichage habituel (onglet Emploi du temps).

const ICS_DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']; // index 0 = Lun, cf. config.days

function icsEscape(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

// RFC5545 : une ligne de contenu ne doit pas dépasser 75 octets ; au-delà, on
// la scinde avec un CRLF suivi d'un espace (continuation).
function icsFold(line) {
  if (line.length <= 75) return line;
  let out = line.slice(0, 75);
  let rest = line.slice(75);
  while (rest.length > 0) {
    out += '\r\n ' + rest.slice(0, 74);
    rest = rest.slice(74);
  }
  return out;
}

function pad2(n) { return String(n).padStart(2, '0'); }

// Heure "flottante" (pas de Z, pas de TZID) : interprétée dans le fuseau
// local de qui l'importe. Pour un emploi du temps d'établissement en France,
// consulté par des gens en France, c'est exact et évite toute gestion
// UTC/DST/VTIMEZONE.
function icsDateTime(date, hh, mm) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}T${pad2(hh)}${pad2(mm)}00`;
}

// Lundi de la semaine à venir (ou aujourd'hui si on est déjà lundi) : sert
// uniquement d'ancre de date pour DTSTART, la récurrence hebdomadaire fait
// le reste — aucune signification de "premier jour de cours".
function nextMonday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7));
  return d;
}

Object.assign(UI, {
  bindIcs() {
    const btn = document.getElementById('export-ics-btn');
    if (!btn) return;
    btn.addEventListener('click', () => this.exportIcsZip());
  },

  // Descripteur -> { subj, who } (session unique), en fusionnant weekA/weekB
  // dans un seul évènement plutôt que deux séries récurrentes distinctes
  // (voir en-tête de fichier). `isProfView` distingue les deux sens du champ
  // "bottom" d'un descripteur (voir cellDescriptor/profCellData) : dans une
  // vue classe c'est le(s) nom(s) de prof (peu utile en titre, la classe est
  // déjà celle du calendrier) ; dans une vue prof c'est le(s) nom(s) de
  // classe — et là il DOIT apparaître dans le titre, sinon un prof qui donne
  // Anglais à 15 classes différentes verrait "Anglais" 15 fois dans son
  // agenda sans moyen de les distinguer.
  icsEventContentFor(descriptor, isProfView) {
    if (!descriptor) return null;
    // Classe en premier : dans une vue mois ou un agenda mobile, le titre est
    // souvent tronqué après quelques caractères — la classe (l'info qui
    // distingue les évènements entre eux pour un prof) doit rester visible
    // même tronquée, la matière peut disparaître sans perte d'info critique.
    const titleFor = (subj, who) => isProfView ? `${who || '?'} ${subj}` : subj;
    if (descriptor.alt) {
      const parts = [];
      const who = [];
      if (descriptor.weekA) {
        parts.push(`${titleFor(descriptor.weekA.top, descriptor.weekA.bottom)} (semaine A)`);
        if (!isProfView) who.push(`Semaine A : ${descriptor.weekA.bottom || '—'}`);
      }
      if (descriptor.weekB) {
        parts.push(`${titleFor(descriptor.weekB.top, descriptor.weekB.bottom)} (semaine B)`);
        if (!isProfView) who.push(`Semaine B : ${descriptor.weekB.bottom || '—'}`);
      }
      if (parts.length === 0) return null;
      return { subj: parts.join(' / '), who: who.join('  ·  ') };
    }
    return { subj: titleFor(descriptor.top, descriptor.bottom), who: isProfView ? '' : (descriptor.bottom || '') };
  },

  // Construit le texte .ics pour une vue ("class:6e" ou "prof:<id>").
  buildIcsCalendar(view, schedule) {
    const { slots } = this.state.config;
    const monday = nextMonday();
    const dtstamp = (() => {
      const n = new Date();
      return `${n.getUTCFullYear()}${pad2(n.getUTCMonth() + 1)}${pad2(n.getUTCDate())}T${pad2(n.getUTCHours())}${pad2(n.getUTCMinutes())}${pad2(n.getUTCSeconds())}Z`;
    })();

    const calName = view.startsWith('class:') ? 'Classe ' + view.slice(6)
      : 'Prof ' + (this.state.profs.find(p => p.id === view.slice(5))?.name || view.slice(5));

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//emploi-du-temps//FR',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      icsFold(`X-WR-CALNAME:${icsEscape(calName)}`),
    ];

    const activeDays = this.activeDayIndices();
    let seq = 0;
    activeDays.forEach(di => {
      if (di >= ICS_DAY_CODES.length) return; // pas de code ISO au-delà du dimanche
      const date = new Date(monday);
      date.setDate(date.getDate() + di);
      slots.forEach((sl, si) => {
        const isProfView = view.startsWith('prof:');
        const descriptor = isProfView
          ? this.profCellData(view.slice(5), di, si, schedule).descriptor
          : this.cellDescriptor(schedule[`${view.slice(6)}|${di}|${si}`]);
        const content = this.icsEventContentFor(descriptor, isProfView);
        if (!content) return;

        seq++;
        const [sh, sm] = sl.start.split(':').map(Number);
        const [eh, em] = sl.end.split(':').map(Number);

        lines.push('BEGIN:VEVENT');
        lines.push(`UID:edt-${view}-${di}-${si}-${seq}@local`);
        lines.push(`DTSTAMP:${dtstamp}`);
        lines.push(`DTSTART:${icsDateTime(date, sh, sm)}`);
        lines.push(`DTEND:${icsDateTime(date, eh, em)}`);
        lines.push(icsFold(`RRULE:FREQ=WEEKLY;BYDAY=${ICS_DAY_CODES[di]}`));
        lines.push(icsFold(`SUMMARY:${icsEscape(content.subj)}`));
        if (content.who) lines.push(icsFold(`DESCRIPTION:${icsEscape(content.who)}`));
        lines.push('END:VEVENT');
      });
    });

    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  },

  exportIcsZip() {
    const status = document.getElementById('solver-status');
    const schedule = this.state.schedule;
    if (!schedule) {
      this.setStatus(status, 'err', "Rien à exporter : génère un emploi du temps d'abord.");
      return;
    }
    const btn = document.getElementById('export-ics-btn');
    btn.disabled = true;
    try {
      const encoder = new TextEncoder();
      const files = [];
      this.state.config.classes.forEach(cls => {
        const text = this.buildIcsCalendar('class:' + cls, schedule);
        files.push({ name: `classe-${this.captureSafeFilename(cls)}.ics`, data: encoder.encode(text) });
      });
      this.state.profs.forEach(prof => {
        const text = this.buildIcsCalendar('prof:' + prof.id, schedule);
        files.push({ name: `prof-${this.captureSafeFilename(prof.name)}.ics`, data: encoder.encode(text) });
      });
      const zipBlob = Zip.build(files);
      const safeName = this.captureSafeFilename(this.versionName());
      this.triggerDownload(zipBlob, `emploi-du-temps-ical-${safeName}.zip`);
      this.setStatus(status, 'ok', `Export iCal réalisé : ${this.state.config.classes.length} classe(s) + ${this.state.profs.length} prof(s), à importer dans Google Agenda, Apple Calendar ou Outlook.`);
    } catch (err) {
      this.setStatus(status, 'err', "Échec de l'export iCal : " + (err?.message || err));
    } finally {
      btn.disabled = false;
    }
  },
});
