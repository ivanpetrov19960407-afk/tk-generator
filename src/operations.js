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
    edgesText: 'фаски 5мм по четырём сторонам',
    // Толщины слэбов в шаблоне (для замены)
    slabThicknessRange: [35, 40],  // "~35--40 мм"
    slabAllowance: 10               // припуск на калибровку
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
    edgesText: null,
    slabThicknessRange: [105, 115],  // "105--115 мм"
    slabAllowance: 17
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
    edgesText: null,
    slabThicknessRange: [25, 28],  // "~25--28 мм"
    slabAllowance: 8
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
    // Replace "620×320×20" pattern (rough 2D + original thickness, NOT +5)
    // MUST run BEFORE roughTwoDRegex, because that replaces "620×320" → new 2D,
    // making the 3-component pattern unmatchable.
    // Handles both plain and escaped-tilde versions: \~620×320×20 and ~620×320×20
    const origTwoD = tpl.roughTwoD || `${tpl.length + 20}×${tpl.width + 20}`;
    const roughOrigT_regex = new RegExp(`\\\\?~?${origTwoD.replace('×', '×')}×${tpl.thickness}`, 'g');
    text = text.replace(roughOrigT_regex, `~${roughLength}×${roughWidth}×${dims.thickness}`);
    if (tpl.roughTwoDRegex) {
      text = text.replace(tpl.roughTwoDRegex, `${roughLength}×${roughWidth}`);
    }
  }

  // 3. Replace 2D dimensions (e.g., "700×700" → "800×400")
  //    Be careful not to replace the 3D ones we already replaced
  if (tpl.twoDRegex) {
    text = text.replace(tpl.twoDRegex, newTwoD);
  }

  // 4. Replace material commercial name AND rock type (порода)
  //    Шаблоны захардкожены как "мрамора Delikato light" — нужно заменять и породу
  const materialType = ((product.material && product.material.type) || 'мрамор').toLowerCase();
  
  // Маппинг падежей: мрамор → гранит / известняк / габбро-диабаз
  const rockForms = {
    'мрамор':       { 'мрамора': 'materialGEN', 'мрамору': 'materialDAT', 'мрамором': 'materialINS', 'мраморе': 'materialPRP', 'мрамор': 'materialNOM' },
    'гранит':       { gen: 'гранита', dat: 'граниту', ins: 'гранитом', prp: 'граните', nom: 'гранит' },
    'известняк':    { gen: 'известняка', dat: 'известняку', ins: 'известняком', prp: 'известняке', nom: 'известняк' },
    'габбро-диабаз': { gen: 'габбро-диабаза', dat: 'габбро-диабазу', ins: 'габбро-диабазом', prp: 'габбро-диабазе', nom: 'габбро-диабаз' },
    'мраморизированный известняк': { gen: 'мраморизированного известняка', dat: 'мраморизированному известняку', ins: 'мраморизированным известняком', prp: 'мраморизированном известняке', nom: 'мраморизированный известняк' }
  };
  
  const targetRock = rockForms[materialType] || rockForms['известняк'] || rockForms['гранит'];
  
  // Замена падежных форм "мрамора" → "гранита" и т.д. (строчные + заглавные)
  // Пропускаем если материал = мрамор (шаблон уже написан для мрамора, замена не нужна)
  if (materialType !== 'мрамор') {
    const replacePair = (pattern, replacement) => {
      text = text.replace(new RegExp(pattern, 'g'), replacement);
      // Заглавная буква
      const capPattern = pattern.charAt(0).toUpperCase() + pattern.slice(1);
      const capReplacement = replacement.charAt(0).toUpperCase() + replacement.slice(1);
      text = text.replace(new RegExp(capPattern, 'g'), capReplacement);
    };
    replacePair('мрамора', targetRock.gen);
    replacePair('мрамору', targetRock.dat);
    replacePair('мрамором', targetRock.ins);
    replacePair('мраморе', targetRock.prp);
    // мрамор (именительный) — не захватывая мрамора/мрамору/мрамором/мраморе/мраморн
    text = text.replace(/мрамор(?![ауеон])/g, targetRock.nom);
    text = text.replace(/Мрамор(?![ауеон])/g, targetRock.nom.charAt(0).toUpperCase() + targetRock.nom.slice(1));
    // мраморная → каменная
    text = text.replace(/мраморн/g, 'каменн');
    text = text.replace(/Мраморн/g, 'Каменн');
  }
  
  // Замена коммерческого имени камня
  text = text.replace(/Delikato light/g, newMaterial);

  // 4a-extra. Replace standalone product thickness (e.g., "20 мм" → "150 мм")
  if (tpl.thickness && tpl.thickness !== dims.thickness) {
    const tT = tpl.thickness;
    const nT = dims.thickness;
    // "толщин* ... NN мм" — с возможными словами между (финальная толщина, при толщине, толщиной)
    text = text.replace(new RegExp('(толщин\\w*[^.]*?)\\b' + tT + '\\s*мм', 'g'), (match, prefix) => {
      // Don't replace if it's about slab thickness (already handled by 4b)
      if (prefix.includes('слэб') || prefix.includes('слябы')) return match;
      return prefix + nT + ' мм';
    });
    // "до NN мм" (калибровка до)
    text = text.replace(new RegExp('(до)\\s+' + tT + '\\s*мм', 'g'), '$1 ' + nT + ' мм');
    // "всего NN мм"
    text = text.replace(new RegExp('(всего)\\s+' + tT + '\\s*мм', 'g'), '$1 ' + nT + ' мм');
    // "при NN мм" 
    text = text.replace(new RegExp('(при)\\s+' + tT + '\\s*мм', 'g'), '$1 ' + nT + ' мм');
    // Standalone "NN мм" after specific context words indicating it's about product thickness
    text = text.replace(new RegExp('(ультратонк\\w*[^.]*?)\\(' + tT + '\\s*мм\\)', 'g'), '$1(' + nT + ' мм)');
    text = text.replace(new RegExp('(\\()' + tT + '\\s*мм(\\))', 'g'), '$1' + nT + ' мм$2');
  }

  // 4b. Replace slab thickness ("~35--40 мм" → "толщина изделия + припуск")
  if (tpl.slabThicknessRange) {
    const [tplMin, tplMax] = tpl.slabThicknessRange;
    const actualT = dims.thickness;
    const allowance = tpl.slabAllowance || 10;
    const newSlabMin = actualT + Math.round(allowance * 0.5);
    const newSlabMax = actualT + allowance;
    
    // Заменяем разные паттерны: "~35--40 мм", "35\u201440 мм", "\\~35--40"
    const slabRegex = new RegExp(
      `\\\\?~?${tplMin}\\s*[-\u2014\u2013]+\\s*${tplMax}\\s*мм`, 'g'
    );
    text = text.replace(slabRegex, `~${newSlabMin}--${newSlabMax} мм`);
    
    // Также единичные упоминания: "~40 мм" → "~{newSlabMax} мм" (около слэбов)
    const slabSingleMax = new RegExp(`\\\\?~${tplMax}\\s*мм`, 'g');
    text = text.replace(slabSingleMax, `~${newSlabMax} мм`);
    const slabSingleMin = new RegExp(`\\\\?~${tplMin}\\s*мм`, 'g');
    text = text.replace(slabSingleMin, `~${newSlabMin} мм`);
    
    // Заменяем толщину слэба без тильды: "28 мм" в контексте слэбов
    text = text.replace(new RegExp(`${tplMax}\\s*мм`, 'g'), `${newSlabMax} мм`);
  }

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

  // 13. Thickness-based equipment substitution
  //     JC-1010 max height 50mm, SPG1200-12 max height 50mm, SQC600-4D max depth 180mm
  const productThickness = dims.thickness;

  if (productThickness > 50) {
    // Determine JC-1010 replacement based on thickness
    const calibrationEquip = productThickness <= 180
      ? 'SQC600-4D'
      : 'Фрезерный ЧПУ/портал';
    const calibrationMethod = productThickness <= 180
      ? 'мостовом станке SQC600-4D (методом контрольного пропиливания базовых плоскостей)'
      : 'фрезерном ЧПУ/портале (методом фрезерования базовых плоскостей)';

    // Replace "калибровальном станке JC-1010" → alternative method description
    text = text.replace(/калибровальном станке JC-1010/g, calibrationMethod);
    // Replace "Калибровальный станок JC-1010" → equipment name
    text = text.replace(/Калибровальный станок JC-1010/g, calibrationEquip);
    // Replace "станке JC-1010" (standalone)
    text = text.replace(/станке JC-1010/g, `станке ${calibrationEquip}`);
    // Replace "станок JC-1010" (standalone)
    text = text.replace(/станок JC-1010/g, `станок ${calibrationEquip}`);
    // Replace "на JC-1010"
    text = text.replace(/на JC-1010/g, `на ${calibrationEquip}`);
    // Replace "для JC-1010"
    text = text.replace(/для JC-1010/g, `для ${calibrationEquip}`);
    // Replace "стол JC-1010"
    text = text.replace(/стол JC-1010/g, `стол ${calibrationEquip}`);
    // Replace "паспорту JC-1010"
    text = text.replace(/паспорту JC-1010/g, `паспорту ${calibrationEquip}`);
    // Replace "станком JC-1010"
    text = text.replace(/станком JC-1010/g, `станком ${calibrationEquip}`);
    // Replace remaining standalone "JC-1010" references
    text = text.replace(/JC-1010/g, calibrationEquip);
    // Remove "(максимальная ширина обработки 1000 мм," + anything until ")" for JC-1010 specs
    // These specs are no longer valid; replaced equipment has different specs
    text = text.replace(/\(максимальная ширина обработки 1000 мм[^)]*\)/g, '');
    text = text.replace(/\(макс\. ширина обработки[^)]*\)/g, '');
    text = text.replace(/\(макс\. высота обработки 50 мм\)/g, '');
    // Remove "макс. высота — до 50 мм" and similar
    text = text.replace(/макс\. высота ---? до 50 мм/g, '');
    text = text.replace(/макс\.\s*высота\s*50\s*мм/g, '');
    // Replace "калибровальных сегментов" → "алмазных дисков/фрез"
    text = text.replace(/калибровальных сегментов/g, 'алмазных дисков/фрез');
    text = text.replace(/калибровальные сегменты/g, 'алмазные диски/фрезы');
    // Remove lines with НЕ ПРИМЕНИМ for JC-1010 (already adapted)
    text = text.replace(/[^\n]*JC-1010[^\n]*НЕ ПРИМЕНИМ[^\n]*/g, '');
    text = text.replace(/[^\n]*JC-1010[^\n]*НЕ ПРИМЕНЯЕТСЯ[^\n]*/g, '');

    // Replace SPG1200-12 references → ZLMS 2600
    // First replace multi-sentence blocks that discuss SPG applicability
    // Pattern: "автоматическая полировальная машина SPG1200-12 (макс. ...)" blocks
    text = text.replace(/автоматическая полировальная машина SPG1200-12 \(макс\.[^)]*\)/gi, 'ZLMS 2600');
    // Pattern: "SPG1200-12 (макс. ...)" with specs in parens
    text = text.replace(/SPG1200-12 \(макс\.[^)]*\)/g, 'ZLMS 2600');
    // Pattern: sentences/fragments with "SPG1200-12 НЕ ПРИМЕНЯЕТСЯ" — replace the whole clause
    text = text.replace(/SPG1200-12 НЕ ПРИМЕНЯЕТСЯ[^.]*\./g, 'ZLMS 2600 (SPG1200-12 не применяется при толщине > 50 мм).');
    text = text.replace(/SPG1200-12 НЕ ПРИМЕНИМА[^.]*\./g, 'ZLMS 2600 (SPG1200-12 не применяется при толщине > 50 мм).');
    // Replace all remaining "SPG1200-12" → "ZLMS 2600"
    text = text.replace(/SPG1200-12/g, 'ZLMS 2600');
    // Clean up duplicates from replacements
    text = text.replace(/ZLMS 2600 или ZLMS 2600/g, 'ZLMS 2600');
    text = text.replace(/ZLMS 2600 \(или ZLMS 2600\)/g, 'ZLMS 2600');
    // Clean up "ВНИМАНИЕ: ZLMS 2600 имеет критический лимит" (no longer relevant)
    text = text.replace(/ВНИМАНИЕ: ZLMS 2600 имеет критический лимит[^.]*\./g, '');
    // Remove "макс. высота 50 мм" mentions that were tied to SPG
    text = text.replace(/макс\. высота 50 мм ---[^.]*проход[^.]*/g, '');

    // 13a. Fix logical text inconsistencies for thick items
    // "ультратонких" → "толстостенных" (or remove) when thickness > 50
    text = text.replace(/ультратонк(их|ой|ую|ие|ого|ом|ым|ыми|ые)/g, (match, ending) => {
      const map = { 'их': 'ых', 'ой': 'ой', 'ую': 'ую', 'ие': 'ые', 'ого': 'ого', 'ом': 'ом', 'ым': 'ым', 'ыми': 'ыми', 'ые': 'ые' };
      return 'массивн' + (map[ending] || ending);
    });
    text = text.replace(/Ультратонк(их|ой|ую|ие|ого|ом|ым|ыми|ые)/g, (match, ending) => {
      const map = { 'их': 'ых', 'ой': 'ой', 'ую': 'ую', 'ие': 'ые', 'ого': 'ого', 'ом': 'ом', 'ым': 'ым', 'ыми': 'ыми', 'ые': 'ые' };
      return 'Массивн' + (map[ending] || ending);
    });
    // Remove "<< 50 мм --- станок полностью применим" (wrong comparison for thick items)
    // Replace with correct statement about actual equipment applicability
    text = text.replace(/\\<\\<\s*50\s*мм\s*---\s*станок полностью применим/g,
      '--- оборудование адаптировано для данной толщины');
    text = text.replace(/<<\s*50\s*мм\s*---\s*станок полностью применим/g,
      '--- оборудование адаптировано для данной толщины');
    // Fix "<< 1000 мм" for width comparison — replace template width 320 with actual rough width
    const actualRoughWidth = dims.width + 20;
    text = text.replace(/Ширина заготовки\s*\\?~?\d+\s*мм\s*\\<\\<\s*1000/g,
      `Ширина заготовки ~${actualRoughWidth} мм`);
  }

  if (productThickness > 180) {
    // Replace SQC600-4D in profiling context with ЧПУ
    // SQC600-4D has max depth 180mm, so items thicker need ЧПУ for profiling
    text = text.replace(/мостовом станке SQC600-4D/g, 'фрезерном ЧПУ/портале');
    text = text.replace(/Мостовой станок SQC600-4D/g, 'Фрезерный ЧПУ/портал');
    text = text.replace(/мостовой станок SQC600-4D/g, 'фрезерный ЧПУ/портал');
    text = text.replace(/станке SQC600-4D/g, 'фрезерном ЧПУ/портале');
    text = text.replace(/станок SQC600-4D/g, 'Фрезерный ЧПУ/портал');
    text = text.replace(/стола SQC600-4D/g, 'стола Фрезерного ЧПУ/портала');
    text = text.replace(/стол SQC600-4D/g, 'стол Фрезерного ЧПУ/портала');
    text = text.replace(/SQC600-4D/g, 'Фрезерный ЧПУ/портал');
    // Remove "глубина реза 180 мм" or "макс. глубина реза 180 мм" specs
    text = text.replace(/\(макс\.\s*глубина реза 180 мм[^)]*\)/g, '');
    text = text.replace(/глубина реза 180 мм/g, '');
  }

  return text;
}

/**
 * Get product type name for text substitution
 */
function getProductTypeName(product) {
  if (!product.name) return '';
  const name = product.name.toLowerCase();
  if (name.includes('плита') && name.includes('напольн')) return 'плита напольная';
  if (name.includes('плита') && name.includes('облицов')) return 'плита облицовочная';
  if (name.includes('сегмент')) return 'сегмент радиусный';
  if (name.includes('ступен')) return 'ступень';
  if (name.includes('подоконник')) return 'подоконник';
  if (name.includes('столешниц')) return 'столешница';
  return name;
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
