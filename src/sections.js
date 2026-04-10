/**
 * sections.js — Builder for sections 1-5, 7-13, title page
 * Takes template text from sections_template.json and parametrizes it.
 */

const fs = require('fs');
const path = require('path');
const { resolveRuntimeDir } = require('./runtime-paths');
const { parametrize, TEMPLATE_PRODUCTS } = require('./operations');
const { buildEquipmentListText, calcProductMass, calcBlockMass, calcBatchMass } = require('./equipment');

const sectionsTemplate = JSON.parse(
  fs.readFileSync(path.join(resolveRuntimeDir('data'), 'sections_template.json'), 'utf8')
);

/**
 * Material-specific physical properties for section customization.
 * Keyed by commercial name (product.material.name).
 */
const MATERIAL_PROPERTIES = {
  'Delikato light': {
    structure: 'мелко- и среднезернистая',
    color: 'светло-бежевый, кремовый с тонкими прожилками',
    quartzNote: 'содержит значительно меньше кварца, чем гранит, однако общецеховые меры профилактики силикоза применяются',
    density_note: 'нижней консервативной оценкой'
  },
  'гранит м-ния Жалгыз': {
    structure: 'крупнозернистая, массивная',
    color: 'серо-розовый с крупными тёмными вкраплениями',
    quartzNote: 'содержит кварц (~25-30%), требуется строгое соблюдение мер профилактики силикоза (FFP3/СИЗОД, влажная резка, промышленная вентиляция)',
    density_note: 'средним значением для данного месторождения'
  },
  'Fatima (Португалия)': {
    structure: 'мелко-среднезернистая, плотная',
    color: 'бежево-серый, тёплый кремовый с характерными прожилками',
    quartzNote: 'содержит минимальное количество кварца (мраморизированный известняк), однако общецеховые меры профилактики силикоза применяются',
    density_note: 'типичной для мраморизированных известняков Португалии'
  },
  'Габбро-диабаз': {
    structure: 'мелкозернистая, массивная',
    color: 'чёрный с зеленоватым оттенком',
    quartzNote: 'практически не содержит свободного кварца, однако общецеховые меры профилактики силикоза применяются',
    density_note: 'характерной для данной породы'
  }
};

/**
 * Get material properties for a product, with fallback defaults.
 */
function getMaterialProps(product) {
  const matName = product.material && product.material.name;
  if (matName && MATERIAL_PROPERTIES[matName]) {
    return MATERIAL_PROPERTIES[matName];
  }
  // Fallback: generic based on material type
  const matType = (product.material && product.material.type || '').toLowerCase();
  if (matType.includes('гранит')) {
    return {
      structure: 'среднезернистая',
      color: 'серый',
      quartzNote: 'содержит кварц, требуется соблюдение мер профилактики силикоза (FFP2+, влажная резка, промышленная вентиляция)',
      density_note: 'расчётной оценкой'
    };
  }
  // Default (marble-like)
  return {
    structure: 'мелко- и среднезернистая',
    color: 'светлый',
    quartzNote: 'содержит значительно меньше кварца, чем гранит, однако общецеховые меры профилактики силикоза применяются',
    density_note: 'расчётной оценкой'
  };
}

/**
 * Extract a short product description from product name and geometry_type.
 * Maps geometry_type + product.name to the correct product type text.
 * Returns { nom: "ступень фигурная", gen: "ступени фигурной", plural_gen: "ступеней фигурных" }
 */
function getProductDescription(product) {
  const name = (product.name || '').toLowerCase();
  const geoType = (product.geometry_type || 'simple').toLowerCase();

  // Extract the key product type from the name (first ~50 chars usually have it)
  if (name.includes('ступен') || name.includes('проступь') || name.includes('подступен')) {
    return { nom: 'ступень', gen: 'ступени', plural_gen: 'ступеней' };
  }
  if (name.includes('накрывн')) {
    return { nom: 'накрывная плита', gen: 'накрывной плиты', plural_gen: 'накрывных плит' };
  }
  if (name.includes('колонн') || name.includes('база')) {
    return { nom: 'база колонны', gen: 'базы колонны', plural_gen: 'баз колонн' };
  }
  if (name.includes('сегмент') && name.includes('радиус')) {
    return { nom: 'сегментное радиусное изделие', gen: 'сегментного радиусного изделия', plural_gen: 'сегментных радиусных изделий' };
  }
  if (name.includes('сегмент')) {
    return { nom: 'сегментное изделие', gen: 'сегментного изделия', plural_gen: 'сегментных изделий' };
  }
  if (name.includes('подоконник')) {
    return { nom: 'подоконник', gen: 'подоконника', plural_gen: 'подоконников' };
  }
  if (name.includes('столешниц')) {
    return { nom: 'столешница', gen: 'столешницы', plural_gen: 'столешниц' };
  }
  if (name.includes('облицов')) {
    return { nom: 'плита облицовочная', gen: 'плиты облицовочной', plural_gen: 'плит облицовочных' };
  }

  // Geometry-type based fallback
  if (geoType === 'profile') {
    return { nom: 'изделие профильное', gen: 'изделия профильного', plural_gen: 'изделий профильных' };
  }
  if (geoType === 'radial') {
    return { nom: 'сегментное радиусное изделие', gen: 'сегментного радиусного изделия', plural_gen: 'сегментных радиусных изделий' };
  }

  // Default: напольная плита (simple geometry)
  return { nom: 'плита напольная', gen: 'плиты напольной', plural_gen: 'плит напольных' };
}

/**
 * Replace hardcoded "напольная плита" references in text with actual product description.
 */
function replaceProductDescription(text, product) {
  const desc = getProductDescription(product);

  // Replace various forms of "напольная плита" / "напольной плиты" / "напольных плит"
  // Also handle "напольную плиту", "напольные плиты" etc.
  text = text.replace(/напольной\s+плиты/g, desc.gen);
  text = text.replace(/напольных\s+плит/g, desc.plural_gen);
  text = text.replace(/напольн(?:ая|ую)\s+плит(?:а|у)/g, desc.nom);
  text = text.replace(/напольные\s+плиты/g, desc.nom);  // plural nom ≈ nom for display

  // "плита напольная" pattern (reversed word order)
  text = text.replace(/плиты\s+напольной/g, desc.gen);
  text = text.replace(/плит\s+напольных/g, desc.plural_gen);
  text = text.replace(/плит(?:а|у)\s+напольн(?:ая|ую)/g, desc.nom);

  // Replace "простая прямоугольная, без сложных профилей" for non-simple geometry
  if (product.geometry_type !== 'simple') {
    const pName = (product.name || '').toLowerCase();
    let profileDesc, profileFormDesc;
    if (product.geometry_type === 'profile') {
      if (pName.includes('ступен') || pName.includes('проступь')) {
        profileDesc = 'профильное (Г-образное сечение с капиносом/свесом)';
        profileFormDesc = 'профильной Г-образной формы с капиносом';
      } else if (pName.includes('подступен')) {
        profileDesc = 'простая прямоугольная (подступенок)';
        profileFormDesc = 'прямоугольной формы (подступенок)';
      } else if (pName.includes('карниз') || pName.includes('плинтус')) {
        profileDesc = 'профильное изделие с фигурным сечением';
        profileFormDesc = 'профильной формы с фигурным сечением';
      } else {
        profileDesc = 'профильное изделие с фигурными кантами';
        profileFormDesc = 'профильной формы с фигурными кантами';
      }
    } else {
      profileDesc = 'сегментное радиусное изделие';
      profileFormDesc = 'сегментной радиусной формы';
    }
    text = text.replace(
      /простая прямоугольная, без сложных профилей/g,
      profileDesc
    );
    // Also replace "прямоугольной (квадратной) формы"
    text = text.replace(
      /прямоугольной\s*\(квадратной\)\s*формы/g,
      profileFormDesc
    );
  }

  return text;
}

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
    'мраморизированный известняк': 'Мраморизированный известняк',
    'габбро-диабаз': 'Габбро-диабаз',
    'травертин': 'Травертин',
    'оникс': 'Оникс',
    'песчаник': 'Песчаник',
    'сланец': 'Сланец'
  };
  if (!type) return type || '';
  return types[type.toLowerCase()] || type;
}

/**
 * Get genitive form of the material type name (e.g. "мрамора", "гранита")
 */
function getMaterialTypeGenitive(type) {
  const genitives = {
    'мрамор': 'мрамора',
    'гранит': 'гранита',
    'известняк': 'известняка',
    'мраморизированный известняк': 'мраморизированного известняка',
    'габбро-диабаз': 'габбро-диабаза',
    'травертин': 'травертина',
    'оникс': 'оникса',
    'песчаник': 'песчаника',
    'сланец': 'сланца'
  };
  if (!type) return type || '';
  return genitives[type.toLowerCase()] || type;
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

  // Replace hardcoded "напольная плита" with actual product description
  text = replaceProductDescription(text, product);

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
    case '8':
      text = customizeSection8(text, product);
      break;
    case '10':
      text = customizeSection10(text, product);
      break;
    case '12':
      text = customizeSection12(text, product);
      break;
  }
  
  // Global: replace "напольная плита" with actual product type in ALL sections
  text = replaceProductType(text, product);
  
  // Global: replace material color and quartz note in ALL sections
  const matProps = getMaterialProps(product);
  text = text.replace(
    /содержит значительно меньше кварца, чем гранит, однако общецеховые меры профилактики силикоза применяются/g,
    matProps.quartzNote
  );
  text = text.replace(
    /Цвет:\s*светло-бежевый,\s*кремовый с тонкими прожилками/g,
    `Цвет: ${matProps.color}`
  );
  
  return text;
}

/**
 * Extract a short product type description from the full name.
 * E.g. "ступень фигурная" from full ВОР name, or "плита напольная" etc.
 */
function extractProductType(product) {
  const name = (product.name || '').toLowerCase();
  // Try to find the product type after the colon or dash
  const patterns = [
    /:\s*(.{5,80}?)(?:;|,\s*материал|$)/i,
    /-\s*(.{5,80}?)(?:;|,\s*материал|$)/i,
  ];
  for (const pat of patterns) {
    const m = name.match(pat);
    if (m && m[1]) return m[1].trim();
  }
  // Fallback: detect by keywords
  if (name.includes('ступень')) return 'ступень фигурная';
  if (name.includes('проступь')) return 'проступь фигурная';
  if (name.includes('подступенок')) return 'подступенок фигурный';
  if (name.includes('балясин')) return 'балясина';
  if (name.includes('поручен')) return 'поручень фигурный';
  if (name.includes('карниз')) return 'карниз фигурный';
  if (name.includes('молдинг')) return 'молдинг фигурный';
  if (name.includes('баз')) return 'база колонны';
  if (name.includes('накрывн')) return 'накрывная плита';
  if (name.includes('бортов')) return 'бортовой камень';
  if (name.includes('брусчатк')) return 'брусчатка';
  if (name.includes('пилястр')) return 'основание пилястры';
  if (name.includes('стенов')) return 'стеновая плита';
  if (name.includes('облицовочн')) return 'облицовочная плита';
  if (name.includes('площадк')) return 'плита площадки';
  if (name.includes('цокол')) return 'плита цоколя';
  if (name.includes('наклонн')) return 'наклонная плита';
  if (name.includes('напольн')) return 'плита напольная';
  return 'изделие из натурального камня';
}

/**
 * Replace all hardcoded "напольная плита / напольной плиты / напольных плит"
 * with the actual product type from ВОР.
 */
function replaceProductType(text, product) {
  const ptype = extractProductType(product);
  // Genitive forms for common types
  const genitiveMap = {
    'ступень фигурная': 'ступени фигурной',
    'проступь фигурная': 'проступи фигурной',
    'подступенок фигурный': 'подступенка фигурного',
    'балясина': 'балясины',
    'поручень фигурный': 'поручня фигурного',
    'карниз фигурный': 'карниза фигурного',
    'молдинг фигурный': 'молдинга фигурного',
    'база колонны': 'базы колонны',
    'накрывная плита': 'накрывной плиты',
    'бортовой камень': 'бортового камня',
    'брусчатка': 'брусчатки',
    'основание пилястры': 'основания пилястры',
    'стеновая плита': 'стеновой плиты',
    'облицовочная плита': 'облицовочной плиты',
    'плита площадки': 'плиты площадки',
    'плита цоколя': 'плиты цоколя',
    'наклонная плита': 'наклонной плиты',
    'плита напольная': 'плиты напольной',
    'изделие из натурального камня': 'изделия из натурального камня',
  };
  const ptypeGen = genitiveMap[ptype] || ptype;
  // Plural
  const pluralMap = {
    'плита напольная': 'плит напольных',
    'ступень фигурная': 'ступеней фигурных',
    'проступь фигурная': 'проступей фигурных',
  };
  const ptypePlural = pluralMap[ptype] || ptypeGen;
  
  // Replace nominative forms
  text = text.replace(/напольная плита/gi, ptype);
  text = text.replace(/Напольная плита/g, ptype.charAt(0).toUpperCase() + ptype.slice(1));
  // Replace genitive forms
  text = text.replace(/напольной плиты/gi, ptypeGen);
  text = text.replace(/напольных плит/gi, ptypePlural);
  
  return text;
}

/**
 * Section 1 — customize texture description + product type
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
  
  // Note: "напольная плита" replacement is handled globally in buildSection() via replaceProductDescription()
  return text;
}

/**
 * Section 2 — customize material and geometry details
 */
function customizeSection2(text, product) {
  const dims = product.dimensions;
  const pieceMass = calcProductMass(product);
  const pieceArea = (dims.length / 1000) * (dims.width / 1000);
  const matProps = getMaterialProps(product);
  const matName = product.material.name;
  const matTypeName = getMaterialTypeName(product.material.type);

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

  // Bug 3 fix: Replace hardcoded material color and structure
  // Match "Структура: мелко- и среднезернистая." with possible newline after colon
  text = text.replace(
    /Структура:\s*мелко- и среднезернистая\./,
    `Структура: ${matProps.structure}.`
  );
  text = text.replace(
    /Цвет: светло-бежевый, кремовый с тонкими\s*прожилками/,
    `Цвет: ${matProps.color}`
  );

  // ВАЖНОЕ ПРИМЕЧАНИЕ removed from section 2 template — quartz info covered in section 8

  // Replace stone type references (whole-word only to protect "мраморизированный")
  if (product.material.type !== 'мрамор') {
    const rockForms = {
      'гранит':       { gen: 'гранита', nom: 'гранит' },
      'известняк':    { gen: 'известняка', nom: 'известняк' },
      'габбро-диабаз': { gen: 'габбро-диабаза', nom: 'габбро-диабаз' },
      'мраморизированный известняк': { gen: 'мраморизированного известняка', nom: 'мраморизированный известняк' }
    };
    const matType = product.material.type.toLowerCase();
    const forms = rockForms[matType] || { gen: matType + 'а', nom: matType };
    // Use Cyrillic-aware negative lookahead to avoid matching inside "мраморизированный"
    text = text.replace(/мрамор(?![а-яё])/g, forms.nom);
    text = text.replace(/мрамора(?![а-яё])/g, forms.gen);
    text = text.replace(/Мрамор(?![а-яё])/g, forms.nom.charAt(0).toUpperCase() + forms.nom.slice(1));
    text = text.replace(/Мрамора(?![а-яё])/g, forms.gen.charAt(0).toUpperCase() + forms.gen.slice(1));
  }

  // Fix section 2.4: replace "принято как консервативная оценка" with material-specific density note
  if (matProps.density_note) {
    text = text.replace(
      /принято как консервативная оценка/g,
      matProps.density_note
    );
  }

  // Note: "напольная плита" and geometry description replacements are handled globally
  // in buildSection() via replaceProductDescription()

  // Replace section 2.2 geometry description for profiled products (steps)
  const productName = (product.name || '').toLowerCase();
  if (productName.includes('ступен') || productName.includes('проступь')) {
    // Replace the entire "Изделие:...Конфигурация --- ..." block
    text = text.replace(
      /Изделие:.*?Конфигурация\s*---\s*[^\n]+/s,
      `Изделие: ступень профильная, Г-образного сечения с капиносом (свес лицевой грани). Конфигурация\n--- профильная (Г-образное сечение)`
    );
    // Replace "напольная плита прямоугольной (квадратной) формы"
    text = text.replace(
      /напольная плита прямоугольной \(квадратной\) формы/g,
      'ступень профильная Г-образного сечения'
    );
    // Replace dimensions description
    text = text.replace(
      /Габаритные размеры:.*?\(длина\s*×\s*ширина\s*×\s*толщина\)/s,
      `Габаритные размеры: ${dims.length}×${dims.width}×${dims.thickness} мм (длина × ширина проступи × толщина)`
    );
    // Replace calibration description
    text = text.replace(
      /Калибровка:.*?грани --- лицевая и тыльная\)\./s,
      'Калибровка: по плоскостям (лицевая и тыльная грани), кромки обрабатываются по профилю.'
    );
    // Replace "Фаски: 5 мм по всем четырём кромкам"
    text = text.replace(
      /Фаски:.*?кромкам\./,
      'Фаски и профиль капиноса: согласно эскизу изделия.'
    );
  }

  return text;
}

/**
 * Section 5 — customize operation list for operations 17-20
 */
function customizeSection5(text, product) {
  // Pre-process: join lines that were split mid-sentence for ops 17-20
  // Join "НЕ\n> ПРИМЕНЯЕТСЯ" to single line
  text = text.replace(/НЕ\n>\s*ПРИМЕНЯЕТСЯ/g, 'НЕ ПРИМЕНЯЕТСЯ');
  text = text.replace(/НЕ\nПРИМЕНЯЕТСЯ/g, 'НЕ ПРИМЕНЯЕТСЯ');
  // Join split operation lines where the continuation contains "НЕ ПРИМЕНЯЕТСЯ"
  // e.g., "Подготовка к бучардированию (маскирование зон\n> лощения) --- НЕ ПРИМЕНЯЕТСЯ"
  text = text.replace(/(Операция\s*№\s*(?:17|18|19|20)[^\n]*)\n>\s*([^\n]*НЕ ПРИМЕНЯЕТСЯ)/g, '$1 $2');

  if (product.texture === 'лощение') {
    // Remove lines for operations 17-20 entirely (they are not applicable for лощение)
    text = text.split('\n').filter(line => {
      if (/Операция\s*№\s*(17|18|19|20)\b/.test(line)) return false;
      if (line.includes('НЕ ПРИМЕНЯЕТСЯ')) return false;
      return true;
    }).join('\n');
    text = text.replace(/\n{3,}/g, '\n\n');
  } else if (product.texture === 'бучардирование_лощение') {
    text = text.replace(
      /Подготовка к бучардированию.*?---\s*НЕ ПРИМЕНЯЕТСЯ/,
      'Подготовка к бучардированию (маскирование зон лощения)'
    );
    text = text.replace(
      /Бучардирование поверхности.*?---\s*НЕ ПРИМЕНЯЕТСЯ/,
      'Бучардирование поверхности (архитектурная 1 кат.)'
    );
    text = text.replace(
      /Контроль качества бучардирования.*?---\s*НЕ ПРИМЕНЯЕТСЯ/,
      'Контроль качества бучардирования'
    );
    text = text.replace(
      /Доводка после бучардирования.*?---\s*НЕ ПРИМЕНЯЕТСЯ/,
      'Доводка после бучардирования'
    );
  } else if (product.texture === 'рельефная_матовая') {
    text = text.replace(
      /Подготовка к бучардированию.*?---\s*НЕ ПРИМЕНЯЕТСЯ/,
      'Подготовка к рельефной матовой обработке (маскирование зон полировки торцев)'
    );
    text = text.replace(
      /Бучардирование поверхности.*?---\s*НЕ ПРИМЕНЯЕТСЯ/,
      'Нанесение рельефной матовой фактуры на лицевую поверхность'
    );
    text = text.replace(
      /Контроль качества бучардирования.*?---\s*НЕ ПРИМЕНЯЕТСЯ/,
      'Контроль качества рельефной матовой фактуры'
    );
    text = text.replace(
      /Доводка после бучардирования.*?---\s*НЕ ПРИМЕНЯЕТСЯ/,
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
    const rockForms = {
      'гранит':       { gen: 'гранита', nom: 'гранит' },
      'известняк':    { gen: 'известняка', nom: 'известняк' },
      'габбро-диабаз': { gen: 'габбро-диабаза', nom: 'габбро-диабаз' },
      'мраморизированный известняк': { gen: 'мраморизированного известняка', nom: 'мраморизированный известняк' }
    };
    const matType = product.material.type.toLowerCase();
    const forms = rockForms[matType] || { gen: matType + 'а', nom: matType };
    // Use Cyrillic-aware negative lookahead to avoid matching inside "мраморизированный"
    text = text.replace(/мрамора(?![а-яё])/g, forms.gen);
    text = text.replace(/мрамор(?![а-яё])/g, forms.nom);
  }
  return text;
}

/**
 * Section 8 — customize quartz/silicosis note based on material
 */
function customizeSection8(text, product) {
  const matProps = getMaterialProps(product);
  const matTypeName = getMaterialTypeName(product.material.type);
  const matName = product.material.name;

  // Replace the entire quartz/silicosis intro sentence.
  // After parametrize(), the text may already have "гранит м-ния Жалгыз" instead of "мрамор Delikato light".
  // Use a flexible regex to match any material name variant.
  text = text.replace(
    /Несмотря на то что .+?содержит значительно меньше\s*кварца, чем гранит, общецеховые/s,
    `${matTypeName} ${matName} ${matProps.quartzNote}. Общецеховые`
  );

  // Replace remaining rock type references for non-мрамор materials
  if (product.material.type !== 'мрамор') {
    const matType = product.material.type.toLowerCase();
    const rockForms = {
      'гранит':       { gen: 'гранита', nom: 'гранит' },
      'известняк':    { gen: 'известняка', nom: 'известняк' },
      'габбро-диабаз': { gen: 'габбро-диабаза', nom: 'габбро-диабаз' },
      'мраморизированный известняк': { gen: 'мраморизированного известняка', nom: 'мраморизированный известняк' }
    };
    const forms = rockForms[matType] || { gen: matType + 'а', nom: matType };
    text = text.replace(/мрамор(?![а-яё])/g, forms.nom);
    text = text.replace(/мрамора(?![а-яё])/g, forms.gen);
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
    text = before + '10.1. Оборудование\n\n' + equipText + '\n\n' + after;
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
  const matProps = getMaterialProps(product);
  const density = product.material.density;
  const matTypeName = getMaterialTypeName(product.material.type);
  const matName = product.material.name;

  // Bug 5 fix: Replace hardcoded density 1600 with actual product density.
  // The template text has pandoc quoting with "\~" and line continuations ("\n> "),
  // so we use a very flexible regex with /s flag (dot matches newline).
  // After parametrize, the text may say "гранита м-ния Жалгыз" instead of "мрамора Delikato light"
  // and density may still be 1600 (parametrize can't match across \n>).
  const matTypeGen = getMaterialTypeGenitive(product.material.type);
  text = text.replace(
    /Плотность блока .+?принята[\s>\\~]*\d+[\s>]*кг\/м³.+?консервативной оценкой/s,
    `Плотность блока ${matTypeGen} ${matName} принята ~${density} кг/м³ (расчётная масса блока ~${blockMassT} т), что является ${matProps.density_note || 'расчётной оценкой'}`
  );

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
