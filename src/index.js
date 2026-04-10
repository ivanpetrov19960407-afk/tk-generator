#!/usr/bin/env node

/**
 * index.js — CLI entry point for TK Generator
 * 
 * Usage:
 *   tk-generator --input examples/product_minimal.json --output output/
 *   tk-generator --input examples/batch_small.json --output output/
 *   tk-generator --input examples/sample_input.xlsx --output output/
 */

const fs = require('fs');
const path = require('path');
const minimist = require('minimist');
const { generateBatch } = require('./generator');
const { generateRKM } = require('./rkm/rkm-generator');
const { calculateTotalCost, formatMoneyRu } = require('./cost-calculator');
const { normalizeUnit } = require('./utils/unit-normalizer');
const { SUPPORTED_TEXTURES } = require('./textures');
const { validateBatchInput } = require('./validation/validator');
const { loadConfig, getConfig } = require('./config');
const { generateSummaryReport } = require('./summary-report');

const args = minimist(process.argv.slice(2), {
  alias: {
    i: 'input',
    o: 'output',
    h: 'help',
    e: 'export-cost'
  },
  boolean: ['rkm', 'optimize', 'cost-breakdown', 'validate-only', 'summary'],
  default: {
    output: 'output/',
    rkm: false,
    optimize: false,
    'cost-breakdown': false,
    'validate-only': false,
    summary: false,
    'unknown-unit-policy': 'warning'
  }
});

function printHelp() {
  console.log(`
╔════════════════════════════════════════════════╗
║  Генератор ТК+МК для натурального камня v1.0  ║
╚════════════════════════════════════════════════╝

Использование:
  tk-generator --input <файл> [--output <папка>] [--rkm] [--optimize]

Параметры:
  -i, --input    Входной файл (JSON или XLSX)     [обязательный]
  -o, --output   Папка для сгенерированных файлов  [по умолчанию: output/]
      --rkm      Генерировать РКМ (расчётно-калькуляционную ведомость)
      --optimize Обратная калькуляция ПКМ по контрольным ценам (требует --rkm)
      --cost-breakdown   Показать смету по операциям в консоли
      --validate-only    Только проверить входные данные и завершить
      --summary          Сформировать сводный Excel-отчёт по партии
      --unknown-unit-policy <warning|error> Политика для нераспознанных единиц
  -e, --export-cost <file.json> Экспорт сметы по всем изделиям в JSON
      --labor-rates-override <file.json> Переопределить тарифы труда
      --equipment-costs-override <file.json> Переопределить тарифы оборудования
      --material-prices-override <file.json> Переопределить цены материалов
      --overhead-override <file.json> Переопределить накладные расходы
      --overrides <file.json>   Переопределить операции через rules JSON
      --config <file.json|yaml> Дополнительный конфиг поверх default/local
      --config-dir <dir>        Папка с default.json и local.json
  -h, --help     Показать справку

Примеры:
  # Один продукт (JSON)
  tk-generator --input examples/product_minimal.json --output output/

  # Пакетная генерация (JSON)
  tk-generator --input examples/batch_small.json --output output/

  # Из Excel файла
  tk-generator --input examples/sample_input.xlsx --output output/

  # РКМ с обратной калькуляцией по контрольным ценам
  tk-generator --input examples/batch_full.json --rkm --optimize --output output/

  # Вывести смету по операциям
  tk-generator --input examples/batch_small.json --cost-breakdown

  # Экспорт смет в JSON
  tk-generator --input examples/batch_small.json --export-cost output/costs.json

Поддерживаемые фактуры:
${SUPPORTED_TEXTURES.map(t => `  - ${t}`).join('\n')}
`);
}

/**
 * Find a column value by flexible header matching (partial, case-insensitive)
 */
function findCol(row, ...patterns) {
  for (const key of Object.keys(row)) {
    const k = key.trim().toLowerCase();
    for (const pat of patterns) {
      if (k.includes(pat.toLowerCase())) return row[key];
    }
  }
  return null;
}

/**
 * Parse dimensions string like "2500х410х150мм" into {length, width, thickness}
 * Handles both Russian "х" (U+0445) and Latin "x"
 */
function parseDimensions(dimStr, nameText) {
  if (!dimStr) return { length: 0, width: 0, thickness: 0 };
  const cleaned = String(dimStr).replace(/мм$/i, '').trim();
  const parts = cleaned.split(/[хxХX]/).map(p => p.replace(/^[^0-9.]+/, ''));
  let thickness = parseFloat(parts[2]) || 0;

  if (!thickness && parts.length === 2 && nameText) {
    // Try extracting thickness from Наименование text
    const txt = String(nameText);
    const m = txt.match(/толщин\w*\s*t?\s*=?\s*(\d+)/i) || txt.match(/t\s*=\s*(\d+)/i);
    if (m) {
      thickness = parseFloat(m[1]);
    } else {
      thickness = 30;
      console.warn(`[WARN] Поз. "${dimStr}": толщина не найдена, используется 30мм по умолчанию`);
    }
  }

  return {
    length: parseFloat(parts[0]) || 0,
    width: parseFloat(parts[1]) || 0,
    thickness: thickness
  };
}

/**
 * Extract material name and type from "Наименование" text
 * e.g. "... Материал — гранит м-ния Жалгыз; ..." → { type: 'гранит', name: 'гранит м-ния Жалгыз' }
 */
function extractMaterial(nameText) {
  if (!nameText) return { type: 'мрамор', name: 'unknown' };
  const text = String(nameText);

  // Сначала проверяем габбро-диабаз (у него нет слова "Материал" в названии)
  if (text.toLowerCase().includes('габбро')) {
    return { type: 'габбро-диабаз', name: 'Габбро-диабаз Нинимяки' };
  }

  // Fallback: ищем известные названия камня в тексте (даже без слова "Материал")
  const lc = text.toLowerCase();
  if (lc.includes('жалгыз')) return { type: 'гранит', name: 'гранит м-ния Жалгыз' };
  if (lc.includes('delikato')) return { type: 'мрамор', name: 'мрамор Delikato light' };
  if (lc.includes('fatima') || lc.includes('фатима')) return { type: 'известняк', name: 'мраморизированный известняк Fatima' };

  // Извлекаем материал: отсекаем "Обработка" и др. хвосты
  const matMatch = text.match(/Материал\s*[—–\-:]\s*(.+?)(?:[;,]|\s+Обработка|$)/i);
  if (!matMatch) return { type: 'мрамор', name: 'unknown' };
  let materialName = matMatch[1].trim();

  // Detect type from first word
  const knownTypes = ['гранит', 'мрамор', 'известняк', 'мраморизированный', 'травертин', 'песчаник', 'оникс', 'габбро', 'кварцит'];
  const firstWord = materialName.split(/\s/)[0].toLowerCase();
  let materialType = knownTypes.find(t => firstWord.startsWith(t)) || 'мрамор';
  if (materialType === 'мраморизированный') materialType = 'известняк';

  return { type: materialType, name: materialName };
}

/**
 * Map texture description to internal code
 * e.g. "Бучардирование, лощение" → "бучардирование_лощение"
 */
function mapTexture(textureStr) {
  if (!textureStr) return 'лощение';
  const s = String(textureStr).trim().toLowerCase();

  const hasBuch = s.includes('бучардирование');
  const hasLosh = s.includes('лощение');
  const hasRelief = s.includes('рельефная');
  const hasMat = s.includes('матовая');

  if (hasBuch && hasLosh) return 'бучардирование_лощение';
  if (hasBuch) return 'бучардирование_лощение'; // бучардирование alone defaults to combo
  if (hasRelief || hasMat) return 'рельефная_матовая';
  if (hasLosh) return 'лощение';

  // Fallback: normalize by replacing separators with underscores
  return s.replace(/[\s,+]+/g, '_');
}

/**
 * Normalize unit of measurement to internal codes.
 * Returns { unit, measurement_type }.
 * НЕ делает молчаливый fallback в "шт" — при нераспознанной единице
 * measurement_type = "unknown".
 */
function mapControlUnit(unitStr) {
  return normalizeUnit(unitStr);
}

/**
 * Parse Excel input file
 * Expected columns: №п/п, Наименование, Тип обработки пов-ти, Габаритные размеры, Ед. изм., Кол-во, Цена за ед. с НДС руб
 */
function parseExcelInput(filePath) {
  const XLSX = require('xlsx');
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet);

  const products = rows.map((row, i) => {
    // Read columns with flexible matching
    const rowNum = findCol(row, '№п/п', '№', 'п/п');
    const nameText = findCol(row, 'Наименование', 'name', 'Название', 'Изделие');
    const textureStr = findCol(row, 'Тип обработки', 'обработк', 'Фактура', 'texture');
    const dimStr = findCol(row, 'Габаритные размеры', 'Габарит', 'размер');
    const unitStr = findCol(row, 'Ед. изм', 'Ед.изм', 'ед. изм', 'control_unit', 'Единица');
    const qty = findCol(row, 'Кол-во', 'Кол во', 'quantity', 'Количество');
    const price = findCol(row, 'Цена за ед', 'Контрольные цен', 'Цена', 'control_price', 'цена', 'цен');

    const dimensions = parseDimensions(dimStr, nameText);
    const material = extractMaterial(nameText);
    const { unit: control_unit, measurement_type } = mapControlUnit(unitStr);
    const texture = mapTexture(textureStr);
    const control_price = price != null ? Number(price) : null;
    const quantity = qty != null ? Number(qty) : null;

    return {
      tk_number: rowNum || (i + 1),
      name: nameText ? String(nameText) : null,
      short_name: null,
      dimensions: dimensions,
      material: {
        type: material.type,
        name: material.name,
        density: 2700
      },
      texture: texture,
      quantity: measurement_type === 'area' && quantity != null ? `${quantity} м²`
        : measurement_type === 'length' && quantity != null ? `${quantity} м.п.`
        : null,
      quantity_pieces: (() => {
        if (measurement_type === 'count' && quantity != null) return quantity;
        if (quantity == null || !dimensions.length || !dimensions.width) return null;
        if (measurement_type === 'area') {
          const pieceArea_m2 = (dimensions.length / 1000) * (dimensions.width / 1000);
          return pieceArea_m2 > 0 ? Math.ceil(quantity / pieceArea_m2) : null;
        }
        if (measurement_type === 'length') {
          const pieceLen_m = dimensions.length / 1000;
          return pieceLen_m > 0 ? Math.ceil(quantity / pieceLen_m) : null;
        }
        return null;
      })(),
      control_unit: control_unit,
      measurement_type: measurement_type,
      control_price: control_price,
      edges: null,
      geometry_type: (() => {
        const n = (nameText || '').toLowerCase();
        if (n.includes('ступен') || n.includes('проступь')) return 'profile';
        if (n.includes('подступен')) return 'profile';
        if (n.includes('сегмент') || n.includes('радиусн') || n.includes('колонн')) return 'segment';
        if (n.includes('карниз') || n.includes('капитель') || n.includes('балясин')) return 'profile';
        if (n.includes('плинтус') || n.includes('цоколь')) return 'profile';
        return 'simple';
      })(),
      object: null,
      category: '1',
      gost_primary: 'ГОСТ 9480-2024',
      packaging: 'стандартная',
      date: null
    };
  });

  const config = getConfig();
  const SKIP_TRANSPORT = new Set(config.rkm.skipTransportTkNumbers || []);
  for (const p of products) {
    if (SKIP_TRANSPORT.has(p.tk_number)) {
      if (!p.rkm) p.rkm = {};
      if (!p.rkm.transport) p.rkm.transport = {};
      p.rkm.transport.skip = true;
    }
  }

  // Спец-правила по материалам из конфигурации
  const specialMaterialRules = config.rkm.specialMaterialRules || {};
  for (const p of products) {
    const matchedRule = Object.entries(specialMaterialRules).find(([materialType, rule]) => {
      const keywords = Array.isArray(rule.detectKeywords) ? rule.detectKeywords : [materialType];
      const haystack = `${p.material && p.material.type ? p.material.type : ''} ${p.name || ''}`.toLowerCase();
      return keywords.some((kw) => haystack.includes(String(kw).toLowerCase()));
    });

    if (matchedRule) {
      const [, rule] = matchedRule;
      if (!p.rkm) p.rkm = {};
      if (!p.rkm.norms_override) p.rkm.norms_override = {};
      for (const opNo of rule.skipOperations || []) {
        p.rkm.norms_override[opNo] = { chel_ch: 0, mash_ch: 0 };
      }
      if (rule.k_reject != null) p.rkm.k_reject = rule.k_reject;
      if (rule.block_price != null) p.rkm.block_price = rule.block_price;
      if (rule.material_prices) p.rkm.material_prices = { ...rule.material_prices };
    }
  }

  return products;
}

/**
 * Parse JSON input file
 */
function parseJsonInput(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  // Legacy single-record format used by early prompts
  if (data && typeof data === 'object' && data.USER_INPUT) {
    throw new Error([
      'Обнаружен устаревший формат JSON (поле USER_INPUT).',
      'Используйте актуальный формат products[].',
      'См. README раздел "Формат входных данных" и примеры:',
      '  - examples/product_minimal.json',
      '  - examples/batch_small.json',
      '  - examples/batch_full.json'
    ].join('\n'));
  }
  
  // Support both { products: [...] } and single product or array
  if (data.products && Array.isArray(data.products)) {
    return data.products;
  }
  if (Array.isArray(data)) {
    return data;
  }
  // Single product
  return [data];
}

/**
 * Main entry point
 */
async function main() {
  if (args.help || !args.input) {
    printHelp();
    if (!args.input && !args.help) {
      console.error('ОШИБКА: не указан входной файл (--input)');
      process.exit(1);
    }
    return;
  }
  
  loadConfig({
    configDir: args['config-dir'] ? path.resolve(args['config-dir']) : null,
    configPath: args.config ? path.resolve(args.config) : null
  });

  const inputPath = path.resolve(args.input);
  const outputDir = path.resolve(args.output);
  
  if (!fs.existsSync(inputPath)) {
    console.error(`ОШИБКА: файл не найден: ${inputPath}`);
    process.exit(1);
  }
  
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║  Генератор ТК+МК для натурального камня v1.0  ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log(`\nВход: ${inputPath}`);
  console.log(`Выход: ${outputDir}`);
  
  let products;
  let rawInput;
  const ext = path.extname(inputPath).toLowerCase();
  
  if (ext === '.xlsx' || ext === '.xls') {
    console.log('Формат: Excel');
    rawInput = null;
    products = parseExcelInput(inputPath);
  } else if (ext === '.json') {
    console.log('Формат: JSON');
    rawInput = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    products = parseJsonInput(inputPath);
  } else {
    console.error(`ОШИБКА: неподдерживаемый формат файла: ${ext}. Используйте .json или .xlsx`);
    process.exit(1);
  }
  
  console.log(`Найдено изделий: ${products.length}`);

  const unknownUnitPolicy = args['unknown-unit-policy'] === 'error' ? 'error' : 'warning';
  const validationTarget = rawInput
    ? (Array.isArray(rawInput) || (rawInput && rawInput.products) ? rawInput : [rawInput])
    : products;
  const validationReport = validateBatchInput(validationTarget, { unknownUnitPolicy });
  console.log('\n=== Валидация входных данных ===');
  console.log(`Ошибки: ${validationReport.errors.length}, предупреждения: ${validationReport.warnings.length}`);
  validationReport.errors.forEach((e) => console.error(`  [ERROR] ${e}`));
  validationReport.warnings.forEach((w) => console.warn(`  [WARN] ${w}`));

  if (!validationReport.valid) {
    console.error('\nОШИБКА: входные данные не прошли валидацию.');
    process.exit(1);
  }
  if (args['validate-only']) {
    console.log('\n✓ Проверка завершена: ошибок нет. Генерация документов пропущена (--validate-only).');
    return;
  }

  const needCostCalculation = Boolean(args['cost-breakdown'] || args['export-cost']);
  let costs = [];
  if (needCostCalculation) {
    console.log('\n=== Расчёт стоимости ===');
    costs = products.map((product) => calculateTotalCost(product, {
      laborRatesPath: args['labor-rates-override'] ? path.resolve(args['labor-rates-override']) : null,
      equipmentCostsPath: args['equipment-costs-override'] ? path.resolve(args['equipment-costs-override']) : null,
      materialPricesPath: args['material-prices-override'] ? path.resolve(args['material-prices-override']) : null,
      overheadPath: args['overhead-override'] ? path.resolve(args['overhead-override']) : null
    }));

    if (args['cost-breakdown']) {
      for (const item of costs) {
        console.log(`\n[COST] ${item.product_name}`);
        console.log(`[COST] Прямые затраты: ${formatMoneyRu(item.total_direct_cost)} ₽`);
        console.log(`[COST] Накладные (${item.overhead_percent}%): ${formatMoneyRu(item.overhead_cost)} ₽`);
        console.log(`[COST] Полная себестоимость: ${formatMoneyRu(item.total_cost)} ₽`);
        console.log(`[COST] Цена продажи: ${formatMoneyRu(item.selling_price)} ₽ | Контрольная: ${formatMoneyRu(item.control_price)} ₽ | ${item.margin}`);
      }
    }

    if (args['export-cost']) {
      const exportPath = path.resolve(args['export-cost']);
      fs.mkdirSync(path.dirname(exportPath), { recursive: true });
      fs.writeFileSync(exportPath, JSON.stringify({ generated_at: new Date().toISOString(), products: costs }, null, 2), 'utf8');
      console.log(`[COST] Смета экспортирована: ${exportPath}`);
    }
  }

  // === Генерация ТК+МК (всегда) ===
  console.log('\n=== Генерация ТК+МК ===');
  const results = await generateBatch(products, outputDir, {
    overridesPath: args.overrides ? path.resolve(args.overrides) : null,
    validation: { unknownUnitPolicy }
  });
  const failed = results.filter(r => !r.success);
  if (failed.length > 0) {
    console.warn(`\n⚠ ${failed.length} ТК не сгенерированы (см. ошибки выше)`);
  }
  const successTK = results.filter(r => r.success).length;
  console.log(`\n✓ ТК+МК: ${successTK} из ${products.length} файлов`);


  if (args.summary) {
    console.log('\n=== Сводный отчёт по партии ===');
    const summary = await generateSummaryReport(products, results, outputDir);
    console.log(`✓ Сводный отчёт: ${summary.file}`);
  }

  // === Генерация РКМ (если --rkm) ===
  if (args.rkm) {
    const doOptimize = args.optimize;
    console.log('\n=== Генерация РКМ ===' + (doOptimize ? ' (с обратной калькуляцией)' : ''));
    let rkmOk = 0;
    let rkmFail = 0;
    let rkmConverged = 0;
    let rkmNotConverged = 0;
    let rkmNoPrice = 0;

    for (const product of products) {
      try {
        const result = await generateRKM(product, outputDir, { optimize: doOptimize });
        rkmOk++;
        if (doOptimize) {
          if (!product.control_price) {
            rkmNoPrice++;
          } else if (result.converged) {
            rkmConverged++;
          } else {
            rkmNotConverged++;
          }
        }
      } catch (err) {
        rkmFail++;
        console.error(`[RKM] Ошибка для поз.${product.tk_number}: ${err.message}`);
      }
    }
    console.log(`\n✓ РКМ: ${rkmOk} из ${products.length} файлов` + (rkmFail ? ` (ошибки: ${rkmFail})` : ''));
    if (doOptimize) {
      console.log(`  Оптимизация: ✅ сходимость ${rkmConverged}, ❌ не вошли в коридор ${rkmNotConverged}` + (rkmNoPrice ? `, без контрольной цены ${rkmNoPrice}` : ''));
    }
  }

  console.log('\n========== ГОТОВО ==========');
}

main().catch(err => {
  console.error(`Критическая ошибка: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
