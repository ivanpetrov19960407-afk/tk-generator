/**
 * equipment.js — Equipment selection and validation logic
 * Checks product dimensions against equipment limits and generates warnings.
 */

const fs = require('fs');
const path = require('path');

const equipmentData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'equipment.json'), 'utf8')
);

/**
 * Check if a product fits within equipment limits
 * @param {Object} product - Product specification
 * @returns {Object} { equipment: {...}, warnings: [...] }
 */
function analyzeEquipment(product) {
  const dims = product.dimensions;
  const warnings = [];
  const applicable = {};

  // JC-1010: Calibration — max width 1000mm, max height 50mm
  const jc = equipmentData['JC-1010'];
  if (dims.width <= jc.limits.max_width && dims.thickness <= jc.limits.max_height) {
    applicable['JC-1010'] = {
      fits: true,
      note: `ширина ${dims.width} мм ≤ ${jc.limits.max_width} мм, толщина ${dims.thickness} мм ≤ ${jc.limits.max_height} мм`
    };
  } else {
    applicable['JC-1010'] = { fits: false, adapted: true };
    // No warning — operation texts are adapted in parametrize() to use alternative equipment
  }

  // SPG1200-12: Polishing — max width 1200mm, max height 50mm
  const spg = equipmentData['SPG1200-12'];
  if (dims.width <= spg.limits.max_width && dims.thickness <= spg.limits.max_height) {
    applicable['SPG1200-12'] = {
      fits: true,
      note: `ширина ${dims.width} мм ≤ ${spg.limits.max_width} мм, толщина ${dims.thickness} мм ≤ ${spg.limits.max_height} мм`
    };
  } else {
    applicable['SPG1200-12'] = { fits: false, adapted: true };
    // No warning — operation texts are adapted in parametrize() to use ZLMS 2600 only
  }

  // SQC600-4D: Cutting — max depth 180mm, disc 600mm
  const sqc = equipmentData['SQC600-4D'];
  if (dims.thickness <= sqc.limits.max_depth) {
    applicable['SQC600-4D'] = {
      fits: true,
      note: `толщина ${dims.thickness} мм ≤ макс. глубины реза ${sqc.limits.max_depth} мм`
    };
  } else {
    applicable['SQC600-4D'] = { fits: false, adapted: true };
    // No warning — operation texts are adapted in parametrize() to use ЧПУ
  }

  // DWSG-22AX-6P: Wire saw — max 450mm
  const dwsg = equipmentData['DWSG-22AX-6P'];
  const maxProductDim = Math.max(dims.length, dims.width, dims.thickness);
  if (maxProductDim <= dwsg.limits.max_cut_size) {
    applicable['DWSG-22AX-6P'] = {
      fits: true,
      note: `макс. габарит ${maxProductDim} мм ≤ лимита ${dwsg.limits.max_cut_size} мм`
    };
  } else {
    applicable['DWSG-22AX-6P'] = {
      fits: false,
      note: 'Используется для вспомогательной резки при необходимости'
    };
  }

  // ZLMS 2600: Always applicable for polishing
  applicable['ZLMS2600'] = {
    fits: true,
    note: 'Универсальный полировальный станок'
  };

  // SQC2200: Always applicable for primary sawing of blocks
  applicable['SQC2200'] = {
    fits: true,
    note: 'Первичная распиловка блока на слэбы'
  };

  return { applicable, warnings };
}

/**
 * Build the equipment list text for section 10
 * @param {Object} product
 * @returns {string} Formatted equipment list
 */
function buildEquipmentListText(product) {
  const { applicable, warnings } = analyzeEquipment(product);
  const dims = product.dimensions;
  
  const lines = [];
  
  lines.push(`--- Станок резки SQC2200 (диск до 2200 мм) --- первичная распиловка блока на слэбы`);
  lines.push(`--- Мостовые станки SQC600-4D (×2) | макс. глубина реза 180 мм, диаметр диска 600 мм --- раскрой слэбов, чистовая обрезка плит, нарезка фасок`);
  
  if (applicable['JC-1010'].fits) {
    lines.push(`--- Калибровальный станок JC-1010 | макс. ширина обработки 1000 мм --- калибровка толщины плит (ширина плиты ${dims.width} мм --- в пределах лимита)`);
  } else {
    // Adapted: show alternative equipment instead of НЕ ПРИМЕНИМ
    if (dims.thickness > 180) {
      lines.push(`--- Фрезерный ЧПУ/портал --- калибровка плоскостей методом фрезерования (JC-1010 не применяется: толщина ${dims.thickness} мм > 50 мм)`);
    } else {
      lines.push(`--- Мостовой станок SQC600-4D --- калибровка плоскостей методом контрольного пропиливания (JC-1010 не применяется: толщина ${dims.thickness} мм > 50 мм)`);
    }
  }

  lines.push(`--- Полировальные станки ZLMS 2600 (×2) | рабочая зона 2600×900 мм --- лощение лицевых поверхностей`);

  if (applicable['SPG1200-12'].fits) {
    lines.push(`--- Автоматическая полировальная машина SPG1200-12 | макс. ширина 1200 мм, макс. высота 50 мм --- применима для данного изделия (высота ${dims.thickness} мм < 50 мм, ширина ${dims.width} мм < 1200 мм)`);
  } else {
    // Adapted: SPG replaced by ZLMS 2600 in operation texts, no НЕ ПРИМЕНИМА
    lines.push(`--- Лощение выполняется только на ZLMS 2600 (SPG1200-12 не применяется: толщина ${dims.thickness} мм > 50 мм)`);
  }

  lines.push(`--- Компрессор D316Y | рабочее давление 0,8–1,0 МПа --- питание пневмоинструмента (ручная шлифовка фасок, зачистка, доводка)`);
  lines.push(`--- Мостовые краны | грузоподъёмность 5–16 т --- все грузоподъёмные операции`);
  lines.push(`--- Тельферы и электротали | грузоподъёмность 5–16 т --- вспомогательные подъёмные операции`);
  lines.push(`--- Погрузчик RH23 | грузоподъёмность 23 т --- разгрузка блока, перемещение`);
  lines.push(`--- Автопогрузчик вилочный | грузоподъёмность 1,5–5 т --- складские операции, погрузка тары`);
  lines.push(`--- Система водоочистки (×2) | 1000 л/мин каждая --- оборотное водоснабжение, очистка шлама`);
  lines.push(`--- Тягачи Sitrak C7H | до 44 т полная масса автопоезда --- доставка блока, отгрузка`);
  lines.push(`--- Тягачи МАЗ-6430С9 (×2) | нагрузка на седло до 22,5 т --- доставка/отгрузка`);
  lines.push(`--- Сортиментовозы Политранс (×3) | грузоподъёмность 30–40 т --- перевозка блоков`);
  lines.push(`--- Полуприцепы МАЗ (×2) --- грузовые платформы для отгрузки`);
  lines.push(`--- Канатный станок DWSG-22AX-6P | макс. размер реза 450 мм --- вспомогательная резка при необходимости`);

  return lines.join('\n');
}

/**
 * Calculate product mass
 */
function calcProductMass(product) {
  const v = (product.dimensions.length / 1000) * (product.dimensions.width / 1000) * (product.dimensions.thickness / 1000);
  const mass = v * product.material.density;
  return Math.round(mass * 10) / 10; // kg, 1 decimal
}

/**
 * Calculate block mass
 * Standard block: 3200×1500×1000 mm
 */
function calcBlockMass(product) {
  const v = 3.2 * 1.5 * 1.0; // m³
  const mass = v * product.material.density;
  return Math.round(mass / 100) * 100; // round to nearest 100 kg
}

/**
 * Calculate total batch mass
 */
function calcBatchMass(product) {
  const pieceMass = calcProductMass(product);
  const total = pieceMass * product.quantity_pieces;
  return Math.round(total);
}

module.exports = {
  analyzeEquipment,
  buildEquipmentListText,
  calcProductMass,
  calcBlockMass,
  calcBatchMass,
  equipmentData
};
