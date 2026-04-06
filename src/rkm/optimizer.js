'use strict';

const { calcGeometry } = require('./geometry-calc');
const { mapOperations } = require('./operations-mapper');
const { calcMaterials } = require('./materials-calc');
const { calcOverheads } = require('./overhead-calc');
const { normalizeUnit } = require('../utils/unit-normalizer');
const rates = require('../../data/rkm_rates.json');
const sizeProfiles = require('../../data/rkm_size_profiles.json');
// Fix: загружаем norms один раз на уровне модуля, а не внутри функций/циклов
const norms = require('../../data/rkm_norms.json');

// ============================================================
// КОНСТАНТЫ И УТИЛИТЫ
// ============================================================

function getSizeCategory(V_net) {
  if (V_net <= 0.01) return 'small';
  if (V_net <= 0.05) return 'medium';
  if (V_net <= 0.2)  return 'large';
  return 'xlarge';
}

function calcSizeRatio(opNo, geometry) {
  const ref = sizeProfiles.reference_product;
  const methods = sizeProfiles.size_ratio_method;
  if (methods.by_length.includes(opNo)) return geometry.L / ref.length_ref_m;
  if (methods.by_area.includes(opNo))   return geometry.area_top / ref.area_ref_m2;
  return geometry.V_net / ref.V_ref_m3;
}

// Партионные операции (1 раз на партию — контроль, настройка, раскрой, комплектация)
const BATCH_OPS = new Set([1, 2, 3, 6, 9, 10, 24, 25]);

/**
 * Коэффициент серийности.
 * Базовый — по количеству штук.
 * Усиленный — для площадных позиций с большим объёмом (>100 м²):
 *   массовая плитка обрабатывается на поточных линиях — нормы снижаются сильнее.
 */
function calcSerialFactor(qty, areaMode) {
  if (qty <= 1) return 1.0;
  if (areaMode && areaMode.totalArea > 100) {
    // Массовое производство: конвейерная обработка мелкой плитки
    // При qty=3344 → factor=0.131 (было 0.321 с exp=0.14)
    return Math.max(0.05, 1.0 / Math.pow(qty, 0.25));
  }
  return Math.max(0.3, 1.0 / Math.pow(qty, 0.08));
}

function getControlUnit(product) {
  // Если measurement_type уже определён ранее — используем его напрямую
  if (product.measurement_type) {
    switch (product.measurement_type) {
      case 'area':   return 'm2';
      case 'length': return 'mp';
      case 'count':  return 'piece';
      // 'unknown' — НЕ fallback в piece, логируем предупреждение
      default:
        console.warn(`[getControlUnit] measurement_type="${product.measurement_type}" для "${product.name || 'изделие'}" — используется piece (проверьте единицу)`);
        return 'piece';
    }
  }

  // Fallback: нормализуем control_unit через словарь
  const rawUnit = product.control_unit || product.unit || '';
  const { measurement_type } = normalizeUnit(rawUnit);
  switch (measurement_type) {
    case 'area':   return 'm2';
    case 'length': return 'mp';
    case 'count':  return 'piece';
    default:
      if (rawUnit) {
        console.warn(`[getControlUnit] Нераспознанная единица "${rawUnit}" для "${product.name || 'изделие'}" — используется piece`);
      }
      return 'piece';
  }
}

function getCalcPrice(result, controlUnit) {
  switch (controlUnit) {
    case 'm2':  return result.per_m2_s_NDS;
    case 'mp':  return result.per_mp_s_NDS;
    default:    return result.per_piece_s_NDS;
  }
}

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

// ============================================================
// ПЛОЩАДНОЙ РЕЖИМ: определение метаданных (без подмены размеров)
// ============================================================

/**
 * Определяет, нужен ли площадной режим.
 * Площадной режим включается автоматически, если единица контрольной цены —
 * кв.м. или пог.м. Размеры изделия НЕ подменяются — остаются реальные.
 * Возвращает метаданные для корректного расчёта удельных цен.
 *
 * @returns {Object|null} — { enabled, controlUnit, originalDims, pieceArea_m2, totalArea, quantityPieces }
 */
function detectAreaMode(product) {
  const controlUnit = getControlUnit(product);
  if (controlUnit === 'piece') return null;

  const dims = product.dimensions;
  if (!dims) return null;

  const L_mm = dims.length;
  const W_mm = dims.width;
  const T_mm = dims.thickness;

  // Площадь одной штуки (м²)
  const pieceArea_m2 = (L_mm / 1000) * (W_mm / 1000);
  // Длина одной штуки (м)
  const pieceLength_m = L_mm / 1000;

  // Считаем общее количество в единицах (м² или м.п.)
  const qtyStr = product.quantity || '';
  const qtyMatch = qtyStr.match(/[\d.,]+/);
  const totalQtyInUnits = qtyMatch ? parseFloat(qtyMatch[0].replace(',', '.')) : (product.quantity_pieces || 1);

  let totalArea = 0;
  let totalLength = 0;

  if (controlUnit === 'm2') {
    totalArea = totalQtyInUnits; // уже в м²
  } else {
    // m.p.
    totalLength = totalQtyInUnits;
    totalArea = totalQtyInUnits * (W_mm / 1000); // приблизительная площадь
  }

  return {
    enabled: true,
    controlUnit,
    originalDims: { length: L_mm, width: W_mm, thickness: T_mm },
    pieceArea_m2,
    pieceLength_m,
    totalArea,
    totalLength,
    quantityPieces: product.quantity_pieces || Math.ceil(totalQtyInUnits / pieceArea_m2)
  };
}

// ============================================================
// РАСЧЁТ ОДНОГО ПРОХОДА
// ============================================================

function calcPass(product, overheadOverrides) {
  const origOH = { ...rates.overheads };
  if (overheadOverrides) {
    for (const [k, v] of Object.entries(overheadOverrides)) {
      if (v !== undefined) rates.overheads[k] = v;
    }
  }

  // Fix: try/finally гарантирует восстановление rates.overheads даже при ошибке
  try {
    const geometry = calcGeometry(product);
    const operations = mapOperations(product, geometry);
    const materials = calcMaterials(product, geometry);

    const rkm = product.rkm || {};
    const tr = rkm.transport || {};
    const tempTransport = { total: 0 };
    const tempOH = calcOverheads(materials, operations, tempTransport, geometry);

    const distance = tr.distance_km || 940;
    const tariff = tr.tariff_rub_km || 120;
    const trips = tr.trips || 1;
    const loading = tr.loading || 25000;
    const unloading = tr.unloading || 35000;
    const insurance_pct = tr.insurance_pct || 0.005;

    const perevozka = distance * tariff * trips;
    const insurance_val = tempOH.itogo_production * insurance_pct;
    const transport = { distance, tariff, trips, loading, unloading, insurance_pct, perevozka, insurance_val, total: perevozka + loading + unloading + insurance_val };

    const overheads = calcOverheads(materials, operations, transport, geometry);

    return { geometry, operations, materials, transport, overheads,
      per_piece_s_NDS: overheads.per_piece_s_NDS,
      per_m2_s_NDS: overheads.per_m2_s_NDS,
      per_mp_s_NDS: overheads.per_mp_s_NDS };
  } finally {
    // Всегда восстанавливаем оригинальные накладные, даже при исключении
    Object.assign(rates.overheads, origOH);
  }
}

// ============================================================
// SIZE-BASED ПЕРВИЧНОЕ МАСШТАБИРОВАНИЕ
// ============================================================

function calcAdjustedNorm(opNo, baseNorm, geometry, complexityType, qty, areaMode) {
  if (baseNorm === 0) return 0;
  const minNorm = baseNorm * 0.005;

  if (BATCH_OPS.has(opNo)) {
    return Math.max(minNorm, baseNorm / qty);
  }

  const alpha = sizeProfiles.operation_alpha[String(opNo)] || 0.25;
  const sizeRatio = calcSizeRatio(opNo, geometry);
  const complexity = sizeProfiles.complexity_multipliers[complexityType] || 1.0;
  const serialFactor = calcSerialFactor(qty, areaMode);

  return Math.max(minNorm, baseNorm * (alpha + (1 - alpha) * sizeRatio * complexity) * serialFactor);
}

function buildSizeBasedOverrides(product, geometry, areaMode) {
  const ct = product.geometry_type || 'profile';
  const qty = product.quantity_pieces || 1;
  const overrides = {};
  for (const op of norms.operations) {
    overrides[op.no] = {
      chel_ch: Math.round(calcAdjustedNorm(op.no, op.base_chel_ch, geometry, ct, qty, areaMode) * 1000) / 1000,
      mash_ch: Math.round(calcAdjustedNorm(op.no, op.base_mash_ch, geometry, ct, qty, areaMode) * 1000) / 1000
    };
  }
  return overrides;
}

function buildSizeBasedMaterialPrices(V_net, qty) {
  const cat = getSizeCategory(V_net);
  const base = { ...sizeProfiles.material_price_profiles[cat] };
  if (qty && qty > 10) {
    const serialK = Math.max(0.05, 1.0 / Math.pow(qty / 10, 0.3));
    ['abrasives', 'coolant_chemistry', 'protective_materials', 'packaging', 'marking', 'ppe'].forEach(key => {
      if (base[key]) base[key] = Math.round(base[key] * serialK);
    });
  }
  return base;
}

function getSizeBasedKReject(V_net) {
  const cat = getSizeCategory(V_net);
  return sizeProfiles.k_reject_by_size[cat];
}

// ============================================================
// ГЛАВНЫЙ ОПТИМИЗАТОР
// ============================================================

/**
 * Оптимизация РКМ: подбор параметров чтобы цена попала в коридор ±tolerance от controlPrice.
 *
 * Стратегия (5 этапов + площадной режим):
 * 0. Расчёт «как есть» → проверка.
 * 0.5. [НОВОЕ] Если единица кв.м./пог.м. — автоматический переход в площадной режим
 *     (виртуальное изделие 1м²/1м.п., усиленная серийность).
 * 1-2. Size-based масштабирование (нормы, расходники, k_reject) → проверка.
 * 3. Итеративный подбор глобального множителя норм (binary search) → проверка.
 * 4. Подстройка накладных/прибыли/резерва (binary search) → финал.
 * 5. Подбор k_reject → финал.
 */
function optimizeRKM(product, controlPrice, options = {}) {
  const tolerance = options.tolerance || 0.15;
  const targetRatio = options.target_ratio || 0.95;
  const log = [];
  const controlUnit = getControlUnit(product);

  // --- Площадной режим: автодетект (без подмены размеров) ---
  const areaMode = detectAreaMode(product);
  let workProduct = product;

  if (areaMode) {
    // Установить quantity_pieces если не задано (критично для корректного расчёта геометрии)
    if (!product.quantity_pieces && areaMode.quantityPieces) {
      product.quantity_pieces = areaMode.quantityPieces;
      workProduct = product;
    }
    const dims = areaMode.originalDims;
    log.push(`[Площадной режим] Единица: ${controlUnit === 'm2' ? 'кв.м.' : 'пог.м.'}`);
    log.push(`  Реальное изделие: ${dims.length}×${dims.width}×${dims.thickness}мм, ${product.quantity_pieces} шт (≈${areaMode.totalArea.toFixed(1)} м²)`);
    if (areaMode.totalArea > 100) {
      log.push(`  Усиленная серийность: партия >100 м² → поточная линия`);
    }
  }

  // --- ЭТАП 0 ---
  const baseResult = calcPass(workProduct);
  const basePrice = getCalcPrice(baseResult, controlUnit);
  const baseRatio = basePrice / controlPrice;
  log.push(`[Этап 0] Без оптимизации: calc=${basePrice.toFixed(2)}, ctrl=${controlPrice.toFixed(2)}, ratio=${(baseRatio*100).toFixed(1)}%`);

  if (baseRatio >= (1 - tolerance) && baseRatio <= (1 + tolerance)) {
    log.push(`[OK] В коридоре.`);
    return { optimized_product: deepClone(workProduct), result: baseResult, log, converged: true, stage: 0, area_mode: areaMode };
  }

  // --- ЭТАП 1-2: Size-based ---
  const opt = deepClone(workProduct);
  const geometry = calcGeometry(opt);
  const V_net = geometry.V_net;
  const qty = opt.quantity_pieces || 1;

  if (!opt.rkm) opt.rkm = {};
  opt.rkm.norms_override = buildSizeBasedOverrides(opt, geometry, areaMode);
  // Для площадных позиций size-based цены имеют приоритет над дефолтными из JSON
  opt.rkm.material_prices = areaMode
    ? { ...(opt.rkm.material_prices || {}), ...buildSizeBasedMaterialPrices(V_net, qty) }
    : { ...buildSizeBasedMaterialPrices(V_net, qty), ...(opt.rkm.material_prices || {}) };
  if (!product.rkm || !product.rkm.k_reject) {
    opt.rkm.k_reject = getSizeBasedKReject(V_net);
  }

  const r1 = calcPass(opt);
  const p1 = getCalcPrice(r1, controlUnit);
  const ratio1 = p1 / controlPrice;
  log.push(`[Этап 1-2] Size-based: calc=${p1.toFixed(2)}, ratio=${(ratio1*100).toFixed(1)}%`);

  if (ratio1 >= (1 - tolerance) && ratio1 <= (1 + tolerance)) {
    log.push(`[OK] Попали в коридор.`);
    return { optimized_product: opt, result: r1, log, converged: true, stage: 2, area_mode: areaMode };
  }

  // --- ЭТАП 3: Бинарный поиск по глобальному множителю норм ---
  const sizeOverrides = deepClone(opt.rkm.norms_override);

  let loM = 0.01, hiM = 20.0;
  let bestOpt = deepClone(opt);
  let bestResult = r1;
  let bestRatio = ratio1;

  for (let i = 0; i < 40; i++) {
    const midM = (loM + hiM) / 2;

    const testOpt = deepClone(opt);
    for (const op of norms.operations) {
      const key = String(op.no);
      const sizeNorm = sizeOverrides[key];
      if (!sizeNorm) continue;

      let ch = sizeNorm.chel_ch * midM;
      let mh = sizeNorm.mash_ch * midM;
      ch = Math.max(op.base_chel_ch * 0.005, Math.min(op.base_chel_ch * 3.0, ch));
      mh = Math.max(op.base_mash_ch * 0.005, Math.min(op.base_mash_ch * 3.0, mh));
      testOpt.rkm.norms_override[key] = { chel_ch: Math.round(ch*1000)/1000, mash_ch: Math.round(mh*1000)/1000 };
    }

    const tr = calcPass(testOpt);
    const tp = getCalcPrice(tr, controlUnit);
    const tRatio = tp / controlPrice;

    if (Math.abs(tRatio - targetRatio) < Math.abs(bestRatio - targetRatio)) {
      bestOpt = testOpt;
      bestResult = tr;
      bestRatio = tRatio;
    }

    if (tRatio > targetRatio) {
      hiM = midM;
    } else {
      loM = midM;
    }

    if (tRatio >= (1 - tolerance) && tRatio <= (1 + tolerance)) {
      log.push(`[Этап 3] Бинарный поиск: M=${midM.toFixed(4)}, calc=${tp.toFixed(2)}, ratio=${(tRatio*100).toFixed(1)}%`);
      return { optimized_product: testOpt, result: tr, log, converged: true, stage: 3, area_mode: areaMode };
    }

    if (Math.abs(hiM - loM) < 0.001) break;
  }

  log.push(`[Этап 3] Лучший M: ratio=${(bestRatio*100).toFixed(1)}%`);

  if (bestRatio >= (1 - tolerance) && bestRatio <= (1 + tolerance)) {
    return { optimized_product: bestOpt, result: bestResult, log, converged: true, stage: 3, area_mode: areaMode };
  }

  // --- ЭТАП 4: Подстройка накладных ---
  const ranges = sizeProfiles.overhead_tuning_ranges;
  const overheadTuning = {};
  const isExpensive = bestRatio > 1.0 + tolerance;

  if (isExpensive) {
    const params = [
      { key: 'pribyl_ot_sebestoimosti', min: ranges.pribyl_ot_sebestoimosti.min, max: ranges.pribyl_ot_sebestoimosti.default },
      { key: 'nakladnye_ot_FOT', min: ranges.nakladnye_ot_FOT.min, max: ranges.nakladnye_ot_FOT.default },
      { key: 'rezerv_tekh_riskov', min: ranges.rezerv_tekh_riskov.min, max: ranges.rezerv_tekh_riskov.default }
    ];
    for (const param of params) {
      let lo = param.min, hi = param.max;
      for (let i = 0; i < 25; i++) {
        const mid = (lo + hi) / 2;
        overheadTuning[param.key] = mid;
        const tp = getCalcPrice(calcPass(bestOpt, overheadTuning), controlUnit);
        if (tp / controlPrice > targetRatio) hi = mid; else lo = mid;
        if (Math.abs(tp / controlPrice - targetRatio) < 0.005) break;
      }
      const checkP = getCalcPrice(calcPass(bestOpt, overheadTuning), controlUnit);
      if (checkP / controlPrice >= (1 - tolerance) && checkP / controlPrice <= (1 + tolerance)) break;
    }
  } else {
    const params = [
      { key: 'pribyl_ot_sebestoimosti', min: rates.overheads.pribyl_ot_sebestoimosti, max: 0.55 },
      { key: 'nakladnye_ot_FOT', min: rates.overheads.nakladnye_ot_FOT, max: 4.0 }
    ];
    for (const param of params) {
      let lo = param.min, hi = param.max;
      for (let i = 0; i < 25; i++) {
        const mid = (lo + hi) / 2;
        overheadTuning[param.key] = mid;
        const tp = getCalcPrice(calcPass(bestOpt, overheadTuning), controlUnit);
        if (tp / controlPrice < targetRatio) lo = mid; else hi = mid;
        if (Math.abs(tp / controlPrice - targetRatio) < 0.005) break;
      }
      const checkP = getCalcPrice(calcPass(bestOpt, overheadTuning), controlUnit);
      if (checkP / controlPrice >= (1 - tolerance) && checkP / controlPrice <= (1 + tolerance)) break;
    }
  }

  bestOpt.rkm.overrides_overheads = overheadTuning;
  let finalResult = calcPass(bestOpt, overheadTuning);
  let finalPrice = getCalcPrice(finalResult, controlUnit);
  let finalRatio = finalPrice / controlPrice;
  let converged = finalRatio >= (1 - tolerance) && finalRatio <= (1 + tolerance);

  log.push(`[Этап 4] После накладных: calc=${finalPrice.toFixed(2)}, ratio=${(finalRatio*100).toFixed(1)}%`);
  for (const [k, v] of Object.entries(overheadTuning)) {
    log.push(`  ${k}: ${(v*100).toFixed(1)}% (было ${(rates.overheads[k]*100).toFixed(1)}%)`);
  }

  if (converged) {
    return { optimized_product: bestOpt, result: finalResult, log, converged: true, stage: 4, area_mode: areaMode };
  }

  // --- ЭТАП 5: Подбор k_reject и цены блока ---
  log.push(`[Этап 5] Подбор k_reject/k_allow...`);

  if (finalRatio > 1.0 + tolerance) {
    let lo = 1.05, hi = bestOpt.rkm.k_reject || 1.4;
    for (let i = 0; i < 25; i++) {
      const mid = (lo + hi) / 2;
      const testOpt = deepClone(bestOpt);
      testOpt.rkm.k_reject = mid;
      const tr = calcPass(testOpt, overheadTuning);
      const tp = getCalcPrice(tr, controlUnit);
      if (tp / controlPrice > targetRatio) hi = mid; else lo = mid;
      if (Math.abs(tp / controlPrice - targetRatio) < 0.005) break;
    }
    bestOpt.rkm.k_reject = Math.round((lo + hi) / 2 * 100) / 100;
    log.push(`  k_reject: ${bestOpt.rkm.k_reject}`);
  }

  finalResult = calcPass(bestOpt, overheadTuning);
  finalPrice = getCalcPrice(finalResult, controlUnit);
  finalRatio = finalPrice / controlPrice;
  converged = finalRatio >= (1 - tolerance) && finalRatio <= (1 + tolerance);

  // --- Пометка «рыночная цена» для несходящихся позиций ---
  if (!converged) {
    log.push(`[Этап 5] НЕ УДАЛОСЬ войти в коридор: calc=${finalPrice.toFixed(2)}, ratio=${(finalRatio*100).toFixed(1)}%`);
    log.push(`[РЫНОЧНАЯ ЦЕНА] Себестоимость материалов и операций превышает контрольную цену.`);
    log.push(`  Рекомендация: обосновать новую рыночную цену ${finalPrice.toFixed(2)} руб/${controlUnit === 'm2' ? 'м²' : controlUnit === 'mp' ? 'м.п.' : 'шт'}`);
  } else {
    log.push(`[Этап 5] Финал: calc=${finalPrice.toFixed(2)}, ratio=${(finalRatio*100).toFixed(1)}%, converged=${converged}`);
  }

  return {
    optimized_product: bestOpt,
    result: finalResult,
    log,
    converged,
    stage: 5,
    area_mode: areaMode,
    market_price_recommendation: !converged ? finalPrice : null
  };
}

module.exports = {
  optimizeRKM,
  getSizeCategory,
  buildSizeBasedOverrides,
  buildSizeBasedMaterialPrices,
  getSizeBasedKReject,
  calcPass,
  getControlUnit,
  getCalcPrice,
  calcSerialFactor,
  detectAreaMode
};
