'use strict';

const { EventEmitter } = require('events');

function escapePdfText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

class PDFDocument extends EventEmitter {
  constructor(opts = {}) {
    super();
    const m = opts.margins || {};
    this.page = { width: 595.28, height: 841.89, margins: { left: m.left || 40, right: m.right || 40, top: m.top || 40, bottom: m.bottom || 40 } };
    this.pages = [{ lines: [] }];
    this.pageIndex = 0;
    this.currentFontSize = 11;
    this.y = this.page.margins.top;
    this.x = this.page.margins.left;
    this._rect = null;
  }
  on(event, cb) { return super.on(event, cb); }
  font() { return this; }
  fontSize(size) { this.currentFontSize = Number(size) || 11; return this; }
  text(text, x, y) {
    if (typeof x === 'number') this.x = x;
    if (typeof y === 'number') this.y = y;
    const page = this.pages[this.pageIndex];
    page.lines.push({ text: String(text || ''), x: this.x, y: this.y, size: this.currentFontSize });
    this.y += Math.max(12, this.currentFontSize + 2);
    return this;
  }
  moveDown(lines = 1) { this.y += 14 * lines; return this; }
  addPage() { this.pages.push({ lines: [] }); this.pageIndex = this.pages.length - 1; this.y = this.page.margins.top; return this; }
  rect(x, y, w, h) { this._rect = { x, y, w, h }; return this; }
  stroke() { if (this._rect) { this.pages[this.pageIndex].lines.push({ rect: this._rect }); this._rect = null; } return this; }
  bufferedPageRange() { return { start: 0, count: this.pages.length }; }
  switchToPage(i) { this.pageIndex = i; return this; }
  end() {
    const objects = [];
    const offsets = [0];
    let pdf = '%PDF-1.4\n';
    const addObj = (body) => { offsets.push(Buffer.byteLength(pdf, 'utf8')); pdf += `${objects.length + 1} 0 obj\n${body}\nendobj\n`; objects.push(1); return objects.length; };

    const fontObj = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const pageObjs = [];

    for (const p of this.pages) {
      let stream = 'BT\n';
      for (const line of p.lines) {
        if (line.rect) continue;
        const yy = this.page.height - line.y;
        stream += `/F1 ${line.size} Tf 1 0 0 1 ${line.x.toFixed(2)} ${yy.toFixed(2)} Tm (${escapePdfText(line.text)}) Tj\n`;
      }
      stream += 'ET\n';
      const contentObj = addObj(`<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}endstream`);
      const pageObj = addObj(`<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${this.page.width} ${this.page.height}] /Contents ${contentObj} 0 R /Resources << /Font << /F1 ${fontObj} 0 R >> >> >>`);
      pageObjs.push(pageObj);
    }

    const kids = pageObjs.map((n) => `${n} 0 R`).join(' ');
    const pagesObj = addObj(`<< /Type /Pages /Kids [${kids}] /Count ${pageObjs.length} >>`);
    pdf = pdf.replace('/Parent 0 0 R', `/Parent ${pagesObj} 0 R`);
    const catalogObj = addObj(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);

    const xrefOffset = Buffer.byteLength(pdf, 'utf8');
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObj} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    const buf = Buffer.from(pdf, 'utf8');
    this.emit('data', buf);
    this.emit('end');
  }
}

module.exports = PDFDocument;
