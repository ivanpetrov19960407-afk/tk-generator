'use strict';

const fs = require('fs');
const JSZip = require('jszip');

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function flattenObject(obj, prefix = '', out = {}) {
  if (!obj || typeof obj !== 'object') return out;
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenObject(value, path, out);
    } else {
      out[path] = value;
    }
  }
  return out;
}

function buildTableXml(headers, rows) {
  const cols = headers.length;
  const cellWidth = Math.floor(9000 / Math.max(cols, 1));

  const makeCell = (text, isHeader = false) => (
    `<w:tc>` +
      `<w:tcPr><w:tcW w:w="${cellWidth}" w:type="dxa"/></w:tcPr>` +
      `<w:p><w:r><w:rPr>${isHeader ? '<w:b/>' : ''}</w:rPr><w:t>${escapeXml(text)}</w:t></w:r></w:p>` +
    `</w:tc>`
  );

  const headerRow = `<w:tr>${headers.map((h) => makeCell(h, true)).join('')}</w:tr>`;
  const dataRows = rows.map((row) => `<w:tr>${row.map((c) => makeCell(c)).join('')}</w:tr>`).join('');

  return (
    `<w:tbl>` +
      `<w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr>` +
      `<w:tblGrid>${Array.from({ length: cols }).map(() => `<w:gridCol w:w="${cellWidth}"/>`).join('')}</w:tblGrid>` +
      headerRow +
      dataRows +
    `</w:tbl>`
  );
}

function buildOperationsTableXml(operations) {
  const rows = (operations || [])
    .filter((op) => !op.isNotApplicable)
    .map((op) => [op.number, op.title, (op.text || '').replace(/\s+/g, ' ').trim()]);
  return buildTableXml(['№', 'Операция', 'Описание'], rows);
}

function buildMkTableXml(mkRows) {
  const rows = (mkRows || []).map((row) => [row.num, row.name, row.equipment, row.executor, row.control]);
  return buildTableXml(['№', 'Наименование', 'Оборудование', 'Исполнитель', 'Контроль'], rows);
}

function replaceParagraphPlaceholder(xml, placeholder, replacementXml) {
  const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`<w:p[^>]*>[\\s\\S]*?${escaped}[\\s\\S]*?<\\/w:p>`, 'g');
  return xml.replace(rx, replacementXml);
}


function buildMinimalDocx(documentXml) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.folder('word').file('document.xml', documentXml);
  return zip;
}

async function loadTemplate(templatePath) {
  const templateBuffer = fs.readFileSync(templatePath);
  try {
    const zip = await JSZip.loadAsync(templateBuffer);
    const documentXml = zip.file('word/document.xml');
    if (!documentXml) {
      throw new Error(`Шаблон не содержит word/document.xml: ${templatePath}`);
    }
    return { zip, xml: await documentXml.async('string') };
  } catch (_err) {
    const xml = templateBuffer.toString('utf8').trim();
    if (!xml.startsWith('<?xml') && !xml.startsWith('<w:document')) {
      throw new Error(`Шаблон должен быть DOCX-архивом или XML WordprocessingML: ${templatePath}`);
    }
    const zip = buildMinimalDocx(xml);
    return { zip, xml };
  }
}

async function renderTemplateDocx(templatePath, data) {
  const { zip, xml: sourceXml } = await loadTemplate(templatePath);

  let xml = sourceXml;

  const flat = flattenObject(data);
  for (const [key, value] of Object.entries(flat)) {
    const placeholder = `{{${key}}}`;
    xml = xml.split(placeholder).join(escapeXml(value));
  }

  xml = replaceParagraphPlaceholder(xml, '{{operations_table}}', buildOperationsTableXml(data.operations));
  xml = replaceParagraphPlaceholder(xml, '{{mk_table}}', buildMkTableXml(data.mkRows));

  zip.file('word/document.xml', xml);
  return zip.generateAsync({ type: 'nodebuffer' });
}

module.exports = {
  renderTemplateDocx,
  buildOperationsTableXml,
  buildMkTableXml,
  flattenObject,
  loadTemplate
};
