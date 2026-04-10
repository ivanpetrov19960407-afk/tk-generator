'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_FONT_DIR = path.resolve(__dirname, '..', 'assets', 'fonts');
const EXECUTABLE_FONT_DIR = path.resolve(path.dirname(process.execPath || ''), 'assets', 'fonts');

const FONT_CANDIDATES = {
  regular: [
    path.join(PROJECT_FONT_DIR, 'DejaVuSans.ttf'),
    path.join(PROJECT_FONT_DIR, 'PTSans-Regular.ttf'),
    path.join(EXECUTABLE_FONT_DIR, 'DejaVuSans.ttf'),
    path.join(EXECUTABLE_FONT_DIR, 'PTSans-Regular.ttf'),
    '/usr/share/fonts/truetype/pt-sans/PTSans-Regular.ttf',
    '/usr/share/fonts/truetype/paratype/PTSans-Regular.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
  ],
  bold: [
    path.join(PROJECT_FONT_DIR, 'DejaVuSans-Bold.ttf'),
    path.join(PROJECT_FONT_DIR, 'PTSans-Bold.ttf'),
    path.join(EXECUTABLE_FONT_DIR, 'DejaVuSans-Bold.ttf'),
    path.join(EXECUTABLE_FONT_DIR, 'PTSans-Bold.ttf'),
    '/usr/share/fonts/truetype/pt-sans/PTSans-Bold.ttf',
    '/usr/share/fonts/truetype/paratype/PTSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
  ]
};

function pickFirstExisting(paths) {
  for (const fontPath of paths) {
    if (fontPath && fs.existsSync(fontPath)) return fontPath;
  }
  return null;
}

function getFontPaths(custom = {}) {
  const regularCandidates = [custom.regular, ...FONT_CANDIDATES.regular].filter(Boolean);
  const boldCandidates = [custom.bold, ...FONT_CANDIDATES.bold].filter(Boolean);

  return {
    regular: pickFirstExisting(regularCandidates),
    bold: pickFirstExisting(boldCandidates)
  };
}

function applyDefaultFonts(doc, options = {}) {
  const fontPaths = getFontPaths(options.fonts || {});

  if (!fontPaths.regular) {
    throw new Error('Не найден TTF-шрифт для PDF. Ожидается assets/fonts/DejaVuSans.ttf или явный options.fonts.regular.');
  }

  doc.registerFont('TkRegular', fontPaths.regular);
  doc.font('TkRegular');

  if (fontPaths.bold) {
    doc.registerFont('TkBold', fontPaths.bold);
  } else {
    doc.registerFont('TkBold', fontPaths.regular);
  }

  return {
    regular: 'TkRegular',
    bold: 'TkBold',
    paths: fontPaths
  };
}

function cleanMarkdown(text) {
  return String(text || '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/\{\.underline\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function ensureSpace(doc, heightNeeded) {
  const bottomLimit = doc.page.height - doc.page.margins.bottom;
  if (doc.y + heightNeeded <= bottomLimit) return false;
  doc.addPage();
  return true;
}

function addHeaderFooter(doc, { getHeaderText }) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    const header = cleanMarkdown(getHeaderText(i) || '');
    if (header) {
      doc.fontSize(9).text(header, doc.page.margins.left, 24, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: 'left'
      });
    }

    doc
      .fontSize(8)
      .text(`Стр. ${i + 1} из ${range.count}`, doc.page.margins.left, doc.page.height - 28, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: 'center'
      });
  }
}

function drawTable(doc, { columns, header, rows, fonts, rowPadding = 4 }) {
  const measureRow = (cells, isHeader) => {
    doc.font(isHeader ? fonts.bold : fonts.regular).fontSize(isHeader ? 9.5 : 9);
    const heights = cells.map((cell, idx) => doc.heightOfString(cleanMarkdown(cell), {
      width: columns[idx].width - rowPadding * 2,
      align: 'left'
    }));
    return Math.max(...heights, 14) + rowPadding * 2;
  };

  const drawRow = (cells, y, isHeader) => {
    const rowHeight = measureRow(cells, isHeader);
    let x = doc.page.margins.left;

    cells.forEach((cell, idx) => {
      const width = columns[idx].width;
      doc.rect(x, y, width, rowHeight).lineWidth(0.6).stroke('#7F7F7F');
      doc
        .font(isHeader ? fonts.bold : fonts.regular)
        .fontSize(isHeader ? 9.5 : 9)
        .text(cleanMarkdown(cell), x + rowPadding, y + rowPadding, {
          width: width - rowPadding * 2,
          align: 'left'
        });
      x += width;
    });

    doc.y = y + rowHeight;
  };

  const drawHeader = () => drawRow(header, doc.y, true);

  drawHeader();

  for (const row of rows) {
    const rowCells = columns.map((column) => row[column.key] || '');
    const rowHeight = measureRow(rowCells, false);
    if (ensureSpace(doc, rowHeight + 4)) drawHeader();
    drawRow(rowCells, doc.y, false);
  }

  doc.moveDown(0.4);
  doc.x = doc.page.margins.left;
  doc.y = Math.max(doc.y, doc.page.margins.top + 8);
}

module.exports = {
  applyDefaultFonts,
  cleanMarkdown,
  ensureSpace,
  addHeaderFooter,
  drawTable,
  getFontPaths
};
