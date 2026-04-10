#!/usr/bin/env node
/**
 * build_batch_from_excel.js
 *
 * Reads Excel and generates a batch JSON for TK+MK+RKM generation.
 *
 * Usage:
 *   node scripts/build_batch_from_excel.js <input.xlsx> [output.json] [--excel-mapping '<json>']
 */

'use strict';

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const minimist = require('minimist');
const { normalizeUnit, validateUnitConsistency } = require('../src/utils/unit-normalizer');
const { loadConfig, getConfig } = require('../src/config');
const {
  parseDimensions,
  resolveExcelMapping,
  validateRequiredColumns,
  loadMappingArg
} = require('../src/utils/excel-import');

const argv = minimist(process.argv.slice(2), {
  string: ['excel-mapping'],
  alias: { m: 'excel-mapping' }
});

const inputFile = argv._[0];
const outputFile = argv._[1] || 'examples/full_album_batch.json';

if (!inputFile) {
  console.error('Usage: node scripts/build_batch_from_excel.js <input.xlsx> [output.json] [--excel-mapping "{...}"]');
  process.exit(1);
}

loadConfig();

function detectMaterial(name) {
  const lower = name.toLowerCase();
  if (lower.includes('жалгыз') || lower.includes('zhalgyiz')) return { type: 'гранит', name: 'Жалгыз', density: 2700 };
  if (lower.includes('delikato') || lower.includes('деликато')) return { type: 'мрамор', name: 'Delikato_light', density: 2700 };
  if (lower.includes('fatima') || lower.includes('фатима')) return { type: 'известняк', name: 'Fatima', density: 2400 };
  if (lower.includes('габбро') || lower.includes('нинимяки') || lower.includes('gabbro')) return { type: 'габбро-диабаз', name: 'Габбро-диабаз_Нинимяки', density: 2900 };
  if (lower.includes('гранит')) return { type: 'гранит', name: 'Жалгыз', density: 2700 };
  if (lower.includes('мрамор')) return { type: 'мрамор', name: 'Delikato_light', density: 2700 };
  if (lower.includes('известняк')) return { type: 'известняк', name: 'Fatima', density: 2400 };
  return { type: 'гранит', name: 'Жалгыз', density: 2700 };
}

function normalizeTexture(textureStr) {
  if (!textureStr) return 'лощение';
  const lower = textureStr.toLowerCase().trim();

  if (lower.includes('рельефная') || lower.includes('матовая')) return 'рельефная_матовая';
  if ((lower.includes('бучард') && lower.includes('лощ')) || (lower.includes('лощ') && lower.includes('бучард'))) return 'бучардирование_лощение';
  if (lower.includes('бучард')) return 'бучардирование_лощение';
  if (lower.includes('лощ')) return 'лощение';
  if (lower.includes('полировка') || lower.includes('полир')) return 'лощение';
  return 'лощение';
}

function determineKReject(dims, name) {
  if (!dims) return 1.4;
  const lower = name.toLowerCase();
  if (dims.length >= 5000) return 1.8;
  if (lower.includes('сегмент') || lower.includes('радиус') || lower.includes('объёмн') || lower.includes('объемн') || lower.includes('п-образ') || lower.includes('профил')) return 2.0;
  return 1.4;
}

function determineGeometry(name) {
  const lower = name.toLowerCase();
  if (lower.includes('сегмент') || lower.includes('радиус')) return 'segmented';
  if (lower.includes('объёмн') || lower.includes('объемн') || lower.includes('п-образ')) return 'volume';
  if (lower.includes('профил') || lower.includes('капельник') || lower.includes('кант')) return 'profiled';
  return 'simple';
}

function calcPieces(qty, measurementType, dims) {
  if (!qty || !dims) return Math.max(1, Math.round(qty || 1));
  if (measurementType === 'area') {
    const pieceArea = (dims.length / 1000) * (dims.width / 1000);
    if (pieceArea > 0) return Math.ceil(qty / pieceArea);
  }
  if (measurementType === 'length') {
    const pieceLength = dims.length / 1000;
    if (pieceLength > 0) return Math.ceil(qty / pieceLength);
  }
  if (measurementType === 'count') return Math.max(1, Math.round(qty));

  console.warn(`  ПРЕДУПРЕЖДЕНИЕ: measurement_type="${measurementType}" — расчёт qty_pieces может быть некорректным`);
  return Math.max(1, Math.round(qty));
}

function shortName(no, dims) {
  if (!dims) return `pos_${String(no).padStart(2, '0')}`;
  return `pos_${String(no).padStart(2, '0')}_${dims.length}x${dims.width}x${dims.thickness}`;
}

function readColumn(row, mapping, key) {
  const idx = mapping[key];
  if (idx === undefined || idx < 0) return undefined;
  return row[idx];
}

const workbook = XLSX.readFile(path.resolve(inputFile));
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
const headerRow = rows[0] || [];

const mappingArg = loadMappingArg(argv['excel-mapping']);
if (argv['excel-mapping'] && !mappingArg) {
  console.error('Ошибка: --excel-mapping должен быть валидным JSON-объектом.');
  process.exit(1);
}

const mapping = resolveExcelMapping(headerRow, mappingArg);
const mappingValidation = validateRequiredColumns(mapping);
if (!mappingValidation.ok) {
  const missingList = mappingValidation.missing.join(', ');
  let hint = '';
  if (mappingValidation.missing.includes('dimensions')) {
    hint = '\nПодсказка: обязательна колонка "Габаритные размеры" или явный маппинг: --excel-mapping "{\"dimensions\":\"Название колонки\"}"';
  }
  console.error(`Ошибка: не найдены обязательные колонки: ${missingList}.${hint}`);
  process.exit(1);
}

const products = [];
const rowErrors = [];

for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  const no = readColumn(row, mapping, 'position');
  if (no === '' || no === null || no === undefined) continue;

  const excelRowNumber = i + 1;
  const fullName = String(readColumn(row, mapping, 'name') || '');
  const textureRaw = String(readColumn(row, mapping, 'texture') || '');
  const dimsRaw = String(readColumn(row, mapping, 'dimensions') || '');
  const unitRaw = String(readColumn(row, mapping, 'unit') || '');
  const qtyRaw = readColumn(row, mapping, 'quantity');
  const controlPriceRaw = readColumn(row, mapping, 'controlPrice');

  const parsedDims = parseDimensions(dimsRaw);
  if (!parsedDims.value) {
    rowErrors.push(`Строка ${excelRowNumber} (поз. ${no}): ошибка размеров — ${parsedDims.error}`);
    continue;
  }

  const material = detectMaterial(fullName);
  const texture = normalizeTexture(textureRaw);
  const kReject = determineKReject(parsedDims.value, fullName);

  const { unit: normalizedUnit, measurement_type } = normalizeUnit(unitRaw);
  try {
    validateUnitConsistency(normalizedUnit, measurement_type, `Строка ${excelRowNumber}, поз.${no}`);
  } catch (err) {
    rowErrors.push(`Строка ${excelRowNumber} (поз. ${no}): ${err.message}`);
    continue;
  }

  const qtyPieces = calcPieces(qtyRaw, measurement_type, parsedDims.value);

  let controlPrice = null;
  if (controlPriceRaw !== undefined && controlPriceRaw !== null && controlPriceRaw !== '') {
    const parsed = parseFloat(String(controlPriceRaw).replace(/\s/g, '').replace(',', '.'));
    if (!Number.isNaN(parsed) && parsed > 0) controlPrice = parsed;
  }

  const product = {
    tk_number: no,
    name: fullName,
    short_name: shortName(no, parsedDims.value),
    dimensions: parsedDims.value,
    material,
    texture,
    quantity: `${qtyRaw} ${normalizedUnit || unitRaw}`,
    quantity_pieces: qtyPieces,
    control_unit: normalizedUnit || unitRaw,
    measurement_type,
    edges: 'калибровка по всем сторонам, фаски 5мм',
    geometry_type: determineGeometry(fullName),
    category: '1',
    packaging: parsedDims.value.length >= 1500 ? 'усиленная' : 'стандартная',
    rkm: {
      k_reject: kReject,
      transport: { ...getConfig().rkm.logisticsDefaults },
      material_prices: {
        diamond_discs: 10000,
        diamond_milling_heads: 8000,
        bush_hammer_heads_price: 8500,
        abrasives: 6500,
        coolant_chemistry: 1200,
        protective_materials: 800,
        packaging: parsedDims.value.length >= 1500 ? 18000 : 5000,
        marking: 1500,
        ppe: 600
      }
    }
  };

  if (controlPrice !== null) product.control_price = controlPrice;
  products.push(product);
}

if (rowErrors.length > 0) {
  console.error('Найдены ошибки в строках Excel:');
  rowErrors.forEach((e) => console.error(`  - ${e}`));
  console.error(`\nИтого ошибок: ${rowErrors.length}. Исправьте данные и повторите импорт.`);
  process.exit(1);
}

const output = { products };
const outputPath = path.resolve(outputFile);
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');

console.log(`\n✓ Сформировано ${products.length} позиций`);
console.log(`✓ Сохранено: ${outputPath}`);
