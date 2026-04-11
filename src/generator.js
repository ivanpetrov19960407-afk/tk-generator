// @ts-check
/**
 * generator.js — Main document generator
 * Orchestrates the entire TK+MK document generation pipeline.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { buildOperations } = require('./operations');
const { buildAllSections } = require('./sections');
const { buildMKHeader, buildMKTableData } = require('./mk-table');
const { assembleDocument, Packer } = require('./docx-builder');
const { buildPdfBuffer } = require('./pdf-builder');
const { renderTemplateDocx } = require('./template-engine');
const { analyzeEquipment } = require('./equipment');
const { validateProductOrThrow } = require('./validation/validator');
const { logger } = require('./logger');
const { Profiler } = require('./utils/perf');
const { hashInput, createManifest } = require('./utils/cache');
const { getDefaultDensityByMaterialType } = require('./plugin-registry');
const { sanitizeName, ensureSafePath } = require('./utils/security');

/** @typedef {import('./types').Product} Product */
/** @typedef {import('./types').GenerationResult} GenerationResult */

/**
 * Normalize output formats from CLI/API options.
 * @param {string|string[]|undefined|null} formatOption
 * @returns {Array<'docx'|'pdf'>}
 */
function normalizeFormats(formatOption) {
  const raw = Array.isArray(formatOption) ? formatOption.join(',') : (formatOption || 'docx');
  const formats = [...new Set(String(raw).split(',').map((f) => f.trim().toLowerCase()).filter(Boolean))];
  const allowed = new Set(['docx', 'pdf']);
  const invalid = formats.filter((f) => !allowed.has(f));
  if (invalid.length) throw new Error(`Неподдерживаемый формат: ${invalid.join(', ')}`);
  return formats.length ? formats : ['docx'];
}

/**
 * Apply defaults to a product spec
 * @param {Product} product
 * @returns {Product}
 */
function applyDefaults(product) {
  const p = { ...product };
  
  // Default density based on material type
  if (p.material && !p.material.density) {
    p.material.density = getDefaultDensityByMaterialType(p.material.type) || 2700;
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
 * @param {Product} product - Product specification
 * @param {string} outputDir - Output directory path
 * @param {{
 *   logger?: { info: Function; warn: Function; debug: Function; error: Function };
 *   profile?: boolean;
 *   profiler?: { measure: <T>(name: string, fn: () => Promise<T>) => Promise<T>; summary: () => Record<string, unknown> };
 *   validation?: Record<string, unknown>;
 *   format?: string|string[];
 *   templatePath?: string;
 * }} [options]
 * @returns {Promise<GenerationResult>}
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
  
  const formats = normalizeFormats(options.format);

  // Ensure output dir exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const files = [];

  if (formats.includes('docx')) {
    const docxBuffer = options.templatePath
      ? await profiler.measure('tk.renderTemplate', async () => renderTemplateDocx(options.templatePath, {
          product,
          sections: sectionData.sections,
          operations,
          mkRows,
          warnings: allWarnings,
          mk_header: mkHeader,
          title_page: sectionData.title_page
        }))
      : await profiler.measure('tk.packDocx', async () => {
          const doc = assembleDocument({
            titlePageText: sectionData.title_page,
            sections: sectionData.sections,
            operations,
            mkHeaderText: mkHeader,
            mkRows,
            product,
            warnings: allWarnings
          });
          return Packer.toBuffer(doc);
        });

    const safeShortName = sanitizeName(product.short_name || `pos_${String(product.tk_number).padStart(2, '0')}`);
    const safeTexture = sanitizeName(product.texture || 'texture');
    const filename = `TK_${String(product.tk_number).padStart(2, '0')}_${safeShortName}_${safeTexture}.docx`;
    const filePath = ensureSafePath(outputDir, filename).finalPath;
    await profiler.measure('tk.writeDocx', async () => fs.writeFileSync(filePath, docxBuffer));
    files.push({ format: 'docx', filePath, filename, sizeKB: Math.round(docxBuffer.length / 1024) });
  }

  if (formats.includes('pdf')) {
    const pdfBuffer = await profiler.measure('tk.packPdf', async () => buildPdfBuffer({
      titlePageText: sectionData.title_page,
      sections: sectionData.sections,
      operations,
      mkHeaderText: mkHeader,
      mkRows,
      product,
      warnings: allWarnings
    }, options));
    const safeShortName = sanitizeName(product.short_name || `pos_${String(product.tk_number).padStart(2, '0')}`);
    const safeTexture = sanitizeName(product.texture || 'texture');
    const filename = `TK_${String(product.tk_number).padStart(2, '0')}_${safeShortName}_${safeTexture}.pdf`;
    const filePath = ensureSafePath(outputDir, filename).finalPath;
    await profiler.measure('tk.writePdf', async () => fs.writeFileSync(filePath, pdfBuffer));
    files.push({ format: 'pdf', filePath, filename, sizeKB: Math.round(pdfBuffer.length / 1024) });
  }

  const primary = files[0];
  log.info({ tkNumber: product.tk_number, files: files.map((f) => ({ format: f.format, filename: f.filename, sizeKB: f.sizeKB })) }, 'Файлы ТК сохранены');

  return {
    filePath: primary ? primary.filePath : null,
    filename: primary ? primary.filename : null,
    sizeKB: primary ? primary.sizeKB : 0,
    files,
    warnings: allWarnings,
    product,
    profile: profiler.summary()
  };
}

/**
 * Generate multiple TK documents from a batch input
 * @param {Product[]} products - Array of product specifications
 * @param {string} outputDir - Output directory path
 * @param {{
 *   logger?: { info: Function; warn: Function; debug: Function; error: Function };
 *   profile?: boolean;
 *   cache?: boolean;
 *   concurrency?: number;
 *   validation?: Record<string, unknown>;
 *   format?: string|string[];
 * }} [options]
 * @returns {Promise<Array<GenerationResult & { success: boolean; cached?: boolean; error?: string }>>}
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
      const formats = normalizeFormats(options.format);
      const expectedFiles = formats.map((format) => {
        const ext = format === 'pdf' ? 'pdf' : 'docx';
        const safeShortName = sanitizeName(product.short_name || `pos_${String(product.tk_number).padStart(2, '0')}`);
        const safeTexture = sanitizeName(product.texture || 'texture');
        const filename = `TK_${String(product.tk_number).padStart(2, '0')}_${safeShortName}_${safeTexture}.${ext}`;
        return { format, filename, filePath: ensureSafePath(outputDir, filename).finalPath };
      });
      const cacheKey = `tk:${product.tk_number}:${product.short_name}:${product.texture}:${formats.join('+')}`;
      const inputHash = hashInput({ product, validation: options.validation || {} });
      log.debug({ current: i + 1, total: products.length, tkNumber: product.tk_number }, 'Обработка позиции');

      if (manifest && expectedFiles.every((item) => manifest.hasFresh(cacheKey, inputHash, item.filePath))) {
        const files = expectedFiles.filter((item) => fs.existsSync(item.filePath)).map((item) => ({
          format: item.format,
          filename: item.filename,
          filePath: item.filePath,
          sizeKB: Math.round(fs.statSync(item.filePath).size / 1024)
        }));
        const primary = files[0] || null;
        results[i] = { success: true, filePath: primary && primary.filePath, filename: primary && primary.filename, sizeKB: primary ? primary.sizeKB : 0, files, product, cached: true };
        continue;
      }

      try {
        const profiler = new Profiler(profileEnabled);
        const result = await generateDocument(product, outputDir, { ...options, profiler, format: formats });
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
  applyDefaults,
  normalizeFormats
};
