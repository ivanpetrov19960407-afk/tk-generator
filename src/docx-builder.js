/**
 * docx-builder.js — DOCX formatting utilities
 * Converts parametrized text into docx Document objects using the `docx` npm module.
 * 
 * Formatting rules:
 * - Font: Times New Roman, 12pt body (size: 24 half-pts), 14pt bold headings (size: 28)
 * - A4 page, margins 20mm all sides (567 DXA = 20mm)
 * - Header: italic, product name + material
 * - Footer: page numbers "Стр. X из Y"
 * - Section headings: bold, 14pt
 * - Operation headings: bold, 12pt, ALL CAPS
 * - Body: justified alignment, 1.15 line spacing
 * - No bullet lists — all narrative text paragraphs
 */

const docx = require('docx');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, PageNumber, PageBreak,
  BorderStyle, WidthType, ShadingType, VerticalAlign,
  HeadingLevel, LineRuleType
} = docx;

// Constants
const FONT = 'Times New Roman';
const BODY_SIZE = 24;       // 12pt in half-points
const HEADING_SIZE = 28;    // 14pt in half-points
const SMALL_SIZE = 20;      // 10pt for headers/footers
const MARGIN_20MM = 1134;   // 20mm in DXA (1mm = 56.7 DXA)
const LINE_SPACING_115 = 276; // 1.15 * 240 = 276

// Page width for tables: A4 width (11906) - 2 × margin (1134) = 9638 DXA
const TABLE_WIDTH = 9638;

/**
 * Parse markdown-formatted text into an array of TextRun objects.
 * Handles: **bold**, *italic*, ---→—, \\~ → ~, {.underline} removal
 */
function parseMarkdownToRuns(text) {
  if (!text) return [new TextRun({ text: '', font: FONT, size: BODY_SIZE })];
  
  // Pre-process: clean artifacts
  text = text.replace(/\{\.underline\}/g, '');
  text = text.replace(/\]\{/g, '');  // leftover pandoc
  text = text.replace(/\\~/g, '~');
  text = text.replace(/\\--/g, '—');
  text = text.replace(/ --- /g, ' — ');
  text = text.replace(/---/g, '—');
  text = text.replace(/ -- /g, ' — ');
  text = text.replace(/--/g, '—');
  // Clean escaped pipes
  text = text.replace(/\\\|/g, '|');
  
  const runs = [];
  let remaining = text;
  
  while (remaining.length > 0) {
    // Find the next markdown marker
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const italicMatch = remaining.match(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/);
    
    let nextMatch = null;
    let matchType = null;
    
    if (boldMatch && (!italicMatch || boldMatch.index <= italicMatch.index)) {
      nextMatch = boldMatch;
      matchType = 'bold';
    } else if (italicMatch) {
      nextMatch = italicMatch;
      matchType = 'italic';
    }
    
    if (nextMatch) {
      // Add text before the match
      if (nextMatch.index > 0) {
        const beforeText = remaining.substring(0, nextMatch.index);
        if (beforeText) {
          runs.push(new TextRun({ text: beforeText, font: FONT, size: BODY_SIZE }));
        }
      }
      
      // Add the formatted text
      const matchedText = nextMatch[1];
      if (matchType === 'bold') {
        runs.push(new TextRun({ text: matchedText, font: FONT, size: BODY_SIZE, bold: true }));
      } else {
        runs.push(new TextRun({ text: matchedText, font: FONT, size: BODY_SIZE, italics: true }));
      }
      
      remaining = remaining.substring(nextMatch.index + nextMatch[0].length);
    } else {
      // No more markers — add the rest
      runs.push(new TextRun({ text: remaining, font: FONT, size: BODY_SIZE }));
      remaining = '';
    }
  }
  
  if (runs.length === 0) {
    runs.push(new TextRun({ text: '', font: FONT, size: BODY_SIZE }));
  }
  
  return runs;
}

/**
 * Convert a block of text (potentially multi-paragraph) into Paragraph objects.
 * Handles:
 * - Empty lines → paragraph breaks
 * - Lines starting with "> " → blockquote-style paragraphs (indented)
 * - Lines starting with "##" → section headings
 * - Regular lines → justified body paragraphs
 */
function textToParagraphs(text) {
  if (!text) return [];
  
  const lines = text.split('\n');
  const paragraphs = [];
  let currentParagraph = [];
  let currentBlockquote = [];
  let inBlockquote = false;
  
  function flushParagraph() {
    if (currentParagraph.length > 0) {
      paragraphs.push(makeBodyParagraph(currentParagraph.join(' ')));
      currentParagraph = [];
    }
  }
  
  function flushBlockquote() {
    if (currentBlockquote.length > 0) {
      const fullText = currentBlockquote.join(' ');
      if (fullText.trim() && fullText.trim() !== '---' && fullText.trim() !== '—') {
        paragraphs.push(makeBlockquoteParagraph(fullText));
      }
      currentBlockquote = [];
    }
    inBlockquote = false;
  }
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Empty line — flush current paragraph and add spacing
    if (trimmed === '') {
      flushParagraph();
      flushBlockquote();
      continue;
    }
    
    // Section heading (## or bold heading pattern)
    if (trimmed.startsWith('## ') || trimmed.startsWith('### ')) {
      flushParagraph();
      flushBlockquote();
      const headingText = trimmed.replace(/^#+\s*/, '').replace(/\*\*/g, '');
      paragraphs.push(makeSectionHeading(headingText));
      continue;
    }
    
    // Blockquote line ("> ") — may be multi-line continuation
    if (trimmed.startsWith('> ') || trimmed === '>') {
      flushParagraph();
      const quoteText = trimmed.replace(/^>\s?/, '').trim();
      
      // Empty blockquote line — separate blockquote paragraphs
      if (quoteText === '' || quoteText === '---' || quoteText === '—') {
        flushBlockquote();
        continue;
      }
      
      // Check if this starts a new blockquote paragraph (begins with "--- ")
      if (quoteText.startsWith('--- ') || quoteText.startsWith('— ')) {
        flushBlockquote();
      }
      
      currentBlockquote.push(quoteText);
      inBlockquote = true;
      continue;
    }
    
    // Non-blockquote line — flush any pending blockquote
    if (inBlockquote) {
      flushBlockquote();
    }
    
    // Regular line — accumulate into current paragraph
    currentParagraph.push(trimmed);
  }
  
  // Flush remaining
  flushParagraph();
  flushBlockquote();
  
  return paragraphs;
}

/**
 * Create a body text paragraph (justified, 12pt, 1.15 line spacing)
 */
function makeBodyParagraph(text) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 120, line: LINE_SPACING_115, lineRule: LineRuleType.AUTO },
    children: parseMarkdownToRuns(text)
  });
}

/**
 * Create a blockquote paragraph (indented, for route lists and equipment lists)
 */
function makeBlockquoteParagraph(text) {
  // Clean the text
  text = text.replace(/^---\s*/, '— ');
  
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 60, line: LINE_SPACING_115, lineRule: LineRuleType.AUTO },
    indent: { left: 567 }, // ~10mm left indent
    children: parseMarkdownToRuns(text)
  });
}

/**
 * Create a section heading paragraph (14pt, bold)
 */
function makeSectionHeading(text) {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: 240, after: 120, line: LINE_SPACING_115, lineRule: LineRuleType.AUTO },
    children: [
      new TextRun({ text: text, font: FONT, size: HEADING_SIZE, bold: true })
    ]
  });
}

/**
 * Create an operation heading paragraph (12pt, bold, ALL CAPS)
 */
function makeOperationHeading(text) {
  // Ensure it's uppercase
  const upperText = text.toUpperCase();
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: 240, after: 120, line: LINE_SPACING_115, lineRule: LineRuleType.AUTO },
    children: [
      new TextRun({ text: upperText, font: FONT, size: BODY_SIZE, bold: true })
    ]
  });
}

/**
 * Create the title page paragraphs
 */
function buildTitlePageParagraphs(titleText) {
  const lines = titleText.split('\n');
  const paragraphs = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed === '') {
      paragraphs.push(new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: '', font: FONT, size: BODY_SIZE })]
      }));
      continue;
    }
    
    // Bold lines
    if (trimmed === 'ТЕХНОЛОГИЧЕСКАЯ КАРТА' || trimmed === 'МАРШРУТНАЯ КАРТА') {
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: [new TextRun({ text: trimmed, font: FONT, size: 32, bold: true })]
      }));
      continue;
    }
    
    if (trimmed === 'УТВЕРЖДАЮ') {
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { after: 120 },
        children: [new TextRun({ text: trimmed, font: FONT, size: BODY_SIZE, bold: true })]
      }));
      continue;
    }
    
    // Product name line (contains dimensions like ×)
    if (trimmed.includes('×') && !trimmed.startsWith('Дата') && !trimmed.startsWith('Разработано') && !trimmed.startsWith('Проверено')) {
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: [new TextRun({ text: trimmed, font: FONT, size: HEADING_SIZE, bold: true })]
      }));
      continue;
    }
    
    // Material line (Мрамор, Гранит, etc.)
    if (/^(Мрамор|Гранит|Известняк|Травертин|Оникс|Песчаник|Сланец)\s/.test(trimmed)) {
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: [new TextRun({ text: trimmed, font: FONT, size: HEADING_SIZE, bold: true })]
      }));
      continue;
    }
    
    // "производства изделия из натурального камня"
    if (trimmed.includes('производства изделия')) {
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: [new TextRun({ text: trimmed, font: FONT, size: BODY_SIZE })]
      }));
      continue;
    }
    
    // Center alignment for descriptive lines
    if (trimmed.startsWith('Лощение') || trimmed.startsWith('Рельефная') || trimmed.startsWith('Бучардирование') ||
        trimmed.startsWith('Архитектурное') || trimmed.startsWith('Объём партии')) {
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: [new TextRun({ text: trimmed, font: FONT, size: BODY_SIZE })]
      }));
      continue;
    }
    
    // Signature lines
    if (trimmed.startsWith('Директор производства') || trimmed.startsWith('Разработано') || 
        trimmed.startsWith('Проверено') || trimmed.startsWith('«')) {
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 60 },
        children: [new TextRun({ text: trimmed, font: FONT, size: BODY_SIZE })]
      }));
      continue;
    }
    
    // Date line
    if (trimmed.startsWith('Дата')) {
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 120, after: 60 },
        children: [new TextRun({ text: trimmed, font: FONT, size: BODY_SIZE })]
      }));
      continue;
    }
    
    // Default center
    paragraphs.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [new TextRun({ text: trimmed, font: FONT, size: BODY_SIZE })]
    }));
  }
  
  return paragraphs;
}

/**
 * Build the MK table as a docx Table object
 */
function buildMKTable(rows) {
  const thinBorder = { style: BorderStyle.SINGLE, size: 1, color: '000000' };
  const allBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
  
  // Column widths: №(600), Наименование(2200), Оборудование(1600), Исполнитель(1800), Контроль(1800), Примечания(1638)
  const colWidths = [600, 2200, 1600, 1800, 1800, 1638];
  
  // Header row
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      makeCell('№', colWidths[0], allBorders, true),
      makeCell('Наименование операции', colWidths[1], allBorders, true),
      makeCell('Оборудование', colWidths[2], allBorders, true),
      makeCell('Исполнитель', colWidths[3], allBorders, true),
      makeCell('Контроль', colWidths[4], allBorders, true),
      makeCell('Примечания', colWidths[5], allBorders, true)
    ]
  });
  
  // Data rows
  const dataRows = rows.map(row => {
    return new TableRow({
      children: [
        makeCell(String(row.num), colWidths[0], allBorders, true),
        makeCell(row.name, colWidths[1], allBorders, false),
        makeCell(row.equipment, colWidths[2], allBorders, false),
        makeCell(row.executor, colWidths[3], allBorders, false),
        makeCell(row.control, colWidths[4], allBorders, false),
        makeCell(row.notes, colWidths[5], allBorders, false)
      ]
    });
  });
  
  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headerRow, ...dataRows]
  });
}

/**
 * Helper to create a table cell
 */
function makeCell(text, width, borders, bold) {
  const cellSize = 18; // 9pt for table cells (half-points)
  return new TableCell({
    borders: borders,
    width: { size: width, type: WidthType.DXA },
    margins: { top: 40, bottom: 40, left: 60, right: 60 },
    children: [
      new Paragraph({
        spacing: { after: 0, line: 240, lineRule: LineRuleType.AUTO },
        children: [new TextRun({ text: text, font: FONT, size: cellSize, bold: bold })]
      })
    ]
  });
}

/**
 * Assemble the complete document
 * @param {Object} params
 * @param {string} params.titlePageText
 * @param {Object} params.sections - { "1": text, "2": text, ... }
 * @param {Array} params.operations - [{ number, title, text }]
 * @param {string} params.mkHeaderText
 * @param {Array} params.mkRows
 * @param {Object} params.product
 * @param {Array} params.warnings
 * @returns {Document}
 */
function assembleDocument({ titlePageText, sections, operations, mkHeaderText, mkRows, product, warnings }) {
  const allChildren = [];
  
  // --- Title Page ---
  const titleParagraphs = buildTitlePageParagraphs(titlePageText);
  allChildren.push(...titleParagraphs);
  allChildren.push(new Paragraph({ children: [new PageBreak()] }));
  
  // --- Sections 1-5 ---
  for (const num of ['1', '2', '3', '4', '5']) {
    if (sections[num]) {
      const sectionParas = textToParagraphs(sections[num]);
      allChildren.push(...sectionParas);
      allChildren.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
    }
  }
  allChildren.push(new Paragraph({ children: [new PageBreak()] }));
  
  // --- Section 6: Detailed Operations ---
  allChildren.push(makeSectionHeading('Раздел 6. Детальное описание операций'));
  allChildren.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
  
  for (const op of operations) {
    // Operation heading
    const headingText = `ОПЕРАЦИЯ №${op.number}. ${op.title.toUpperCase()}`;
    allChildren.push(makeOperationHeading(headingText));
    
    // Operation body text — strip the first line if it repeats the operation title
    let bodyText = op.text;
    const firstLineEnd = bodyText.indexOf('\n');
    if (firstLineEnd > 0) {
      const firstLine = bodyText.substring(0, firstLineEnd).trim().toUpperCase();
      if (firstLine.includes('ОПЕРАЦИЯ') && firstLine.includes('№')) {
        bodyText = bodyText.substring(firstLineEnd + 1);
      }
    }
    const opParas = textToParagraphs(bodyText);
    allChildren.push(...opParas);
    
    // Add spacing between operations
    allChildren.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
  }
  
  allChildren.push(new Paragraph({ children: [new PageBreak()] }));
  
  // --- Sections 7-13 ---
  for (const num of ['7', '8', '9', '10', '11', '12', '13']) {
    if (sections[num]) {
      const sectionParas = textToParagraphs(sections[num]);
      allChildren.push(...sectionParas);
      allChildren.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
    }
  }
  
  allChildren.push(new Paragraph({ children: [new PageBreak()] }));
  
  // --- МК (Маршрутная Карта) ---
  const mkHeaderParas = textToParagraphs(mkHeaderText);
  allChildren.push(...mkHeaderParas);
  allChildren.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
  
  // MK Table
  const mkTable = buildMKTable(mkRows);
  allChildren.push(mkTable);
  
  // --- Equipment Warnings ---
  if (warnings && warnings.length > 0) {
    allChildren.push(new Paragraph({ spacing: { before: 240 }, children: [] }));
    allChildren.push(makeSectionHeading('Предупреждения по оборудованию'));
    for (const w of warnings) {
      allChildren.push(makeBodyParagraph(w));
    }
  }
  
  // Header text
  const headerText = `${product.name} ${product.dimensions.length}×${product.dimensions.width}×${product.dimensions.thickness} мм — ${product.material.type} ${product.material.name}`;
  
  // Build document
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: BODY_SIZE }
        }
      }
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: MARGIN_20MM, right: MARGIN_20MM, bottom: MARGIN_20MM, left: MARGIN_20MM }
        }
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({ text: headerText, font: FONT, size: SMALL_SIZE, italics: true, color: '666666' })
              ]
            })
          ]
        })
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: 'Стр. ', font: FONT, size: SMALL_SIZE }),
                new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: SMALL_SIZE }),
                new TextRun({ text: ' из ', font: FONT, size: SMALL_SIZE }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: SMALL_SIZE })
              ]
            })
          ]
        })
      },
      children: allChildren
    }]
  });
  
  return doc;
}

module.exports = {
  assembleDocument,
  textToParagraphs,
  parseMarkdownToRuns,
  makeBodyParagraph,
  makeBlockquoteParagraph,
  makeSectionHeading,
  makeOperationHeading,
  buildTitlePageParagraphs,
  buildMKTable,
  Packer,
  FONT,
  BODY_SIZE,
  HEADING_SIZE
};
