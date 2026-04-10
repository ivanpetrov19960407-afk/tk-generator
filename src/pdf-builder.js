'use strict';

const PDFDocument = require('pdfkit');
const { applyDefaultFonts, cleanMarkdown, ensureSpace, addHeaderFooter, drawTable } = require('./pdf-utils');

function sectionHeading(doc, title, fonts) {
  ensureSpace(doc, 30);
  doc.font(fonts.bold).fontSize(12.5).text(title, { align: 'left' });
  doc.moveDown(0.25);
}

function sectionText(doc, text, fonts) {
  const cleaned = cleanMarkdown(text || '');
  if (!cleaned) {
    doc.font(fonts.regular).fontSize(10).text('—');
    doc.moveDown(0.35);
    return;
  }

  doc.font(fonts.regular).fontSize(10).text(cleaned, { align: 'left' });
  doc.moveDown(0.45);
}

async function buildPdfBuffer({ titlePageText, sections, operations, mkHeaderText, mkRows, product, warnings }, options = {}) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 55, left: 40, right: 40, bottom: 42 },
    bufferPages: true
  });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  const fonts = applyDefaultFonts(doc, options);
  const safeSections = sections || {};

  doc.font(fonts.bold).fontSize(16).text(cleanMarkdown(titlePageText || ''), { align: 'left' });
  doc.moveDown(0.6);

  for (let num = 1; num <= 5; num += 1) {
    sectionHeading(doc, `Раздел ${num}`, fonts);
    sectionText(doc, safeSections[String(num)], fonts);
  }

  sectionHeading(doc, 'Раздел 6. Технологические операции', fonts);
  for (const op of operations || []) {
    if (op.isNotApplicable) continue;
    ensureSpace(doc, 56);
    doc.font(fonts.bold).fontSize(10.2).text(`Операция №${op.number}. ${cleanMarkdown(op.title || '').toUpperCase()}`);
    doc.font(fonts.regular).fontSize(9.5).text(cleanMarkdown(op.text || ''), { align: 'left' });
    doc.moveDown(0.35);
  }

  for (let num = 7; num <= 11; num += 1) {
    sectionHeading(doc, `Раздел ${num}`, fonts);
    sectionText(doc, safeSections[String(num)], fonts);
  }

  sectionHeading(doc, 'Раздел 12. Маршрутная карта', fonts);
  sectionText(doc, mkHeaderText, fonts);

  drawTable(doc, {
    fonts,
    columns: [
      { key: 'num', width: 24 },
      { key: 'name', width: 138 },
      { key: 'equipment', width: 98 },
      { key: 'executor', width: 88 },
      { key: 'control', width: 88 },
      { key: 'notes', width: 79 }
    ],
    header: ['№', 'Операция', 'Оборудование', 'Исполнитель', 'Контроль', 'Примечание'],
    rows: mkRows || []
  });

  sectionHeading(doc, 'Раздел 13. Предупреждения и примечания', fonts);
  const cleanWarnings = (warnings || []).map((w) => cleanMarkdown(w)).filter(Boolean);
  if (!cleanWarnings.length) {
    sectionText(doc, safeSections['13'] || 'Замечаний нет.', fonts);
  } else {
    for (const warning of cleanWarnings) {
      ensureSpace(doc, 24);
      doc.font(fonts.regular).fontSize(10).text(`• ${warning}`);
    }
    doc.moveDown(0.35);
  }

  addHeaderFooter(doc, {
    getHeaderText: () => `${cleanMarkdown(product && product.name)}${product && product.material && product.material.name ? ` • ${cleanMarkdown(product.material.name)}` : ''}`
  });

  const endPromise = new Promise((resolve) => doc.on('end', resolve));
  doc.end();
  await endPromise;
  return Buffer.concat(chunks);
}

module.exports = { buildPdfBuffer };
