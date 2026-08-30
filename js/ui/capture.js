// capture.js — export en zip d'une "capture" imprimable (PDF) de l'emploi du
// temps général (les 4 classes) et d'un PDF par professeur. Pas de dépendance
// externe (voir CLAUDE.md) : le PDF est écrit à la main (js/pdf.js) et le zip
// aussi (js/zip.js, méthode "store").
//
// Rendu volontairement "conventionnel" plutôt qu'un décalque du thème sombre
// de l'appli : pages A4 paysage, tableau noir sur blanc à bordures fines,
// pensées pour être imprimées telles quelles (ex. affichage salle des profs).
// La donnée vient directement de `schedule` (via cellDescriptor / profCellData
// déjà utilisés par le rendu DOM — schedule.js) plutôt que du DOM lui-même :
// pas de rasterisation, donc aucun souci de canvas "tainted" (cf. tentative
// précédente via SVG foreignObject, qui échouait sur Safari).

const PAGE_W = 842, PAGE_H = 595; // A4 paysage, en points (72/pouce)
const A3_PORTRAIT_W = 842, A3_PORTRAIT_H = 1191; // A3 portrait
const MARGIN = 36;
const BREAK_ROW_H = 15;
// Il n'existe pas de notion de "pause déjeuner" dans state.config (pas de
// champ dédié) — on la déduit d'un écart de temps notable entre la fin d'un
// créneau et le début du suivant. 40min sépare confortablement une vraie
// pause méridienne (ex: 12:05→13:15 par défaut, 70min) d'une simple
// interclasse courte (ex: 10:10→10:25, 15min) sans dépendre des horaires
// exacts d'un établissement donné.
const BREAK_THRESHOLD_MIN = 40;
function parseTimeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function computeBreaksAfter(slots) {
  const set = new Set();
  for (let i = 0; i < slots.length - 1; i++) {
    if (parseTimeToMin(slots[i + 1].start) - parseTimeToMin(slots[i].end) >= BREAK_THRESHOLD_MIN) set.add(i);
  }
  return set;
}

Object.assign(UI, {
  bindCapture() {
    const btn = document.getElementById('export-captures-btn');
    if (!btn) return;
    btn.addEventListener('click', () => this.exportCapturesZip());
  },

  // Dessine un bloc "titre + tableau" (créneaux en lignes, jours actifs en
  // colonnes) dans le rectangle (x, yTop, w, h) donné — indépendant de la
  // taille de page, pour pouvoir soit occuper une page A4 entière
  // (buildScheduleTablePage) soit être empilé plusieurs fois sur une même
  // page (buildCombinedClassesPage). `cellFor(d, s)` doit renvoyer le même
  // format de descripteur que cellDescriptor/profCellData : null,
  // {top,bottom,pinned?}, ou {alt:true, weekA, weekB}.
  drawScheduleBlock(page, x, yTop, w, h, title, cellFor, opts = {}) {
    const { titleSize = 15, cellSize, titleGapBefore = false } = opts;
    const titleAreaH = 32;
    // Par défaut le titre colle au haut du bloc et l'espace se trouve entre
    // lui et le tableau (buildScheduleTablePage : rien au-dessus du titre).
    // `titleGapBefore` inverse ça — utile quand plusieurs blocs sont
    // empilés (buildCombinedClassesPage) : l'espace doit séparer le tableau
    // du bloc précédent du titre suivant, pas le titre de son propre
    // tableau, sous peine de gâcher de la hauteur inutilement.
    const titleY = titleGapBefore ? yTop + titleAreaH - 8 : yTop + 12;
    page.text(x, titleY, title, { font: 'bold', size: titleSize });

    const { days, slots } = this.state.config;
    const activeDays = this.activeDayIndices();
    const openSlots = this.state.config.openSlots || [];

    const tableTop = yTop + titleAreaH;
    const labelW = 58;
    const dayW = (w - labelW) / activeDays.length;
    const headerH = 20;
    const breaksAfter = computeBreaksAfter(slots);
    const maxBodyH = h - titleAreaH - headerH - breaksAfter.size * BREAK_ROW_H;
    const rowH = Math.min(42, maxBodyH / slots.length);

    page.rect(x, tableTop, labelW, headerH, { fill: '#e8e8e8', stroke: '#000000' });
    activeDays.forEach((di, i) => {
      const cx = x + labelW + i * dayW;
      page.rect(cx, tableTop, dayW, headerH, { fill: '#e8e8e8', stroke: '#000000' });
      page.centerText(cx, tableTop, dayW, headerH, days[di].toUpperCase(), { font: 'bold', size: 9 });
    });

    let cy = tableTop + headerH;
    slots.forEach((sl, si) => {
      page.rect(x, cy, labelW, rowH, { fill: '#f5f5f5', stroke: '#000000' });
      page.centerText(x, cy, labelW, rowH, `${sl.start}-${sl.end}`, { size: 7.5, color: '#333333' });

      activeDays.forEach((di, i) => {
        const cx = x + labelW + i * dayW;
        const open = (openSlots[di] || [])[si] !== false;
        const c = cellFor(di, si);
        if (c?.alt) {
          page.rect(cx, cy, dayW, rowH, { fill: '#ffffff', stroke: '#000000' });
          const halfW = dayW / 2;
          [['A', c.weekA, cx], ['B', c.weekB, cx + halfW]].forEach(([tag, box, bx]) => {
            page.text(bx + 3, cy + 8, tag, { size: 6, color: '#888888' });
            if (box) page.twoLineText(bx, cy + 6, halfW, rowH - 6, box.top, box.bottom, { size1: cellSize ?? 9.5, size2: (cellSize ?? 9.5) - 1, minSize: 4.5 });
          });
          page.line(cx + halfW, cy, cx + halfW, cy + rowH, { stroke: '#999999', lineWidth: 0.5 });
        } else if (c) {
          page.rect(cx, cy, dayW, rowH, { fill: '#ffffff', stroke: '#000000' });
          page.twoLineText(cx, cy, dayW, rowH, c.top, c.bottom, cellSize ? { size1: cellSize, size2: cellSize - 1 } : {});
        } else {
          page.rect(cx, cy, dayW, rowH, { fill: open ? '#ffffff' : '#e2e2e2', stroke: '#000000' });
        }
      });

      cy += rowH;
      if (breaksAfter.has(si)) {
        const fullW = labelW + activeDays.length * dayW;
        page.rect(x, cy, fullW, BREAK_ROW_H, { fill: '#eeeeee', stroke: '#000000' });
        page.centerText(x, cy, fullW, BREAK_ROW_H, `Pause déjeuner  ·  ${sl.end}–${slots[si + 1].start}`, { font: 'bold', size: 7.5, color: '#666666' });
        cy += BREAK_ROW_H;
      }
    });
  },

  // Dessine une page A4 paysage : titre + tableau plein page.
  buildScheduleTablePage(doc, title, cellFor) {
    const page = doc.addPage(PAGE_W, PAGE_H);
    this.drawScheduleBlock(page, MARGIN, MARGIN, PAGE_W - MARGIN * 2, PAGE_H - MARGIN * 2, title, cellFor);
  },

  // Page A3 portrait unique empilant les tableaux de `classes` les uns sous
  // les autres (au lieu d'une page A4 par classe) — pensée pour un
  // affichage/impression unique montrant toutes les classes d'un coup
  // (typiquement 6e/5e/4e/3e), chaque classe gardant son propre tableau
  // complet plutôt que d'être fusionnée avec les autres dans des colonnes.
  buildCombinedClassesPage(doc, classes, schedule) {
    const page = doc.addPage(A3_PORTRAIT_W, A3_PORTRAIT_H);
    const innerW = A3_PORTRAIT_W - MARGIN * 2;
    const innerH = A3_PORTRAIT_H - MARGIN * 2;
    const blockH = innerH / classes.length;
    classes.forEach((cls, i) => {
      const yTop = MARGIN + i * blockH;
      this.drawScheduleBlock(
        page, MARGIN, yTop, innerW, blockH, 'Classe ' + cls,
        (d, s) => this.cellDescriptor(schedule[`${cls}|${d}|${s}`]),
        { titleSize: 13, cellSize: 9, titleGapBefore: i > 0 }
      );
    });
  },

  captureSafeFilename(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'sans-nom';
  },

  async exportCapturesZip() {
    const status = document.getElementById('solver-status');
    const schedule = this.state.schedule || this.lastPartial?.schedule;
    if (!schedule || Object.keys(schedule).length === 0) {
      status.className = 'status err';
      status.textContent = 'Rien à exporter : génère (ou répare) un emploi du temps d\'abord.';
      return;
    }
    const btn = document.getElementById('export-captures-btn');
    btn.disabled = true;
    status.className = 'status';
    status.textContent = 'Génération des captures…';

    try {
      const files = [];

      const generalDoc = new PDFDoc.Doc();
      this.buildCombinedClassesPage(generalDoc, this.state.config.classes, schedule);
      this.state.config.classes.forEach(cls => {
        this.buildScheduleTablePage(generalDoc, 'Classe ' + cls, (d, s) => this.cellDescriptor(schedule[`${cls}|${d}|${s}`]));
      });
      this.meetingsWithoutClass().forEach(m => {
        const pseudoKey = `@meeting:${m.id}`;
        this.buildScheduleTablePage(generalDoc, 'Réunion — ' + m.name, (d, s) => this.cellDescriptor(schedule[`${pseudoKey}|${d}|${s}`]));
      });
      files.push({ name: 'general.pdf', data: generalDoc.build() });

      this.state.profs.forEach(prof => {
        const doc = new PDFDoc.Doc();
        this.buildScheduleTablePage(doc, 'Prof ' + prof.name, (d, s) => this.profCellData(prof.id, d, s, schedule).descriptor);
        files.push({ name: `prof-${this.captureSafeFilename(prof.name)}.pdf`, data: doc.build() });
      });

      const zipBlob = Zip.build(files);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(zipBlob);
      a.download = `captures-emploi-du-temps-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);

      status.className = 'status ok';
      status.textContent = `Zip exporté : 1 PDF général + ${this.state.profs.length} PDF prof.`;
    } catch (err) {
      status.className = 'status err';
      status.textContent = 'Échec de l\'export des captures : ' + (err?.message || err);
    } finally {
      btn.disabled = false;
    }
  },
});
