/**
 * generator.js — Main document generator
 * Orchestrates the entire TK+MK document generation pipeline.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { buildOperations } = require('./operations');
const { buildAllSections, buildTitlePage } = require('./sections');
const { buildMKHeader, buildMKTableData } = require('./mk-table');
const { assembleDocument, Packer } = require('./docx-builder');
const { analyzeEquipment, calcProductMass, calcBlockMass, calcBatchMass } = require('./equipment');
const { validateProductOrThrow } = require('./validation/validator');
const { logger } = require('./logger');
const { Profiler } = require('./utils/perf');
const { hashInput, createManifest } = require('./utils/cache');

/**
 * Apply defaults to a product spec
 */
function applyDefaults(product) {
  const p = { ...product };
  
  // Default density based on material type
  if (p.material && !p.material.density) {
    const defaultDensities = {
      'мрамор': 2700,
      'гранит': 2700,
      'известняк': 2400,
      'травертин': 2500,
      'песчаник': 2300,
      'сланец': 2700,
      'оникс': 2700
    };
    p.material.density = (p.material.type ? defaultDensities[p.material.type.toLowerCase()] : null) || 2700;
  }
  
  // Default quantity_pieces from quantity if not specified
  if (p.quantity && !p.quantity_pieces && p.dimensions) {
    const areaMatch = p.quantity.match(/([\d,]+)/);
    if (areaMatch) {
      const area = parseFloat(areaMatch[1].replace(',', '.'));
      const pieceArea = (p.dimensions.length / 1000) * (p.dimensions.width / 1000);
      if (pieceArea > 0) {
        p.quantity_pieces = Math.ceil(area / pieceArea);
      }
    }
  }
  
  // Default edges text
  if (!p.edges) p.edges = 'калибровка по всем сторонам';
  
  // Default packaging
  if (!p.packaging) p.packaging = 'стандартная';
  
  // Default category
  if (!p.category) p.category = '1';
  
  // Default GOST
  if (!p.gost_primary) p.gost_primary = 'ГОСТ 9480-2024';
  
  // Default short_name
  if (!p.short_name && p.name) {
    p.short_name = p.name.toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-zа-яёA-ZА-ЯЁ0-9_]/g, '')
      .substring(0, 40);
  }
  
  // Default tk_number
  if (!p.tk_number) p.tk_number = 1;
  
  return p;
}

/**
 * Generate a single TK+MK document for a product
 * @param {Object} product - Product specification
 * @param {string} outputDir - Output directory path
 * @returns {Object} { filePath, warnings, pageEstimate }
 */
async function generateDocument(product, outputDir, options = {}) {
  const log = options.logger || logger;
  const profileEnabled = Boolean(options.profile);
  const profiler = options.profiler || new Profiler(profileEnabled);
  // Apply defaults
  product = applyDefaults(product);
  
  // Validate
  await profiler.measure('tk.validate', async () => validateProductOrThrow(product, options.validation || {}));
  
  log.info({ tkNumber: product.tk_number, product: product.name, texture: product.texture }, 'Генерация ТК');
  
  // 1. Build operations (Section 6)
  const { operations, warnings: opWarnings } = await profiler.measure('tk.buildOperations', async () => buildOperations(product, options));
  log.debug({ tkNumber: product.tk_number, operations: operations.length }, 'Операции загружены');
  
  // 2. Build sections
  const sectionData = await profiler.measure('tk.buildSections', async () => buildAllSections(product));
  log.debug({ tkNumber: product.tk_number }, 'Разделы 1-5, 7-11 сгенерированы');
  
  // 3. Build MK
  const mkHeader = await profiler.measure('tk.buildMKHeader', async () => buildMKHeader(product));
  const mkRows = await profiler.measure('tk.buildMKRows', async () => buildMKTableData(product));
  log.debug({ tkNumber: product.tk_number, mkRows: mkRows.length }, 'Таблица МК сформирована');
  
  // 4. Equipment analysis
  const { warnings: equipWarnings } = await profiler.measure('tk.analyzeEquipment', async () => analyzeEquipment(product));
  // Deduplicate warnings
  const allWarnings = [...new Set([...(opWarnings || []), ...(equipWarnings || [])])];
  
  if (allWarnings.length > 0) {
    log.warn({ tkNumber: product.tk_number, warnings: allWarnings }, 'Предупреждения при генерации ТК');
  }
  
  // 5. Assemble DOCX
  const doc = await profiler.measure('tk.assembleDocument', async () => assembleDocument({
    titlePageText: sectionData.title_page,
    sections: sectionData.sections,
    operations,
    mkHeaderText: mkHeader,
    mkRows,
    product,
    warnings: allWarnings
  }));
  
  // 6. Generate buffer and write file
  const buffer = await profiler.measure('tk.packDocx', async () => Packer.toBuffer(doc));
  
  // Ensure output dir exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const filename = `TK_${String(product.tk_number).padStart(2, '0')}_${product.short_name}_${product.texture}.docx`;
  const filePath = path.join(outputDir, filename);
  await profiler.measure('tk.writeDocx', async () => fs.writeFileSync(filePath, buffer));
  
  const sizeKB = Math.round(buffer.length / 1024);
  log.info({ tkNumber: product.tk_number, filename, sizeKB }, 'Файл ТК сохранён');
  
  return {
    filePath,
    filename,
    sizeKB,
    warnings: allWarnings,
    product,
    profile: profiler.summary()
  };
}

/**
 * Generate multiple TK documents from a batch input
 * @param {Array} products - Array of product specifications
 * @param {string} outputDir - Output directory path
 * @returns {Array} Array of results
 */
async function generateBatch(products, outputDir, options = {}) {
  const log = options.logger || logger;
  const concurrency = Math.max(1, Number(options.concurrency || Math.min(8, Math.max(2, os.cpus().length))));
  const profileEnabled = Boolean(options.profile);
  const useCache = options.cache !== false;
  const manifest = useCache ? createManifest(outputDir, '.tk-cache.json') : null;
  log.info({ total: products.length }, 'Генерация ТК документов');
  log.info({ concurrency, cache: useCache }, 'Параметры пакетной генерации ТК');
  
  const results = new Array(products.length);
  let index = 0;

  async function worker() {
    while (true) {
      const i = index++;
      if (i >= products.length) break;
      const rawProduct = products[i];
      const product = applyDefaults(rawProduct);
      const filename = `TK_${String(product.tk_number).padStart(2, '0')}_${product.short_name}_${product.texture}.docx`;
      const filePath = path.join(outputDir, filename);
      const cacheKey = `tk:${product.tk_number}:${product.short_name}:${product.texture}`;
      const inputHash = hashInput({ product, validation: options.validation || {} });
      log.debug({ current: i + 1, total: products.length, tkNumber: product.tk_number }, 'Обработка позиции');

      if (manifest && manifest.hasFresh(cacheKey, inputHash, filePath)) {
        results[i] = { success: true, filePath, filename, sizeKB: Math.round(fs.statSync(filePath).size / 1024), product, cached: true };
        continue;
      }

      try {
        const profiler = new Profiler(profileEnabled);
        const result = await generateDocument(product, outputDir, { ...options, profiler });
        results[i] = { success: true, ...result, cached: false };
        if (manifest) manifest.update(cacheKey, inputHash, result.filePath);
      } catch (err) {
        log.error({ tkNumber: product.tk_number, error: err.message }, 'Ошибка генерации ТК');
        results[i] = { success: false, error: err.message, product };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, products.length || 1) }, () => worker()));
  if (manifest) manifest.flush();
  
  // Summary
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const cached = successful.filter(r => r.cached).length;
  
  log.info({
    success: successful.length,
    failed: failed.length,
    outputDir: path.resolve(outputDir),
    cached
  }, 'Итоги генерации ТК');
  
  if (successful.length > 0) {
    log.debug({ files: successful.map(r => ({ filename: r.filename, sizeKB: r.sizeKB })) }, 'Сгенерированные файлы');
  }
  
  return results;
}

module.exports = {
  generateDocument,
  generateBatch,
  applyDefaults
};
