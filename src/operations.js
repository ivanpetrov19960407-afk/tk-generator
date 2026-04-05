/**
 * operations.js — Operation text builder with parametric substitution
 * 
 * Takes template operation texts from operations_library.json and replaces
 * product-specific parameters (dimensions, material, quantities, etc.)
 */

const fs = require('fs');
const path = require('path');
const { calcProductMass, calcBlockMass, calcBatchMass, analyzeEquipment } = require('./equipment');

const operationsLibrary = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'operations_library.json'), 'utf8')
);

// Known template product dimensions per texture type (for replacement)
const TEMPLATE_PRODUCTS = {
  'лощение': {
    dims: '700×700×30',
    dimsRegex: /700×700×30/g,
    length: 700, width: 700, thickness: 30,
    twoD: '700×700',
    twoDRegex: /700×700/g,
    material: 'Delikato light',
    density: 1600,  // NOTE: лощение template used wrong density 1600
    productName: 'плита напольная',
    pieceMassApprox: 40,    // ~40 kg in template
    pieceMassExact: 34,     // some ops use 34 kg
    blockMass: 7.2,         // template block mass (t)
    batchPieces: 29,
    batchArea: '14,1',
    batchMassTotal: 986,    // 29 × 34 kg
    quantity: '14,1 кв.м.',
    edgesText: 'фаски 5мм по четырём сторонам'
  },
  'рельефная_матовая': {
    dims: '430×430×98',
    dimsRegex: /430×430×98/g,
    length: 430, width: 430, thickness: 98,
    twoD: '430×430',
    twoDRegex: /430×430/g,
    material: 'Delikato light',
    density: 2700,
    productName: 'сегмент радиусный',
    pieceMassApprox: null,
    blockMass: 12.2,
    batchPieces: 16,
    batchArea: null,
    quantity: null,
    edgesText: null
  },
  'бучардирование_лощение': {
    dims: '600×300×20',
    dimsRegex: /600×300×20/g,
    length: 600, width: 300, thickness: 20,
    twoD: '600×300',
    twoDRegex: /600×300/g,
    // Also uses 620×320×25 as rough dimension with allowance
    roughDims: '620×320×25',
    roughDimsRegex: /620×320×25/g,
    roughTwoD: '620×320',
    roughTwoDRegex: /620×320/g,
    roughThickness: '620×320×20',
    material: 'Delikato light',
    density: 2700,
    productName: 'плита облицовочная',
    pieceMassApprox: null,
    blockMass: 12.96,
    batchPieces: null,
    batchArea: null,
    quantity: null,
    edgesText: null
  }
};

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parametric substitution engine.
 * Replaces template-specific values with actual product values.
 * 
 * IMPORTANT: Does NOT change:
 *   - Cross-references (Операция №N)
 *   - Block dimensions (3200×1500×1000) — standard input block
 *   - Equipment model names
 *   - GOST references
 */
function parametrize(text, product, textureKey) {
  const tpl = TEMPLATE_PRODUCTS[textureKey];
  if (!tpl) return text;

  const dims = product.dimensions;
  const newDims = `${dims.length}×${dims.width}×${dims.thickness}`;
  const newTwoD = `${dims.length}×${dims.width}`;
  const newMaterial = product.material.name;
  const newDensity = product.material.density;
  
  // Calculate derived values
  const pieceMass = calcProductMass(product);
  const blockMass = calcBlockMass(product);
  const blockMassT = (blockMass / 1000).toFixed(1).replace('.', ',');
  const batchMass = calcBatchMass(product);

  // 1. Replace product 3D dimensions (e.g., "700×700×30 мм" → "800×400×40 мм")
  //    But NOT block dimensions 3200×1500×1000
  if (tpl.dimsRegex) {
    text = text.replace(tpl.dimsRegex, newDims);
  }

  // 2. Replace rough dimensions if applicable (бучардирование_лощение has 620×320×25)
  if (tpl.roughDimsRegex) {
    const roughLength = dims.length + 20;
    const roughWidth = dims.width + 20;
    const roughThickness = dims.thickness + 5;
    const newRoughDims = `${roughLength}×${roughWidth}×${roughThickness}`;
    text = text.replace(tpl.roughDimsRegex, newRoughDims);
    if (tpl.roughTwoDRegex) {
      text = text.replace(tpl.roughTwoDRegex, `${roughLength}×${roughWidth}`);
    }
  }

  // 3. Replace 2D dimensions (e.g., "700×700" → "800×400")
  //    Be careful not to replace the 3D ones we already replaced
  if (tpl.twoDRegex) {
    text = text.replace(tpl.twoDRegex, newTwoD);
  }

  // 4. Replace material commercial name
  text = text.replace(/Delikato light/g, newMaterial);

  // 5. Replace density if it appears in context
  //    e.g., "~1600 кг/м³" → "~2700 кг/м³" or "~2700 кг/м³" → new density
  if (tpl.density && tpl.density !== newDensity) {
    const densityRegex = new RegExp(`~?\\\\?~?${tpl.density}\\s*кг/м`, 'g');
    text = text.replace(densityRegex, `~${newDensity} кг/м`);
  }

  // 6. Replace block mass (template → actual)
  if (tpl.blockMass) {
    const tplBlockMassStr = String(tpl.blockMass).replace('.', ',');
    const newBlockMassStr = blockMassT;
    // Replace patterns like "~7,2 т" or "\\~7,2 т"
    const blockMassRegex = new RegExp(`\\\\?~?${escapeRegex(tplBlockMassStr)}\\s*т\\b`, 'g');
    text = text.replace(blockMassRegex, `~${newBlockMassStr} т`);
  }

  // 7. Replace piece mass patterns
  //    Various patterns: "~40 кг", "~34 кг", "~36 кг" (with allowance for rough)
  if (tpl.pieceMassApprox) {
    const newPieceMassRounded = Math.round(pieceMass);
    // Replace the template's approximate piece mass
    text = text.replace(new RegExp(`\\\\?~?${tpl.pieceMassApprox}\\s*кг`, 'g'), `~${newPieceMassRounded} кг`);
  }
  if (tpl.pieceMassExact) {
    const newPieceMassRounded = Math.round(pieceMass);
    text = text.replace(new RegExp(`\\\\?~?${tpl.pieceMassExact}\\s*кг`, 'g'), `~${newPieceMassRounded} кг`);
    // Also replace "~36 кг" which appears as rough piece mass (with ~2kg allowance)
    const roughPieceMass = tpl.pieceMassExact + 2;
    const newRoughPieceMass = newPieceMassRounded + 2;
    text = text.replace(new RegExp(`\\\\?~?${roughPieceMass}\\s*кг`, 'g'), `~${newRoughPieceMass} кг`);
  }

  // 8. Replace batch quantity pieces
  if (tpl.batchPieces && product.quantity_pieces) {
    text = text.replace(new RegExp(`${tpl.batchPieces}\\s*штук`, 'g'), `${product.quantity_pieces} штук`);
    text = text.replace(new RegExp(`${tpl.batchPieces}\\s*плит`, 'g'), `${product.quantity_pieces} плит`);
    text = text.replace(new RegExp(`${tpl.batchPieces}\\s*заготов`, 'g'), `${product.quantity_pieces} заготов`);
    // Replace "~29 ×" patterns for batch mass calculation  
    text = text.replace(new RegExp(`\\\\?~?${tpl.batchPieces}\\s*×`, 'g'), `~${product.quantity_pieces} ×`);
  }

  // 9. Replace batch area
  if (tpl.batchArea && product.quantity) {
    // Extract numeric area from quantity (e.g., "14,1 кв.м." → "14,1")
    const areaMatch = product.quantity.match(/([\d,]+)/);
    if (areaMatch) {
      text = text.replace(new RegExp(escapeRegex(tpl.batchArea) + '\\s*м²', 'g'), `${areaMatch[1]} м²`);
      text = text.replace(new RegExp(escapeRegex(tpl.batchArea) + '\\s*кв\\.?\\s*м', 'g'), `${areaMatch[1]} кв.м`);
    }
  }

  // 10. Replace total batch mass
  if (tpl.batchMassTotal) {
    text = text.replace(new RegExp(`\\\\?~?${tpl.batchMassTotal}\\s*кг`, 'g'), `~${batchMass} кг`);
  }

  // 11. Replace product type name references
  if (tpl.productName && product.name) {
    // Only replace if the product has a different name
    const newProductName = getProductTypeName(product);
    if (newProductName !== tpl.productName) {
      // Replace with flexible case handling
      text = text.replace(new RegExp(escapeRegex(tpl.productName), 'gi'), newProductName);
    }
  }

  // 12. Calculate piece area for area-based replacement
  const pieceArea = (dims.length / 1000) * (dims.width / 1000);
  const tplPieceArea = (tpl.length / 1000) * (tpl.width / 1000);
  if (Math.abs(pieceArea - tplPieceArea) > 0.001) {
    // Replace "0,49" with actual piece area (for batch calculations)
    const tplAreaStr = tplPieceArea.toFixed(2).replace('.', ',');
    const newAreaStr = pieceArea.toFixed(2).replace('.', ',');
    text = text.replace(new RegExp(escapeRegex(tplAreaStr), 'g'), newAreaStr);
  }

  return text;
}

/**
 * Get product type name for text substitution
 */
function getProductTypeName(product) {
  const name = product.name.toLowerCase();
  if (name.includes('плита') && name.includes('напольн')) return 'плита напольная';
  if (name.includes('плита') && name.includes('облицов')) return 'плита облицовочная';
  if (name.includes('сегмент')) return 'сегмент радиусный';
  if (name.includes('ступен')) return 'ступень';
  if (name.includes('подоконник')) return 'подоконник';
  if (name.includes('столешниц')) return 'столешница';
  return product.name.toLowerCase();
}

/**
 * Build all 29 operations for a given product.
 * Returns array of { number, title, text } objects.
 */
function buildOperations(product) {
  const textureKey = product.texture;
  const templateOps = operationsLibrary[textureKey];
  
  if (!templateOps) {
    throw new Error(`Неизвестный тип фактуры: "${textureKey}". Доступные: лощение, рельефная_матовая, бучардирование_лощение`);
  }

  const operations = [];
  const { warnings } = analyzeEquipment(product);

  for (let i = 1; i <= 29; i++) {
    const numStr = String(i);
    const op = templateOps[numStr];
    
    if (!op) {
      throw new Error(`Операция №${i} не найдена в шаблоне для фактуры "${textureKey}"`);
    }

    let title = op.title;
    let text = op.text;

    // Handle operations 17-20 based on texture
    if (i >= 17 && i <= 20) {
      if (textureKey === 'лощение') {
        // Already marked as "НЕ ПРИМЕНЯЕТСЯ" in template — keep as is
      }
      // For рельефная_матовая and бучардирование_лощение, use their specific variants
    }

    // Apply parametric substitution
    text = parametrize(text, product, textureKey);
    title = parametrize(title, product, textureKey);

    // Clean title artifacts
    title = cleanTitle(title);

    operations.push({
      number: i,
      title: title,
      text: text,
      isNotApplicable: isOperationNA(text, textureKey, i)
    });
  }

  return { operations, warnings };
}

/**
 * Check if an operation is marked as "НЕ ПРИМЕНЯЕТСЯ"
 */
function isOperationNA(text, textureKey, opNum) {
  if (opNum >= 17 && opNum <= 20 && textureKey === 'лощение') {
    return true;
  }
  if (text.includes('НЕ ПРИМЕНЯЕТСЯ')) {
    return true;
  }
  return false;
}

/**
 * Clean title text from markdown/pandoc artifacts
 */
function cleanTitle(title) {
  // Remove {.underline} artifacts
  title = title.replace(/\]\{\.underline\}/g, '');
  title = title.replace(/\{\.underline\}/g, '');
  // Remove trailing markdown bold markers
  title = title.replace(/\*+$/g, '');
  // Remove leading/trailing **
  title = title.replace(/^\*+|\*+$/g, '');
  // Remove trailing ---
  title = title.replace(/\s*---\s*$/, '');
  // Clean whitespace
  title = title.trim();
  return title;
}

/**
 * Load operation overrides from templates/operation_overrides/ directory
 * Allows users to customize individual operation texts.
 */
function loadOverrides() {
  const overridesDir = path.join(__dirname, '..', 'templates', 'operation_overrides');
  const overrides = {};
  
  if (fs.existsSync(overridesDir)) {
    const files = fs.readdirSync(overridesDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(overridesDir, file), 'utf8'));
        Object.assign(overrides, data);
      } catch (e) {
        console.warn(`Предупреждение: не удалось загрузить override ${file}: ${e.message}`);
      }
    }
  }
  
  return overrides;
}

module.exports = {
  buildOperations,
  parametrize,
  TEMPLATE_PRODUCTS,
  cleanTitle
};
