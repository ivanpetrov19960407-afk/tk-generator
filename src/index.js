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
const { generateRKMBatch } = require('./rkm/rkm-generator');
const { nowMs } = require('./utils/perf');
const { calculateTotalCost, formatMoneyRu } = require('./cost-calculator');
const { write1CXml, write1CCsv } = require('./export-1c');
const { normalizeUnit } = require('./utils/unit-normalizer');
const { SUPPORTED_TEXTURES } = require('./textures');
const { validateBatchInput } = require('./validation/validator');
const { loadConfig, getConfig } = require('./config');
const { generateSummaryReport } = require('./summary-report');
const { configureLogger, logger, LEVELS } = require('./logger');
const { createRepository } = require('./db/repository');
const { checkForStandaloneUpdate, performStandaloneSelfUpdate } = require('./self-update');

const args = minimist(process.argv.slice(2), {
  alias: {
    i: 'input',
    o: 'output',
    h: 'help',
    e: 'export-cost'
  },
  boolean: ['rkm', 'optimize', 'cost-breakdown', 'validate-only', 'summary', 'profile', 'cache', 'export-1c', 'export-1c-csv', 'watch', 'check-update', 'self-update'],
  default: {
    output: 'output/',
    rkm: false,
    optimize: false,
    'cost-breakdown': false,
    'validate-only': false,
    summary: false,
    cache: true,
    watch: false,
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
      --export-1c        Экспорт калькуляций в 1С-совместимый XML
      --export-1c-csv    Экспорт калькуляций в упрощённый CSV для 1С
      --profile          Вывести timing по этапам генерации
      --no-cache         Отключить кэширование неизменённых позиций
      --concurrency <n>  Число параллельных задач в пакетной генерации
      --unknown-unit-policy <warning|error> Политика для нераспознанных единиц
  -e, --export-cost <file.json> Экспорт сметы по всем изделиям в JSON
      --labor-rates-override <file.json> Переопределить тарифы труда
      --equipment-costs-override <file.json> Переопределить тарифы оборудования
      --material-prices-override <file.json> Переопределить цены материалов
      --overhead-override <file.json> Переопределить накладные расходы
      --overrides <file.json>   Переопределить операции через rules JSON
      --config <file.json|yaml> Дополнительный конфиг поверх default/local
      --config-dir <dir>        Папка с default.json и local.json
      --log-level <error|warn|info|debug> Уровень логирования
      --log-file <path>         Дублировать логи в файл
      --template <path.docx>    Пользовательский DOCX-шаблон для ТК+МК
      --watch                   Режим разработки: следить за файлами и перегенерировать 1 тестовую позицию
      --check-update            Проверить наличие новой версии standalone
      --self-update             Скачать свежий standalone-бинарник из GitHub Releases
      --history                 Показать историю генераций (последние 20 запусков)
      --history-detail <id>     Показать детали запуска по ID
      --stats                   Показать агрегированную статистику генераций
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

  # Экспорт в 1С-совместимый XML/CSV
  tk-generator --input examples/batch_small.json --export-1c --export-1c-csv

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
      logger.warn({ dimensions: dimStr }, 'Толщина не найдена, используется 30мм по умолчанию');
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

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean).map((p) => path.resolve(p)))];
}

function createWatchTargets(inputPath) {
  return uniquePaths([
    inputPath,
    path.resolve('data'),
    path.resolve('config'),
    path.resolve('templates')
  ]);
}

function formatElapsedMs(ms) {
  return `${Math.round(ms)}мс`;
}

async function runGenerationCycle({ inputPath, outputDir, watchMode = false }) {
  const runStartedAt = nowMs();
  loadConfig({
    configDir: args['config-dir'] ? path.resolve(args['config-dir']) : null,
    configPath: args.config ? path.resolve(args.config) : null
  });

  let products;
  let rawInput;
  const ext = path.extname(inputPath).toLowerCase();

  if (ext === '.xlsx' || ext === '.xls') {
    logger.info('Формат: Excel');
    rawInput = null;
    products = parseExcelInput(inputPath);
  } else if (ext === '.json') {
    logger.info('Формат: JSON');
    rawInput = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    products = parseJsonInput(inputPath);
  } else {
    throw new Error(`Неподдерживаемый формат файла: ${ext}. Используйте .json или .xlsx`);
  }

  if (!products.length) {
    throw new Error('Входной файл не содержит позиций для генерации');
  }

  const effectiveProducts = watchMode ? [products[0]] : products;
  logger.info({ totalProducts: products.length, effectiveProducts: effectiveProducts.length }, 'Входные данные загружены');

  const unknownUnitPolicy = args['unknown-unit-policy'] === 'error' ? 'error' : 'warning';
  const validationTarget = rawInput
    ? (Array.isArray(rawInput) || (rawInput && rawInput.products) ? rawInput : [rawInput])
    : products;
  const validationReport = validateBatchInput(validationTarget, { unknownUnitPolicy });
  logger.info({
    validationErrors: validationReport.errors.length,
    validationWarnings: validationReport.warnings.length
  }, 'Валидация входных данных');
  validationReport.errors.forEach((e) => logger.error({ validationError: e }, 'Ошибка валидации'));
  validationReport.warnings.forEach((w) => logger.warn({ validationWarning: w }, 'Предупреждение валидации'));

  if (!validationReport.valid) {
    throw new Error('Входные данные не прошли валидацию');
  }
  if (args['validate-only']) {
    logger.info('Проверка завершена: ошибок нет. Генерация документов пропущена (--validate-only)');
    return;
  }

  const needCostCalculation = Boolean(args['cost-breakdown'] || args['export-cost'] || args['export-1c'] || args['export-1c-csv']);
  let costs = [];
  if (needCostCalculation) {
    logger.info('Расчёт стоимости');
    costs = effectiveProducts.map((product) => calculateTotalCost(product, {
      laborRatesPath: args['labor-rates-override'] ? path.resolve(args['labor-rates-override']) : null,
      equipmentCostsPath: args['equipment-costs-override'] ? path.resolve(args['equipment-costs-override']) : null,
      materialPricesPath: args['material-prices-override'] ? path.resolve(args['material-prices-override']) : null,
      overheadPath: args['overhead-override'] ? path.resolve(args['overhead-override']) : null
    }));

    if (args['cost-breakdown']) {
      for (const item of costs) {
        logger.info({
          productName: item.product_name,
          totalDirectCost: item.total_direct_cost,
          overheadPercent: item.overhead_percent,
          overheadCost: item.overhead_cost,
          totalCost: item.total_cost,
          sellingPrice: item.selling_price,
          controlPrice: item.control_price,
          margin: item.margin
        }, 'Смета по изделию');
      }
    }

    if (args['export-cost']) {
      const exportPath = path.resolve(args['export-cost']);
      fs.mkdirSync(path.dirname(exportPath), { recursive: true });
      fs.writeFileSync(exportPath, JSON.stringify({ generated_at: new Date().toISOString(), products: costs }, null, 2), 'utf8');
      logger.info({ exportPath }, 'Смета экспортирована');
    }

    if (args['export-1c']) {
      const exportPath = write1CXml(effectiveProducts, costs, outputDir);
      logger.info({ exportPath }, 'Калькуляции экспортированы в 1С XML');
    }

    if (args['export-1c-csv']) {
      const exportPath = write1CCsv(effectiveProducts, costs, outputDir);
      logger.info({ exportPath }, 'Калькуляции экспортированы в 1С CSV');
    }
  }

  logger.info('Генерация ТК+МК');
  const generationStart = nowMs();
  const results = await generateBatch(effectiveProducts, outputDir, {
    overridesPath: args.overrides ? path.resolve(args.overrides) : null,
    validation: { unknownUnitPolicy },
    logger,
    profile: Boolean(args.profile),
    cache: args.cache !== false,
    concurrency: args.concurrency ? Number(args.concurrency) : null,
    templatePath: args.template ? path.resolve(args.template) : null
  });
  const tkElapsedMs = nowMs() - generationStart;
  const failed = results.filter(r => !r.success);
  const tkCached = results.filter(r => r.success && r.cached).length;
  const errorByPosition = new Map();
  for (const fail of failed) {
    const pos = fail.product && fail.product.tk_number ? fail.product.tk_number : 'n/a';
    if (!errorByPosition.has(pos)) errorByPosition.set(pos, []);
    errorByPosition.get(pos).push(`ТК: ${fail.error}`);
  }

  if (args.summary && !watchMode) {
    logger.info('Сводный отчёт по партии');
    const summary = await generateSummaryReport(effectiveProducts, results, outputDir);
    logger.info({ file: summary.file }, 'Сводный отчёт сформирован');
  }

  if (args.rkm || watchMode) {
    const doOptimize = args.optimize;
    logger.info({ optimize: doOptimize, watchMode }, 'Генерация РКМ');
    let rkmOk = 0;
    let rkmFail = 0;
    let rkmConverged = 0;
    let rkmNotConverged = 0;
    let rkmNoPrice = 0;

    const rkmBatchStart = nowMs();
    const rkmResults = await generateRKMBatch(effectiveProducts, outputDir, {
      optimize: doOptimize,
      logger,
      profile: Boolean(args.profile),
      cache: args.cache !== false,
      concurrency: args.concurrency ? Number(args.concurrency) : null
    });
    const rkmElapsedMs = nowMs() - rkmBatchStart;
    const rkmCached = rkmResults.filter((r) => r.success && r.cached).length;

    for (let i = 0; i < effectiveProducts.length; i++) {
      const product = effectiveProducts[i];
      const result = rkmResults[i];
      if (result && result.success) {
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
      } else {
        rkmFail++;
        if (!errorByPosition.has(product.tk_number)) errorByPosition.set(product.tk_number, []);
        errorByPosition.get(product.tk_number).push(`РКМ: ${result ? result.error : 'неизвестная ошибка'}`);
      }
    }
    logger.info({ successRkm: rkmOk, total: effectiveProducts.length, failedRkm: rkmFail, cached: rkmCached, elapsedMs: Math.round(rkmElapsedMs) }, 'Итоги генерации РКМ');
    if (doOptimize) {
      logger.info({ converged: rkmConverged, notConverged: rkmNotConverged, noControlPrice: rkmNoPrice }, 'Итоги оптимизации');
    }
    if (args.profile) {
      const perStage = {};
      for (const row of rkmResults) {
        if (!row || !row.profile || !row.profile.stages) continue;
        for (const [stage, ms] of Object.entries(row.profile.stages)) {
          perStage[stage] = (perStage[stage] || 0) + ms;
        }
      }
      logger.info({ profile: { elapsedMs: Math.round(rkmElapsedMs), stages: perStage } }, 'PROFILE RKM');
    }
  }

  if (args.profile) {
    const tkStages = {};
    for (const row of results) {
      if (!row || !row.profile || !row.profile.stages) continue;
      for (const [stage, ms] of Object.entries(row.profile.stages)) {
        tkStages[stage] = (tkStages[stage] || 0) + ms;
      }
    }
    logger.info({ profile: { elapsedMs: Math.round(tkElapsedMs), cached: tkCached, stages: tkStages } }, 'PROFILE TK');
  }

  const failedPositions = [...errorByPosition.keys()];
  const failedCount = failedPositions.length;
  const successCount = effectiveProducts.length - failedCount;
  logger.info(
    { total: effectiveProducts.length, success: successCount, failed: failedCount },
    `${effectiveProducts.length} позиции: ${successCount} успешно, ${failedCount} с ошибками`
  );
  if (failedCount > 0) {
    for (const [pos, errors] of errorByPosition.entries()) {
      logger.error({ position: pos, errors }, `Позиция ${pos}: ${errors.join('; ')}`);
    }
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }

  const repository = createRepository();
  const generationId = repository.saveGeneration({
    timestamp: new Date().toISOString(),
    input_file: inputPath,
    products_count: effectiveProducts.length,
    success_count: successCount,
    error_count: failedCount,
    duration_ms: Math.round(nowMs() - runStartedAt),
    output_dir: outputDir
  });

  for (let i = 0; i < effectiveProducts.length; i++) {
    const product = effectiveProducts[i];
    const tkResult = results[i];
    const messages = errorByPosition.get(product.tk_number) || [];
    repository.saveGenerationItem({
      generation_id: generationId,
      position: Number(product.tk_number || i + 1),
      product_name: product.name || null,
      material: product.material && product.material.name ? product.material.name : null,
      texture: product.texture || null,
      status: messages.length > 0 ? 'error' : 'success',
      error_message: messages.length > 0 ? messages.join('; ') : null,
      output_files: tkResult && tkResult.success && tkResult.filePath ? [tkResult.filePath] : []
    });
  }

  repository.saveAuditLog({
    action: 'cli.generate',
    user: process.env.USER || process.env.USERNAME || 'cli',
    details: { generationId, inputPath, outputDir, watchMode },
    ip: 'local'
  });
}

function runWatchMode({ inputPath, outputDir }) {
  const targets = createWatchTargets(inputPath);
  logger.info({
    targets,
    testPosition: 1
  }, 'Watch mode включён: генерируется только первая позиция (DOCX + XLSX)');

  let isRunning = false;
  let timer = null;
  let pendingFiles = new Set();

  const triggerGeneration = async () => {
    if (isRunning) return;
    isRunning = true;
    const changedFiles = [...pendingFiles];
    pendingFiles = new Set();
    const start = nowMs();
    logger.info({ changedFiles }, 'Изменения обнаружены, запускаем регенерацию');
    try {
      await runGenerationCycle({ inputPath, outputDir, watchMode: true });
      logger.info({ elapsed: formatElapsedMs(nowMs() - start), changedFiles }, 'Watch-регенерация завершена');
    } catch (error) {
      logger.error({
        elapsed: formatElapsedMs(nowMs() - start),
        changedFiles,
        error: error.message
      }, 'Watch-регенерация завершилась с ошибкой');
    } finally {
      isRunning = false;
      if (pendingFiles.size > 0) {
        triggerGeneration().catch((error) => {
          logger.error({ error: error.message }, 'Ошибка отложенной watch-регенерации');
        });
      }
    }
  };

  const schedule = (changedPath) => {
    pendingFiles.add(changedPath);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      triggerGeneration().catch((error) => {
        logger.error({ error: error.message }, 'Ошибка watch-регенерации');
      });
    }, 200);
  };

  for (const target of targets) {
    if (!fs.existsSync(target)) {
      logger.warn({ target }, 'Путь для watch не найден, пропускаем');
      continue;
    }
    const stat = fs.statSync(target);
    const watchTarget = stat.isDirectory() ? target : path.dirname(target);
    fs.watch(watchTarget, { persistent: true }, (eventType, filename) => {
      const changedPath = filename ? path.resolve(watchTarget, String(filename)) : watchTarget;
      schedule(changedPath);
      logger.debug({ eventType, changedPath }, 'watch event');
    });
  }

  runGenerationCycle({ inputPath, outputDir, watchMode: true }).then(() => {
    logger.info('Начальная watch-генерация завершена, ожидаем изменения...');
  }).catch((error) => {
    logger.error({ error: error.message }, 'Ошибка начальной watch-генерации');
  });
}


async function handleStandaloneUpdateCli() {
  const currentVersion = require('../package.json').version;

  if (args['check-update']) {
    const update = await checkForStandaloneUpdate({ currentVersion });
    if (update.hasUpdate) {
      logger.info({ currentVersion: update.currentVersion, latestVersion: update.latestVersion }, 'Доступно обновление standalone');
      console.log(`Доступна версия ${update.latestVersion}. Текущая: ${update.currentVersion}.`);
      return 10;
    }
    console.log(`Обновлений нет. Текущая версия ${update.currentVersion}.`);
    return 0;
  }

  if (args['self-update']) {
    const result = await performStandaloneSelfUpdate({ currentVersion });
    logger.info({
      currentVersion: result.currentVersion,
      latestVersion: result.latestVersion,
      preparedPath: result.preparedPath || null
    }, 'Self-update standalone');
    console.log(result.message);
    return result.updated ? 10 : 0;
  }

  return null;
}

/**
 * Main entry point
 */
async function main() {
  configureLogger({
    level: String(args['log-level'] || 'info').toLowerCase(),
    logFile: args['log-file'] || null
  });

  if (args['log-level'] && !LEVELS.includes(String(args['log-level']).toLowerCase())) {
    throw new Error(`Некорректный --log-level="${args['log-level']}". Допустимо: ${LEVELS.join(', ')}`);
  }

  if (args.history || args['history-detail'] || args.stats) {
    const repository = createRepository();
    if (args.history) {
      const data = repository.getGenerations({ page: Number(args.page || 1), pageSize: Number(args.limit || 20) });
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    if (args['history-detail']) {
      const item = repository.getGenerationById(Number(args['history-detail']));
      if (!item) throw new Error(`Запуск с id=${args['history-detail']} не найден`);
      console.log(JSON.stringify(item, null, 2));
      return;
    }
    if (args.stats) {
      const stats = repository.getStats({ from: args.from || null, to: args.to || null });
      console.log(JSON.stringify(stats, null, 2));
      return;
    }
  }

  const updateExitCode = await handleStandaloneUpdateCli();
  if (updateExitCode != null) {
    process.exitCode = updateExitCode;
    return;
  }

  if (args.help || !args.input) {
    printHelp();
    if (!args.input && !args.help) {
      throw new Error('Не указан входной файл (--input)');
    }
    return;
  }
  
  const inputPath = path.resolve(args.input);
  const outputDir = path.resolve(args.output);
  
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Файл не найден: ${inputPath}`);
  }
  
  logger.info({ inputPath, outputDir }, 'Запуск tk-generator');

  if (args.template) {
    const templatePath = path.resolve(args.template);
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Шаблон не найден: ${templatePath}`);
    }
    logger.info({ templatePath }, 'Используется пользовательский шаблон DOCX');
  }
  
  if (args.watch) {
    runWatchMode({ inputPath, outputDir });
    return;
  }

  await runGenerationCycle({ inputPath, outputDir, watchMode: false });
}

main().catch(err => {
  logger.error({ error: err.message, stack: err.stack }, 'Критическая ошибка');
  process.exit(2);
});
