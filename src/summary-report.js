'use strict';

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { calcGeometry } = require('./rkm/geometry-calc');
const { mapOperations } = require('./rkm/operations-mapper');
const { calcMaterials } = require('./rkm/materials-calc');
const { calcOverheads } = require('./rkm/overhead-calc');
const { calcTransport } = require('./rkm/rkm-generator');
const { applyDefaultFonts, addHeaderFooter, drawTable, cleanMarkdown } = require('./pdf-utils');
const { sanitizeCsvValue } = require('./utils/security');
const {
  detectAreaMode,
  buildSizeBasedOverrides,
  buildSizeBasedMaterialPrices,
  getSizeBasedKReject,
  getControlUnit,
  getCalcPrice
} = require('./rkm/optimizer');

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
function styleHeaderRow(row) { row.eachCell((cell) => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } }; cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; cell.border = { top: { style: 'thin', color: { argb: 'FFD9D9D9' } }, left: { style: 'thin', color: { argb: 'FFD9D9D9' } }, bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } }, right: { style: 'thin', color: { argb: 'FFD9D9D9' } } }; }); }
function autoFitColumns(ws, minWidth = 10, maxWidth = 60) { ws.columns.forEach((column) => { let max = minWidth; column.eachCell({ includeEmpty: true }, (cell) => { const text = cell.value == null ? '' : String(cell.value); max = Math.max(max, Math.min(maxWidth, text.length + 2)); }); column.width = max; }); }
function applyAreaModeAdjustments(product) { const workProduct = deepClone(product); const areaMode = detectAreaMode(workProduct); if (!areaMode) return workProduct; if (!workProduct.quantity_pieces && areaMode.quantityPieces) workProduct.quantity_pieces = areaMode.quantityPieces; const geometry = calcGeometry(workProduct); const V_net = geometry.V_net; const qty = workProduct.quantity_pieces || 1; if (!workProduct.rkm) workProduct.rkm = {}; const userNorms = workProduct.rkm.norms_override || {}; workProduct.rkm.norms_override = { ...buildSizeBasedOverrides(workProduct, geometry, areaMode), ...userNorms }; const userPrices = workProduct.rkm.material_prices || {}; workProduct.rkm.material_prices = { ...buildSizeBasedMaterialPrices(V_net, qty), ...userPrices }; if (!product.rkm || !product.rkm.k_reject) workProduct.rkm.k_reject = getSizeBasedKReject(V_net); return workProduct; }
function calcProductSummary(product) { const workProduct = applyAreaModeAdjustments(product); const geometry = calcGeometry(workProduct); const operations = mapOperations(workProduct, geometry); const areaMode = detectAreaMode(workProduct); const unitLabel = areaMode ? (areaMode.controlUnit === 'm2' ? 'м²' : 'м.п.') : 'шт'; const materials = calcMaterials(workProduct, geometry, unitLabel); const tempOverheads = calcOverheads(materials, operations, { total: 0 }, geometry); const transport = calcTransport(workProduct, tempOverheads); const overheads = calcOverheads(materials, operations, transport, geometry); const controlUnit = getControlUnit(workProduct); const calcPrice = getCalcPrice(overheads, controlUnit); return { workProduct, geometry, operations, materials, overheads, controlUnit, calcPrice }; }
function normalizeReportFormats(formatOption) { const raw = Array.isArray(formatOption) ? formatOption.join(',') : (formatOption || 'xlsx'); const formats = [...new Set(String(raw).split(',').map((f) => f.trim().toLowerCase()).filter(Boolean))]; const allowed = new Set(['xlsx', 'pdf']); const invalid = formats.filter((f) => !allowed.has(f)); if (invalid.length) throw new Error(`Неподдерживаемый формат отчёта: ${invalid.join(', ')}`); return formats.length ? formats : ['xlsx']; }
const SUMMARY_CSV_COLUMNS = ['№', 'Наименование', 'Материал', 'Фактура', 'Длина, мм', 'Ширина, мм', 'Толщина, мм', 'Кол-во, шт', 'Ед. контроля', 'Кол-во (исх.)', 'Контрольная цена', 'Расчётная цена'];
const GENERATION_CSV_COLUMNS = ['generation_id', 'position', 'product_name', 'material', 'texture', 'total_cost', 'status', 'error_message'];
function csvEscape(value) { const normalized = sanitizeCsvValue(value); const raw = String(normalized == null ? '' : normalized); const escaped = raw.replace(/"/g, '""'); return /[",;\r\n]/.test(raw) ? `"${escaped}"` : escaped; }
function renderCsv(columns, rows) { const lines = [columns.map(csvEscape).join(';')]; rows.forEach((row) => { lines.push(columns.map((column) => csvEscape(row[column])).join(';')); }); return `\uFEFF${lines.join('\r\n')}\r\n`; }
function toFixedNumber(value, digits = 2) { const n = Number(value); return Number.isFinite(n) ? n.toFixed(digits) : ''; }
function buildSummaryCsvRows(calculations) { return calculations.map(({ workProduct, geometry, calcPrice }) => { const dims = workProduct.dimensions || {}; return { '№': workProduct.tk_number || '', 'Наименование': workProduct.name || '', 'Материал': (workProduct.material && workProduct.material.name) || (workProduct.material && workProduct.material.type) || '', 'Фактура': workProduct.texture || '', 'Длина, мм': dims.length || 0, 'Ширина, мм': dims.width || 0, 'Толщина, мм': dims.thickness || 0, 'Кол-во, шт': geometry.qty || workProduct.quantity_pieces || 1, 'Ед. контроля': workProduct.control_unit || 'шт', 'Кол-во (исх.)': workProduct.quantity || '', 'Контрольная цена': toFixedNumber(workProduct.control_price, 2), 'Расчётная цена': toFixedNumber(calcPrice, 2) }; }); }
function buildGenerationCsvRows(generation) { const items = Array.isArray(generation && generation.items) ? generation.items : []; return items.map((item) => ({ generation_id: generation.id, position: item.position == null ? '' : item.position, product_name: item.product_name || '', material: item.material || '', texture: item.texture || '', total_cost: toFixedNumber(item.total_cost, 2), status: item.status || '', error_message: item.error_message || '' })); }
function writeSummaryCsvFile(calculations, outputPath) { fs.writeFileSync(outputPath, renderCsv(SUMMARY_CSV_COLUMNS, buildSummaryCsvRows(calculations)), 'utf8'); return outputPath; }
function buildGenerationCsv(generation) { return renderCsv(GENERATION_CSV_COLUMNS, buildGenerationCsvRows(generation)); }

async function generateSummaryReportPdf(calculations, tkStatusByNumber, outputDir, options = {}) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 55, left: 40, right: 40, bottom: 42 }, bufferPages: true });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const fonts = applyDefaultFonts(doc, options);

  doc.font(fonts.bold).fontSize(15).text('Сводный отчёт ТК+МК');
  doc.font(fonts.regular).fontSize(10).text(`Дата формирования: ${new Date().toISOString().slice(0, 10)}`);
  doc.moveDown(0.6);

  doc.font(fonts.bold).fontSize(12).text('Реестр ТК');
  drawTable(doc, {
    fonts,
    columns: [
      { key: 'tk', width: 42 },
      { key: 'name', width: 166 },
      { key: 'dimensions', width: 110 },
      { key: 'material', width: 86 },
      { key: 'status', width: 111 }
    ],
    header: ['№', 'Наименование', 'Размеры, мм', 'Материал', 'Статус'],
    rows: calculations.map(({ workProduct }) => {
      const d = workProduct.dimensions || {};
      return {
        tk: String(workProduct.tk_number || ''),
        name: cleanMarkdown(workProduct.name || ''),
        dimensions: `${d.length || 0}×${d.width || 0}×${d.thickness || 0}`,
        material: cleanMarkdown((workProduct.material && (workProduct.material.name || workProduct.material.type)) || ''),
        status: cleanMarkdown(tkStatusByNumber.get(String(workProduct.tk_number)) || 'Не запускалось')
      };
    })
  });

  doc.moveDown(0.5);
  doc.font(fonts.bold).fontSize(12).text('Сводка цен');
  drawTable(doc, {
    fonts,
    columns: [
      { key: 'tk', width: 42 },
      { key: 'name', width: 196 },
      { key: 'unit', width: 46 },
      { key: 'control', width: 92 },
      { key: 'calculated', width: 96 },
      { key: 'deviation', width: 43 }
    ],
    header: ['№', 'Наименование', 'Ед.', 'Контрольная', 'Расчётная', 'Δ%'],
    rows: calculations.map(({ workProduct, calcPrice, controlUnit }) => {
      const controlPrice = Number(workProduct.control_price) || 0;
      const deviation = controlPrice > 0 ? ((Number(calcPrice || 0) - controlPrice) / controlPrice) * 100 : 0;
      return {
        tk: String(workProduct.tk_number || ''),
        name: cleanMarkdown(workProduct.name || ''),
        unit: controlUnit === 'm2' ? 'м²' : controlUnit === 'mp' ? 'м.п.' : 'шт',
        control: controlPrice.toFixed(2),
        calculated: Number(calcPrice || 0).toFixed(2),
        deviation: `${deviation.toFixed(1)}%`
      };
    })
  });

  addHeaderFooter(doc, { getHeaderText: () => 'Сводный отчёт ТК+МК' });

  fs.mkdirSync(outputDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const outPath = path.join(outputDir, `SUMMARY_${date}.pdf`);

  const endPromise = new Promise((resolve) => doc.on('end', resolve));
  doc.end();
  await endPromise;
  fs.writeFileSync(outPath, Buffer.concat(chunks));
  return { file: outPath };
}

async function generateSummaryReport(products, tkResults, outputDir, options = {}) {
  const calculations = products.map((p) => calcProductSummary(p));
  const tkStatusByNumber = new Map(tkResults.map((r) => [String(r.product && r.product.tk_number), r.success ? 'Сгенерировано' : `Ошибка: ${r.error || 'неизвестно'}`]));
  const formats = normalizeReportFormats(options.format || 'xlsx');
  const files = [];

  if (formats.includes('xlsx')) {
    const wb = new ExcelJS.Workbook(); wb.creator = 'tk-generator'; wb.created = new Date();
    const registry = wb.addWorksheet('Реестр ТК'); registry.addRow(['№', 'Наименование', 'Размеры, мм', 'Материал', 'Фактура', 'Статус генерации']); styleHeaderRow(registry.getRow(1));
    calculations.forEach(({ workProduct }) => { const d = workProduct.dimensions || {}; const dims = `${d.length || 0}×${d.width || 0}×${d.thickness || 0}`; registry.addRow([workProduct.tk_number || '', workProduct.name || '', dims, (workProduct.material && workProduct.material.name) || (workProduct.material && workProduct.material.type) || '', workProduct.texture || '', tkStatusByNumber.get(String(workProduct.tk_number)) || 'Не запускалось']); });
    const pricing = wb.addWorksheet('Сводка цен'); pricing.addRow(['№', 'Наименование', 'Ед.', 'Контрольная цена', 'Расчётная цена', 'Отклонение, %']); styleHeaderRow(pricing.getRow(1));
    calculations.forEach(({ workProduct, calcPrice, controlUnit }) => { const controlPrice = Number(workProduct.control_price) || 0; const deviation = controlPrice > 0 ? ((calcPrice - controlPrice) / controlPrice) * 100 : null; pricing.addRow([workProduct.tk_number || '', workProduct.name || '', controlUnit === 'm2' ? 'м²' : controlUnit === 'mp' ? 'м.п.' : 'шт', controlPrice, calcPrice, deviation]); });
    const lastPricingRow = pricing.rowCount; pricing.getColumn(4).numFmt = '#,##0.00'; pricing.getColumn(5).numFmt = '#,##0.00'; pricing.getColumn(6).numFmt = '0.00';
    if (lastPricingRow >= 2) pricing.addConditionalFormatting({ ref: `F2:F${lastPricingRow}`, rules: [{ type: 'expression', formulae: ['ABS(F2)>5'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' }, fgColor: { argb: 'FFFFC7CE' } }, font: { color: { argb: 'FF9C0006' }, bold: true } } }] });
    const materialsWs = wb.addWorksheet('Материалы'); materialsWs.addRow(['Материал', 'Общий объём сырья, м³', 'Общая масса, кг']); styleHeaderRow(materialsWs.getRow(1));
    const materialAgg = new Map(); calculations.forEach(({ workProduct, geometry }) => { const matName = (workProduct.material && workProduct.material.name) || (workProduct.material && workProduct.material.type) || 'Не указан'; if (!materialAgg.has(matName)) materialAgg.set(matName, { volume: 0, mass: 0 }); const acc = materialAgg.get(matName); acc.volume += Number(geometry.raw_need_batch) || 0; acc.mass += Number(geometry.mass_batch) || 0; });
    for (const [material, totals] of materialAgg.entries()) materialsWs.addRow([material, totals.volume, totals.mass]);
    const materialTotalVolume = Array.from(materialAgg.values()).reduce((s, v) => s + v.volume, 0); const materialTotalMass = Array.from(materialAgg.values()).reduce((s, v) => s + v.mass, 0); const matTotalRow = materialsWs.addRow(['ИТОГО', materialTotalVolume, materialTotalMass]); matTotalRow.font = { bold: true }; materialsWs.getColumn(2).numFmt = '0.000000'; materialsWs.getColumn(3).numFmt = '#,##0.00';
    const laborWs = wb.addWorksheet('Трудозатраты'); laborWs.addRow(['№ оп.', 'Операция', 'Суммарно чел-ч', 'Суммарно маш-ч']); styleHeaderRow(laborWs.getRow(1));
    const opAgg = new Map(); calculations.forEach(({ operations }) => { (operations.rows || []).forEach((op) => { if (!opAgg.has(op.no)) opAgg.set(op.no, { name: op.name, chel: 0, mash: 0 }); const acc = opAgg.get(op.no); acc.chel += Number(op.chel_ch_party) || 0; acc.mash += Number(op.mash_ch_party) || 0; }); });
    const sortedOps = Array.from(opAgg.entries()).sort((a, b) => Number(a[0]) - Number(b[0])); for (const [no, data] of sortedOps) laborWs.addRow([no, data.name, data.chel, data.mash]);
    const totalChel = sortedOps.reduce((s, [, d]) => s + d.chel, 0); const totalMash = sortedOps.reduce((s, [, d]) => s + d.mash, 0); const laborTotalRow = laborWs.addRow(['', 'ИТОГО', totalChel, totalMash]); laborTotalRow.font = { bold: true }; laborWs.getColumn(3).numFmt = '0.000'; laborWs.getColumn(4).numFmt = '0.000';
    const materialsSummaryWs = wb.addWorksheet('Сводка по материалам'); materialsSummaryWs.addRow(['Материал', 'Количество позиций', 'Общая площадь', 'Средняя себестоимость/м²']); styleHeaderRow(materialsSummaryWs.getRow(1));
    const materialsSummaryAgg = new Map(); calculations.forEach(({ workProduct, geometry, overheads }) => { const materialName = (workProduct.material && workProduct.material.name) || (workProduct.material && workProduct.material.type) || 'Не указан'; if (!materialsSummaryAgg.has(materialName)) materialsSummaryAgg.set(materialName, { count: 0, area: 0, totalCost: 0 }); const acc = materialsSummaryAgg.get(materialName); const area = (Number(geometry.area_top) || 0) * (Number(geometry.qty) || 0); acc.count += 1; acc.area += area; acc.totalCost += Number(overheads.itogo_bez_NDS || 0); });
    for (const [material, totals] of materialsSummaryAgg.entries()) materialsSummaryWs.addRow([material, totals.count, totals.area, totals.area > 0 ? totals.totalCost / totals.area : 0]);
    materialsSummaryWs.getColumn(3).numFmt = '0.000'; materialsSummaryWs.getColumn(4).numFmt = '#,##0.00';
    const bomWs = wb.addWorksheet('BOM'); bomWs.addRow(['Категория', 'Номенклатура', 'Ед.', 'Количество', 'Итог на партию']); styleHeaderRow(bomWs.getRow(1));
    const bomAgg = new Map(); calculations.forEach(({ materials }) => { (materials.items || []).forEach((item) => { let category = null; const name = String(item.name || '').toLowerCase(); if (name.includes('блок') || name.includes('сырье')) category = 'Сырьё (блоки камня)'; else if (name.includes('абразив')) category = 'Расходники (абразивы)'; else if (name.includes('алмаз')) category = 'Расходники (алмазные диски)'; if (!category) return; const key = `${category}|${item.name}|${item.unit}`; if (!bomAgg.has(key)) bomAgg.set(key, { category, name: item.name, unit: item.unit, qty: 0, sum: 0 }); const acc = bomAgg.get(key); acc.qty += Number(item.qty_val) || 0; acc.sum += Number(item.sum) || 0; }); });
    Array.from(bomAgg.values()).forEach((row) => bomWs.addRow([row.category, row.name, row.unit, row.qty, row.sum]));
    const bomTotal = Array.from(bomAgg.values()).reduce((sum, row) => sum + row.sum, 0); const bomTotalRow = bomWs.addRow(['', 'ИТОГО', '', '', bomTotal]); bomTotalRow.font = { bold: true }; bomWs.getColumn(4).numFmt = '0.000'; bomWs.getColumn(5).numFmt = '#,##0.00';
    const textureSummaryWs = wb.addWorksheet('Сводка по фактурам'); textureSummaryWs.addRow(['Фактура', 'Количество позиций', 'Общая площадь', 'Средняя себестоимость/м²']); styleHeaderRow(textureSummaryWs.getRow(1));
    const textureSummaryAgg = new Map(); calculations.forEach(({ workProduct, geometry, overheads }) => { const texture = workProduct.texture || 'Не указана'; if (!textureSummaryAgg.has(texture)) textureSummaryAgg.set(texture, { count: 0, area: 0, totalCost: 0 }); const acc = textureSummaryAgg.get(texture); const area = (Number(geometry.area_top) || 0) * (Number(geometry.qty) || 0); acc.count += 1; acc.area += area; acc.totalCost += Number(overheads.itogo_bez_NDS || 0); });
    for (const [texture, totals] of textureSummaryAgg.entries()) textureSummaryWs.addRow([texture, totals.count, totals.area, totals.area > 0 ? totals.totalCost / totals.area : 0]);
    textureSummaryWs.getColumn(3).numFmt = '0.000'; textureSummaryWs.getColumn(4).numFmt = '#,##0.00';
    [registry, pricing, materialsWs, laborWs, materialsSummaryWs, bomWs, textureSummaryWs].forEach((ws) => { ws.views = [{ state: 'frozen', ySplit: 1 }]; autoFitColumns(ws); });
    fs.mkdirSync(outputDir, { recursive: true }); const date = new Date().toISOString().slice(0, 10); const outPath = path.join(outputDir, `SUMMARY_${date}.xlsx`); await wb.xlsx.writeFile(outPath); files.push({ format: 'xlsx', file: outPath });
  }

  if (formats.includes('pdf')) {
    const result = await generateSummaryReportPdf(calculations, tkStatusByNumber, outputDir, options);
    files.push({ format: 'pdf', file: result.file });
  }

  return { file: files[0].file, files };
}

module.exports = { generateSummaryReport, normalizeReportFormats, SUMMARY_CSV_COLUMNS, GENERATION_CSV_COLUMNS, writeSummaryCsvFile, buildGenerationCsv };
