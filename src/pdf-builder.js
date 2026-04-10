'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const DEFAULT_FONT_PATHS = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'
];

function resolveFontPath(customPath) {
  const candidates = [customPath, ...DEFAULT_FONT_PATHS].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function cleanMarkdown(text) {
  return String(text || '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/\{\.underline\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function buildPdfBuffer({ titlePageText, sections, operations, mkHeaderText, mkRows, product, warnings }, options = {}) {
  const fontPath = resolveFontPath(options.fontPath);
  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, left: 40, right: 40, bottom: 40 }, bufferPages: true });
  const chunks = [];

  doc.on('data', (c) => chunks.push(c));

  if (fontPath) doc.font(fontPath);
  doc.fontSize(14).text(cleanMarkdown(titlePageText || ''), { align: 'left' });
  doc.moveDown();

  ['1', '2', '3', '4', '5'].forEach((num) => {
    if (!sections[num]) return;
    doc.fontSize(13).text(`Раздел ${num}`, { underline: false });
    doc.fontSize(11).text(cleanMarkdown(sections[num]), { align: 'left' });
    doc.moveDown(0.5);
  });

  doc.addPage();
  doc.fontSize(13).text('Раздел 6. Технологические операции');
  (operations || []).forEach((op) => {
    if (op.isNotApplicable) return;
    doc.fontSize(11).text(`Операция №${op.number}. ${String(op.title || '').toUpperCase()}`);
    doc.fontSize(10).text(cleanMarkdown(op.text || ''), { align: 'left' });
    doc.moveDown(0.4);
  });

  ['7', '8', '9', '10', '11'].forEach((num) => {
    if (!sections[num]) return;
    doc.fontSize(13).text(`Раздел ${num}`);
    doc.fontSize(11).text(cleanMarkdown(sections[num]), { align: 'left' });
    doc.moveDown(0.5);
  });

  doc.addPage();
  doc.fontSize(13).text('Маршрутная карта');
  doc.fontSize(10).text(cleanMarkdown(mkHeaderText || ''), { align: 'left' });
  doc.moveDown(0.5);

  const cols = [25, 135, 110, 85, 95, 90];
  const headers = ['№', 'Операция', 'Оборудование', 'Исполнитель', 'Контроль', 'Примечание'];

  const drawRow = (row, isHeader = false) => {
    const y = doc.y;
    let x = doc.page.margins.left;
    const height = 24;
    row.forEach((cell, idx) => {
      doc.rect(x, y, cols[idx], height).stroke('#CCCCCC');
      doc.fontSize(isHeader ? 9.5 : 8.5).text(String(cell || ''), x + 2, y + 4, { width: cols[idx] - 4, height: height - 6 });
      x += cols[idx];
    });
    doc.y = y + height;
  };

  drawRow(headers, true);
  (mkRows || []).forEach((row) => drawRow([row.num, row.name, row.equipment, row.executor, row.control, row.notes]));

  if (warnings && warnings.length) {
    doc.addPage();
    doc.fontSize(13).text('Предупреждения');
    warnings.forEach((w) => doc.fontSize(10).text(`• ${cleanMarkdown(w)}`));
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).text(`Стр. ${i + 1} из ${range.count}`, 40, doc.page.height - 30, { align: 'center' });
    doc.fontSize(8).text(`${product.name || ''} — ${(product.material && product.material.name) || ''}`, 40, 20, { align: 'left' });
  }

  const endPromise = new Promise((resolve) => doc.on('end', resolve));
  doc.end();
  await endPromise;
  return Buffer.concat(chunks);
}

module.exports = { buildPdfBuffer, resolveFontPath };
