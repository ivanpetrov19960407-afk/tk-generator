/**
 * sections.js — Builder for sections 1-5, 7-13, title page
 * Takes template text from sections_template.json and parametrizes it.
 */

const fs = require('fs');
const path = require('path');
const { parametrize, TEMPLATE_PRODUCTS } = require('./operations');
const { buildEquipmentListText, calcProductMass, calcBlockMass, calcBatchMass } = require('./equipment');

const sectionsTemplate = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'sections_template.json'), 'utf8')
);

/**
 * Build title page text for a product
 */
function buildTitlePage(product) {
  const dims = product.dimensions;
  const dimsStr = `${dims.length}×${dims.width}×${dims.thickness} мм`;
  const pieceMass = calcProductMass(product);
  const batchMass = calcBatchMass(product);
  
  const textureNames = {
    'лощение': 'Лощение',
    'рельефная_матовая': 'Рельефная матовая фактура',
    'бучардирование_лощение': 'Бучардирование + лощение'
  };
  const textureName = textureNames[product.texture] || product.texture;
  
  const edgesText = product.edges || 'калибровка по всем сторонам';
  
  let quantityLine = '';
  if (product.quantity && product.quantity_pieces) {
    quantityLine = `Объём партии: ${product.quantity} (~${product.quantity_pieces} ${getPiecesWord(product.quantity_pieces)})`;
  } else if (product.quantity_pieces) {
    quantityLine = `Объём партии: ${product.quantity_pieces} ${getPiecesWord(product.quantity_pieces)}`;
  } else if (product.quantity) {
    quantityLine = `Объём партии: ${product.quantity}`;
  }

  const lines = [
    'УТВЕРЖДАЮ',
    '',
    'Директор производства ________________',
    '',
    '«___» ____________ 2026 г.',
    '',
    '',
    'ТЕХНОЛОГИЧЕСКАЯ КАРТА',
    '',
    'МАРШРУТНАЯ КАРТА',
    '',
    'производства изделия из натурального камня',
    '',
    `${product.name} ${dimsStr}`,
    '',
    `${getMaterialTypeName(product.material.type)} ${product.material.name}`,
    '',
    `${textureName} · ${edgesText} · Калибровка`,
    '',
    'Архитектурное изделие 1-й категории с подбором по оттенку и зернистости',
    '',
    quantityLine,
    '',
    'Разработано: ___________________ Мастер цеха',
    '',
    'Проверено: ___________________ Директор производства',
    '',
    `Дата разработки: ${product.date || '__ ________ 2026 г.'}`
  ];
  
  return lines.join('\n');
}

/**
 * Get Russian material type name with capital letter
 */
function getMaterialTypeName(type) {
  const types = {
    'мрамор': 'Мрамор',
    'гранит': 'Гранит',
    'известняк': 'Известняк',
    'травертин': 'Травертин',
    'оникс': 'Оникс',
    'песчаник': 'Песчаник',
    'сланец': 'Сланец'
  };
  return types[type.toLowerCase()] || type;
}

/**
 * Get correct Russian plural for "штук/штуки/штука"
 */
function getPiecesWord(n) {
  const lastTwo = n % 100;
  const lastOne = n % 10;
  if (lastTwo >= 11 && lastTwo <= 19) return 'штук';
  if (lastOne === 1) return 'штука';
  if (lastOne >= 2 && lastOne <= 4) return 'штуки';
  return 'штук';
}

/**
 * Build a specific section with parametrization
 * @param {string} sectionNum - Section number ("1", "2", etc.)
 * @param {Object} product - Product spec
 * @returns {string} Parametrized section text
 */
function buildSection(sectionNum, product) {
  const template = sectionsTemplate[sectionNum];
  if (!template) return null;
  
  // The templates are based on лощение texture, so we parametrize from that base
  let text = parametrize(template, product, 'лощение');
  
  // Additional section-specific customizations
  switch (sectionNum) {
    case '1':
      text = customizeSection1(text, product);
      break;
    case '2':
      text = customizeSection2(text, product);
      break;
    case '5':
      text = customizeSection5(text, product);
      break;
    case '7':
      text = customizeSection7(text, product);
      break;
    case '10':
      text = customizeSection10(text, product);
      break;
    case '12':
      text = customizeSection12(text, product);
      break;
  }
  
  return text;
}

/**
 * Section 1 — customize texture description
 */
function customizeSection1(text, product) {
  const textureDescs = {
    'лощение': 'с фактурой лощения лицевой поверхности',
    'рельефная_матовая': 'с рельефной матовой фактурой лицевой поверхности',
    'бучардирование_лощение': 'с бучардированной и лощёной фактурой лицевой поверхности'
  };
  
  // Replace the texture description
  text = text.replace(
    /с фактурой лощения лицевой\s*поверхности/,
    textureDescs[product.texture] || textureDescs['лощение']
  );
  
  return text;
}

/**
 * Section 2 — customize material and geometry details
 */
function customizeSection2(text, product) {
  const dims = product.dimensions;
  const pieceMass = calcProductMass(product);
  const pieceArea = (dims.length / 1000) * (dims.width / 1000);
  
  // Replace mass calculation pattern
  // "0,7×0,7×0,03×2700 ≈ 39,7 кг/плита" → actual calc
  const calcStr = `${(dims.length/1000).toFixed(1).replace('.',',')}×${(dims.width/1000).toFixed(1).replace('.',',')}×${(dims.thickness/1000).toFixed(2).replace('.',',')}×${product.material.density}`;
  text = text.replace(
    /0,7×0,7×0,03×2700\s*≈\s*39,7\s*кг\/плита/,
    `${calcStr} ≈ ${pieceMass.toFixed(1).replace('.', ',')} кг/плита`
  );
  
  // Replace texture description
  const textureDescs = {
    'лощение': 'лощение (матовый сатиновый блеск без зеркальной полировки)',
    'рельефная_матовая': 'рельефная матовая (текстурированная поверхность без блеска)',
    'бучардирование_лощение': 'бучардирование верхней поверхности с лощением торцевых граней'
  };
  text = text.replace(
    /лощение \(матовый сатиновый блеск без зеркальной\s*полировки\)/,
    textureDescs[product.texture] || textureDescs['лощение']
  );
  
  // Replace stone type references  
  if (product.material.type !== 'мрамор') {
    text = text.replace(/мрамор(?!а)/g, product.material.type);
    text = text.replace(/мрамора/g, product.material.type + 'а');
  }
  
  return text;
}

/**
 * Section 5 — customize operation list for operations 17-20
 */
function customizeSection5(text, product) {
  if (product.texture === 'лощение') {
    // Keep "НЕ ПРИМЕНЯЕТСЯ" for ops 17-20
  } else if (product.texture === 'бучардирование_лощение') {
    text = text.replace(
      /Подготовка к бучардированию.*?--- НЕ ПРИМЕНЯЕТСЯ/,
      'Подготовка к бучардированию (маскирование зон лощения)'
    );
    text = text.replace(
      /Бучардирование поверхности.*?--- НЕ ПРИМЕНЯЕТСЯ/,
      'Бучардирование поверхности (архитектурная 1 кат.)'
    );
    text = text.replace(
      /Контроль качества бучардирования.*?--- НЕ ПРИМЕНЯЕТСЯ/,
      'Контроль качества бучардирования'
    );
    text = text.replace(
      /Доводка после бучардирования.*?--- НЕ ПРИМЕНЯЕТСЯ/,
      'Доводка после бучардирования'
    );
  } else if (product.texture === 'рельефная_матовая') {
    text = text.replace(
      /Подготовка к бучардированию.*?--- НЕ ПРИМЕНЯЕТСЯ/,
      'Подготовка к рельефной матовой обработке (маскирование зон полировки торцев)'
    );
    text = text.replace(
      /Бучардирование поверхности.*?--- НЕ ПРИМЕНЯЕТСЯ/,
      'Нанесение рельефной матовой фактуры на лицевую поверхность'
    );
    text = text.replace(
      /Контроль качества бучардирования.*?--- НЕ ПРИМЕНЯЕТСЯ/,
      'Контроль качества рельефной матовой фактуры'
    );
    text = text.replace(
      /Доводка после бучардирования.*?--- НЕ ПРИМЕНЯЕТСЯ/,
      'Доводка рельефной матовой фактуры (выравнивание зон, устранение переходов)'
    );
  }
  
  return text;
}

/**
 * Section 7 — customize quality control references
 */
function customizeSection7(text, product) {
  if (product.material.type !== 'мрамор') {
    text = text.replace(/мрамора/g, product.material.type + 'а');
    text = text.replace(/мрамор\b/g, product.material.type);
  }
  return text;
}

/**
 * Section 10 — rebuild equipment and personnel lists
 */
function customizeSection10(text, product) {
  // Replace the equipment list block
  const equipText = buildEquipmentListText(product);
  
  // Find and replace equipment section
  const eqStart = text.indexOf('10.1.');
  const eqEnd = text.indexOf('10.2.');
  
  if (eqStart !== -1 && eqEnd !== -1) {
    const before = text.substring(0, eqStart);
    const after = text.substring(eqEnd);
    text = before + '10.1. Оборудование (EQUIPMENT_LIST)\n\n' + equipText + '\n\n' + after;
  }
  
  return text;
}

/**
 * Section 12 — customize assumptions
 */
function customizeSection12(text, product) {
  const dims = product.dimensions;
  const blockMass = calcBlockMass(product);
  const blockMassT = (blockMass / 1000).toFixed(1).replace('.', ',');
  
  // Update JC-1010 assumption
  if (dims.width > 1000) {
    text = text.replace(
      /Калибровальный станок JC-1010.*?лимита\)/,
      `Калибровальный станок JC-1010 НЕ ПРИМЕНИМ для данного изделия (ширина ${dims.width} мм > лимита 1000 мм). Требуется альтернативный маршрут калибровки.`
    );
  }
  
  // Update SPG1200-12 assumption
  if (dims.width <= 1200 && dims.thickness <= 50) {
    text = text.replace(
      /максимальная высота обработки\s*50 мм \(плита \d+ мм/,
      `максимальная высота обработки 50 мм (плита ${dims.thickness} мм`
    );
    text = text.replace(
      /ширина 1200 мм \(плита \d+ мм/,
      `ширина 1200 мм (плита ${dims.width} мм`
    );
  }
  
  // Update batch calculation
  if (product.quantity_pieces) {
    const pieceArea = (dims.length / 1000) * (dims.width / 1000);
    const areaMatch = product.quantity ? product.quantity.match(/([\d,]+)/) : null;
    const areaVal = areaMatch ? areaMatch[1] : (product.quantity_pieces * pieceArea).toFixed(1).replace('.', ',');
    text = text.replace(
      /Объём партии.*?Принято \d+ плит\./,
      `Объём партии ${areaVal} м² составляет ~${product.quantity_pieces} плит (${areaVal} / ${pieceArea.toFixed(2).replace('.', ',')} ≈ ${product.quantity_pieces}). Принято ${product.quantity_pieces} плит.`
    );
  }
  
  return text;
}

/**
 * Build all sections for a product
 * @returns {Object} { title_page, sections: { "1": text, ... }, mk: text }
 */
function buildAllSections(product) {
  const result = {
    title_page: buildTitlePage(product),
    sections: {},
    mk: null
  };
  
  // Build sections 1-5, 7-13
  for (const num of ['1', '2', '3', '4', '5', '7', '8', '9', '10', '11', '12', '13']) {
    result.sections[num] = buildSection(num, product);
  }
  
  return result;
}

module.exports = {
  buildAllSections,
  buildTitlePage,
  buildSection,
  getPiecesWord
};
