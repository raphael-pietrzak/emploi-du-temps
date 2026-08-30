// pdf.js — écrivain PDF minimal (texte + rectangles/lignes vectoriels, polices
// standard Helvetica/Helvetica-Bold non embarquées), pour produire des captures
// imprimables sans dépendance externe (le projet n'a ni npm ni bundler — voir
// CLAUDE.md). Ne couvre que ce dont l'app a besoin : des pages A4 avec un
// tableau texte + traits, pas un moteur PDF général.
//
// Tout le document est construit comme une seule chaîne JS où chaque
// caractère représente EXACTEMENT un octet (0-255, encodage WinAnsi/CP1252
// pour le texte — voir encodeText) : ça évite de jongler entre offsets en
// caractères et offsets en octets pour la table xref, au prix de ne pouvoir
// représenter que du Latin-1 étendu dans le texte (largement suffisant pour
// du français : les lettres accentuées usuelles ont le même code point que
// leur octet CP1252).

const PDFDoc = (() => {
  // Largeurs de glyphe approximatives (1/1000 em), style Helvetica — pas les
  // vraies métriques AFM (ça demanderait d'embarquer une table complète pour
  // un gain surtout cosmétique) : suffisant pour centrer du texte sans
  // chevauchement dans une cellule de tableau.
  function charWidth(ch, bold) {
    if (ch === ' ') return 278;
    if ('iIl\'.,:;|!'.includes(ch)) return bold ? 278 : 222;
    if (/[A-Z]/.test(ch)) return bold ? 722 : 667;
    if (/[0-9]/.test(ch)) return 556;
    if ('mMW'.includes(ch)) return 833;
    if (/[a-z]/.test(ch)) return bold ? 600 : 500;
    return bold ? 600 : 500;
  }
  function textWidth(str, size, bold = false) {
    let w = 0;
    for (const ch of str) w += charWidth(ch, bold);
    return (w / 1000) * size;
  }

  // Unicode -> code CP1252/WinAnsi (identique à Latin-1 pour les lettres
  // accentuées françaises usuelles ; quelques exceptions au-delà de 0xFF).
  const SPECIAL = { 'Œ': 0x8C, 'œ': 0x9C, 'Ÿ': 0x9F, '’': 0x92, '‘': 0x91, '“': 0x93, '”': 0x94, '–': 0x96, '—': 0x97, '…': 0x85 };
  function encodeText(str) {
    let out = '';
    for (const ch of String(str)) {
      let code = ch.codePointAt(0);
      if (code > 255) code = SPECIAL[ch] !== undefined ? SPECIAL[ch] : 0x3F;
      let c = String.fromCharCode(code);
      if (c === '\\' || c === '(' || c === ')') c = '\\' + c;
      out += c;
    }
    return out;
  }

  function hexColor(hex) {
    const r = (parseInt(hex.slice(1, 3), 16) / 255).toFixed(3);
    const g = (parseInt(hex.slice(3, 5), 16) / 255).toFixed(3);
    const b = (parseInt(hex.slice(5, 7), 16) / 255).toFixed(3);
    return `${r} ${g} ${b}`;
  }

  class Page {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.ops = [];
    }
    _y(yTop) { return this.height - yTop; }

    rect(x, yTop, w, h, { fill, stroke, lineWidth = 0.75 } = {}) {
      const y = this._y(yTop) - h;
      if (fill) this.ops.push(`${hexColor(fill)} rg`);
      if (stroke) { this.ops.push(`${hexColor(stroke)} RG`); this.ops.push(`${lineWidth} w`); }
      this.ops.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`);
      if (fill && stroke) this.ops.push('B');
      else if (fill) this.ops.push('f');
      else if (stroke) this.ops.push('S');
    }

    line(x1, yTop1, x2, yTop2, { stroke = '#000000', lineWidth = 0.75 } = {}) {
      this.ops.push(`${hexColor(stroke)} RG`);
      this.ops.push(`${lineWidth} w`);
      this.ops.push(`${x1.toFixed(2)} ${this._y(yTop1).toFixed(2)} m ${x2.toFixed(2)} ${this._y(yTop2).toFixed(2)} l S`);
    }

    // x, yTop ici = position de la LIGNE DE BASE du texte, mesurée depuis le
    // haut de la page (pas le haut de la boîte de texte) — centerText et
    // twoLineText font la conversion pour l'appelant.
    text(x, yTop, str, { font = 'regular', size = 10, color = '#000000' } = {}) {
      const fontKey = font === 'bold' ? 'F2' : 'F1';
      this.ops.push(`${hexColor(color)} rg`);
      this.ops.push(`BT /${fontKey} ${size} Tf ${x.toFixed(2)} ${this._y(yTop).toFixed(2)} Td (${encodeText(str)}) Tj ET`);
    }

    centerText(x, yTop, w, h, str, { font = 'regular', size = 9, color = '#000000', minSize = 5 } = {}) {
      const bold = font === 'bold';
      let sz = size;
      while (sz > minSize && textWidth(str, sz, bold) > w - 4) sz -= 0.5;
      const tw = textWidth(str, sz, bold);
      this.text(x + (w - tw) / 2, yTop + h / 2 + sz * 0.32, str, { font, size: sz, color });
    }

    // Deux lignes centrées comme un bloc, chacune éventuellement dans son
    // propre style (utilisé pour "matière" en gras + "prof" en plus discret).
    twoLineText(x, yTop, w, h, line1, line2, opts = {}) {
      const { size1 = 8.5, size2 = 7.5, bold1 = true, color1 = '#000000', color2 = '#444444', minSize = 5 } = opts;
      let s1 = size1;
      while (s1 > minSize && textWidth(line1, s1, bold1) > w - 4) s1 -= 0.5;
      let s2 = line2 ? size2 : 0;
      while (s2 > minSize && textWidth(line2, s2, false) > w - 4) s2 -= 0.5;
      const lh1 = s1 * 1.15, lh2 = line2 ? s2 * 1.15 : 0;
      const blockH = lh1 + lh2;
      let ty = yTop + (h - blockH) / 2 + s1 * 0.8;
      const w1 = textWidth(line1, s1, bold1);
      this.text(x + (w - w1) / 2, ty, line1, { font: bold1 ? 'bold' : 'regular', size: s1, color: color1 });
      if (line2) {
        ty += lh1;
        const w2 = textWidth(line2, s2, false);
        this.text(x + (w - w2) / 2, ty, line2, { font: 'regular', size: s2, color: color2 });
      }
    }
  }

  class Doc {
    constructor() {
      // objects[i] = contenu de l'objet PDF numéro i+1 ; 0 et 1 (Catalog,
      // Pages) sont remplis au tout dernier moment dans build(), une fois
      // qu'on connaît la liste complète des pages.
      this.objects = [null, null];
      this.pageObjNums = [];
      this._openPages = [];
      this.fontHelvNum = this._addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
      this.fontBoldNum = this._addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    }
    _addObj(content) { this.objects.push(content); return this.objects.length; }

    addPage(width, height) {
      const contentObjNum = this._addObj('');
      const pageObjNum = this._addObj('');
      const page = new Page(width, height);
      page._contentObjNum = contentObjNum;
      page._pageObjNum = pageObjNum;
      this.pageObjNums.push(pageObjNum);
      this._openPages.push(page);
      return page;
    }

    _finalizePage(page) {
      const content = page.ops.join('\n');
      this.objects[page._contentObjNum - 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
      this.objects[page._pageObjNum - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] `
        + `/Resources << /Font << /F1 ${this.fontHelvNum} 0 R /F2 ${this.fontBoldNum} 0 R >> >> /Contents ${page._contentObjNum} 0 R >>`;
    }

    // -> Uint8Array (contenu binaire du fichier .pdf)
    build() {
      this._openPages.forEach(p => this._finalizePage(p));
      this.objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
      this.objects[1] = `<< /Type /Pages /Kids [${this.pageObjNums.map(n => n + ' 0 R').join(' ')}] /Count ${this.pageObjNums.length} >>`;

      let out = '%PDF-1.4\n%' + String.fromCharCode(0xE2, 0xE3, 0xCF, 0xD3) + '\n';
      const offsets = [];
      this.objects.forEach((content, i) => {
        offsets.push(out.length);
        out += `${i + 1} 0 obj\n${content}\nendobj\n`;
      });
      const xrefStart = out.length;
      out += `xref\n0 ${this.objects.length + 1}\n`;
      out += '0000000000 65535 f \n';
      offsets.forEach(off => { out += `${String(off).padStart(10, '0')} 00000 n \n`; });
      out += `trailer\n<< /Size ${this.objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

      const bytes = new Uint8Array(out.length);
      for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xFF;
      return bytes;
    }
  }

  return { Doc, textWidth, encodeText };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PDFDoc;
