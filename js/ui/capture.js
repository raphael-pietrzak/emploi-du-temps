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
const MARGIN = 36;

Object.assign(UI, {
  bindCapture() {
    const btn = document.getElementById('export-captures-btn');
    if (!btn) return;
    btn.addEventListener('click', () => this.exportCapturesZip());
  },

  // Dessine une page A4 paysage : titre + tableau (créneaux en lignes, jours
  // actifs en colonnes). `cellFor(d, s)` doit renvoyer le même format de
  // descripteur que cellDescriptor/profCellData : null, {top,bottom,pinned?},
  // ou {alt:true, weekA, weekB}.
  buildScheduleTablePage(doc, title, cellFor) {
    const page = doc.addPage(PAGE_W, PAGE_H);
    page.text(MARGIN, MARGIN + 12, title, { font: 'bold', size: 15 });

    const { days, slots } = this.state.config;
    const activeDays = this.activeDayIndices();
    const openSlots = this.state.config.openSlots || [];

    const tableTop = MARGIN + 32;
    const labelW = 58;
    const tableW = PAGE_W - MARGIN * 2;
    const dayW = (tableW - labelW) / activeDays.length;
    const headerH = 20;
    const maxBodyH = PAGE_H - MARGIN - tableTop - headerH;
    const rowH = Math.min(42, maxBodyH / slots.length);

    page.rect(MARGIN, tableTop, labelW, headerH, { fill: '#e8e8e8', stroke: '#000000' });
    activeDays.forEach((di, i) => {
      const x = MARGIN + labelW + i * dayW;
      page.rect(x, tableTop, dayW, headerH, { fill: '#e8e8e8', stroke: '#000000' });
      page.centerText(x, tableTop, dayW, headerH, days[di].toUpperCase(), { font: 'bold', size: 9 });
    });

    slots.forEach((sl, si) => {
      const y = tableTop + headerH + si * rowH;
      page.rect(MARGIN, y, labelW, rowH, { fill: '#f5f5f5', stroke: '#000000' });
      page.centerText(MARGIN, y, labelW, rowH, `${sl.start}-${sl.end}`, { size: 7.5, color: '#333333' });

      activeDays.forEach((di, i) => {
        const x = MARGIN + labelW + i * dayW;
        const open = (openSlots[di] || [])[si] !== false;
        const c = cellFor(di, si);
        if (c?.alt) {
          page.rect(x, y, dayW, rowH, { fill: '#ffffff', stroke: '#000000' });
          const halfW = dayW / 2;
          [['A', c.weekA, x], ['B', c.weekB, x + halfW]].forEach(([tag, box, bx]) => {
            page.text(bx + 3, y + 8, tag, { size: 6, color: '#888888' });
            if (box) page.twoLineText(bx, y + 6, halfW, rowH - 6, box.top, box.bottom, { size1: 7, size2: 6, minSize: 4.5 });
          });
          page.line(x + halfW, y, x + halfW, y + rowH, { stroke: '#999999', lineWidth: 0.5 });
        } else if (c) {
          page.rect(x, y, dayW, rowH, { fill: '#ffffff', stroke: '#000000' });
          page.twoLineText(x, y, dayW, rowH, c.top, c.bottom);
        } else {
          page.rect(x, y, dayW, rowH, { fill: open ? '#ffffff' : '#e2e2e2', stroke: '#000000' });
        }
      });
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
