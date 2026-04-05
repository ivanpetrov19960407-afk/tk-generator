/**
 * generator.js — Main document generator
 * Orchestrates the entire TK+MK document generation pipeline.
 */

const fs = require('fs');
const path = require('path');
const { buildOperations } = require('./operations');
const { buildAllSections, buildTitlePage } = require('./sections');
const { buildMKHeader, buildMKTableData } = require('./mk-table');
const { assembleDocument, Packer } = require('./docx-builder');
const { analyzeEquipment, calcProductMass, calcBlockMass, calcBatchMass } = require('./equipment');

/**
 * Validate product input data
 * @param {Object} product
 * @returns {Array} Array of error messages (empty if valid)
 */
function validateProduct(product) {
  const errors = [];
  
  if (!product.name) errors.push('Отсутствует название изделия (name)');
  if (!product.dimensions) errors.push('Отсутствуют размеры (dimensions)');
  else {
    if (!product.dimensions.length) errors.push('Отсутствует длина (dimensions.length)');
    if (!product.dimensions.width) errors.push('Отсутствует ширина (dimensions.width)');
    if (!product.dimensions.thickness) errors.push('Отсутствует толщина (dimensions.thickness)');
  }
  if (!product.material) errors.push('Отсутствует материал (material)');
  else {
    if (!product.material.type) errors.push('Отсутствует тип материала (material.type)');
    if (!product.material.name) errors.push('Отсутствует название материала (material.name)');
    if (!product.material.density) errors.push('Отсутствует плотность материала (material.density)');
  }
  if (!product.texture) errors.push('Отсутствует тип фактуры (texture)');
  else {
    const validTextures = ['лощение', 'рельефная_матовая', 'бучардирование_лощение'];
    if (!validTextures.includes(product.texture)) {
      errors.push(`Неизвестная фактура: "${product.texture}". Допустимые: ${validTextures.join(', ')}`);
    }
  }
  
  return errors;
}

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
    p.material.density = defaultDensities[p.material.type.toLowerCase()] || 2700;
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
  if (!p.short_name) {
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
async function generateDocument(product, outputDir) {
  // Apply defaults
  product = applyDefaults(product);
  
  // Validate
  const errors = validateProduct(product);
  if (errors.length > 0) {
    throw new Error(`Ошибки в данных продукта: \n  - ${errors.join('\n  - ')}`);
  }
  
  console.log(`  Генерация ТК для: ${product.name} (${product.texture})`);
  
  // 1. Build operations (Section 6)
  const { operations, warnings: opWarnings } = buildOperations(product);
  console.log(`  → ${operations.length} операций загружено`);
  
  // 2. Build sections
  const sectionData = buildAllSections(product);
  console.log(`  → Разделы 1-5, 7-13 сгенерированы`);
  
  // 3. Build MK
  const mkHeader = buildMKHeader(product);
  const mkRows = buildMKTableData(product);
  console.log(`  → МК таблица: ${mkRows.length} строк`);
  
  // 4. Equipment analysis
  const { warnings: equipWarnings } = analyzeEquipment(product);
  // Deduplicate warnings
  const allWarnings = [...new Set([...(opWarnings || []), ...(equipWarnings || [])])];
  
  if (allWarnings.length > 0) {
    console.log(`  ⚠ Предупреждения: ${allWarnings.length}`);
    allWarnings.forEach(w => console.log(`    - ${w}`));
  }
  
  // 5. Assemble DOCX
  const doc = assembleDocument({
    titlePageText: sectionData.title_page,
    sections: sectionData.sections,
    operations,
    mkHeaderText: mkHeader,
    mkRows,
    product,
    warnings: allWarnings
  });
  
  // 6. Generate buffer and write file
  const buffer = await Packer.toBuffer(doc);
  
  // Ensure output dir exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const filename = `TK_${String(product.tk_number).padStart(2, '0')}_${product.short_name}_${product.texture}.docx`;
  const filePath = path.join(outputDir, filename);
  fs.writeFileSync(filePath, buffer);
  
  const sizeKB = Math.round(buffer.length / 1024);
  console.log(`  → Файл: ${filename} (${sizeKB} КБ)`);
  
  return {
    filePath,
    filename,
    sizeKB,
    warnings: allWarnings,
    product
  };
}

/**
 * Generate multiple TK documents from a batch input
 * @param {Array} products - Array of product specifications
 * @param {string} outputDir - Output directory path
 * @returns {Array} Array of results
 */
async function generateBatch(products, outputDir) {
  console.log(`\nГенерация ${products.length} ТК документов...\n`);
  
  const results = [];
  
  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    console.log(`[${i + 1}/${products.length}] -------`);
    
    try {
      const result = await generateDocument(product, outputDir);
      results.push({ success: true, ...result });
    } catch (err) {
      console.error(`  ОШИБКА: ${err.message}`);
      results.push({ success: false, error: err.message, product });
    }
    
    console.log('');
  }
  
  // Summary
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log('========== ИТОГО ==========');
  console.log(`Успешно: ${successful.length}`);
  if (failed.length > 0) console.log(`Ошибки: ${failed.length}`);
  console.log(`Файлы сохранены в: ${path.resolve(outputDir)}`);
  
  if (successful.length > 0) {
    console.log('\nСгенерированные файлы:');
    successful.forEach(r => {
      console.log(`  ${r.filename} (${r.sizeKB} КБ)`);
    });
  }
  
  return results;
}

module.exports = {
  generateDocument,
  generateBatch,
  validateProduct,
  applyDefaults
};
