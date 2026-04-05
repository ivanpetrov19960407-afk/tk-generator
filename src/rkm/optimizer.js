'use strict';

const { calcGeometry } = require('./geometry-calc');
const { mapOperations } = require('./operations-mapper');
const { calcMaterials } = require('./materials-calc');
const { calcOverheads } = require('./overhead-calc');
const rates = require('../../data/rkm_rates.json');
const sizeProfiles = require('../../data/rkm_size_profiles.json');

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

function calcSerialFactor(qty) {
  if (qty <= 1) return 1.0;
  return Math.max(0.3, 1.0 / Math.pow(qty, 0.08));
}

function getControlUnit(product) {
  const unit = (product.control_unit || product.unit || 'шт').toLowerCase().replace(/\./g, '').trim();
  if (unit.includes('кв') || unit.includes('м2') || unit === 'квм') return 'm2';
  if (unit.includes('пог') || unit.includes('мп') || unit.includes('погм')) return 'mp';
  return 'piece';
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
// РАСЧЁТ ОДНОГО ПРОХОДА
// ============================================================

function calcPass(product, overheadOverrides) {
  const origOH = { ...rates.overheads };
  if (overheadOverrides) {
    for (const [k, v] of Object.entries(overheadOverrides)) {
      if (v !== undefined) rates.overheads[k] = v;
    }
  }

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
  Object.assign(rates.overheads, origOH);

  return { geometry, operations, materials, transport, overheads,
    per_piece_s_NDS: overheads.per_piece_s_NDS,
    per_m2_s_NDS: overheads.per_m2_s_NDS,
    per_mp_s_NDS: overheads.per_mp_s_NDS };
}

// ============================================================
// SIZE-BASED ПЕРВИЧНОЕ МАСШТАБИРОВАНИЕ
// ============================================================

function calcAdjustedNorm(opNo, baseNorm, geometry, complexityType, qty) {
  if (baseNorm === 0) return 0;
  const minNorm = baseNorm * 0.005;

  if (BATCH_OPS.has(opNo)) {
    return Math.max(minNorm, baseNorm / qty);
  }

  const alpha = sizeProfiles.operation_alpha[String(opNo)] || 0.25;
  const sizeRatio = calcSizeRatio(opNo, geometry);
  const complexity = sizeProfiles.complexity_multipliers[complexityType] || 1.0;
  const serialFactor = calcSerialFactor(qty);

  return Math.max(minNorm, baseNorm * (alpha + (1 - alpha) * sizeRatio * complexity) * serialFactor);
}

function buildSizeBasedOverrides(product, geometry) {
  const norms = require('../../data/rkm_norms.json');
  const ct = product.geometry_type || 'profile';
  const qty = product.quantity_pieces || 1;
  const overrides = {};
  for (const op of norms.operations) {
    overrides[op.no] = {
      chel_ch: Math.round(calcAdjustedNorm(op.no, op.base_chel_ch, geometry, ct, qty) * 1000) / 1000,
      mash_ch: Math.round(calcAdjustedNorm(op.no, op.base_mash_ch, geometry, ct, qty) * 1000) / 1000
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
 * Стратегия (4 этапа):
 * 0. Расчёт «как есть» → проверка.
 * 1-2. Size-based масштабирование (нормы, расходники, k_reject) → проверка.
 * 3. Итеративный подбор глобального множителя норм (binary search) → проверка.
 * 4. Подстройка накладных/прибыли/резерва (binary search) → финал.
 */
function optimizeRKM(product, controlPrice, options = {}) {
  const tolerance = options.tolerance || 0.15;
  const targetRatio = options.target_ratio || 0.95;
  const log = [];
  const controlUnit = getControlUnit(product);

  // --- ЭТАП 0 ---
  const baseResult = calcPass(product);
  const basePrice = getCalcPrice(baseResult, controlUnit);
  const baseRatio = basePrice / controlPrice;
  log.push(`[Этап 0] Без оптимизации: calc=${basePrice.toFixed(2)}, ctrl=${controlPrice.toFixed(2)}, ratio=${(baseRatio*100).toFixed(1)}%`);

  if (baseRatio >= (1 - tolerance) && baseRatio <= (1 + tolerance)) {
    log.push(`[OK] В коридоре.`);
    return { optimized_product: deepClone(product), result: baseResult, log, converged: true, stage: 0 };
  }

  // --- ЭТАП 1-2: Size-based ---
  const opt = deepClone(product);
  const geometry = calcGeometry(opt);
  const V_net = geometry.V_net;
  const qty = opt.quantity_pieces || 1;

  if (!opt.rkm) opt.rkm = {};
  opt.rkm.norms_override = buildSizeBasedOverrides(opt, geometry);
  opt.rkm.material_prices = { ...buildSizeBasedMaterialPrices(V_net, qty), ...(opt.rkm.material_prices || {}) };
  if (!product.rkm || !product.rkm.k_reject) {
    opt.rkm.k_reject = getSizeBasedKReject(V_net);
  }

  const r1 = calcPass(opt);
  const p1 = getCalcPrice(r1, controlUnit);
  const ratio1 = p1 / controlPrice;
  log.push(`[Этап 1-2] Size-based: calc=${p1.toFixed(2)}, ratio=${(ratio1*100).toFixed(1)}%`);

  if (ratio1 >= (1 - tolerance) && ratio1 <= (1 + tolerance)) {
    log.push(`[OK] Попали в коридор.`);
    return { optimized_product: opt, result: r1, log, converged: true, stage: 2 };
  }

  // --- ЭТАП 3: Бинарный поиск по глобальному множителю норм ---
  // Ищем multiplier M такой, что при norm[i] = sizeBasedNorm[i] * M цена ≈ target
  const norms = require('../../data/rkm_norms.json');
  const sizeOverrides = deepClone(opt.rkm.norms_override);

  let loM = 0.01, hiM = 20.0; // диапазон множителя
  let bestOpt = deepClone(opt);
  let bestResult = r1;
  let bestRatio = ratio1;

  for (let i = 0; i < 40; i++) {
    const midM = (loM + hiM) / 2;

    // Применяем множитель к size-based нормам
    const testOpt = deepClone(opt);
    for (const op of norms.operations) {
      const key = String(op.no);
      const sizeNorm = sizeOverrides[key];
      if (!sizeNorm) continue;

      // Ограничения: [0.5%..300%] от базовой нормы
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

    // Ранний выход если попали
    if (tRatio >= (1 - tolerance) && tRatio <= (1 + tolerance)) {
      log.push(`[Этап 3] Бинарный поиск: M=${midM.toFixed(4)}, calc=${tp.toFixed(2)}, ratio=${(tRatio*100).toFixed(1)}%`);
      return { optimized_product: testOpt, result: tr, log, converged: true, stage: 3 };
    }

    if (Math.abs(hiM - loM) < 0.001) break;
  }

  log.push(`[Этап 3] Лучший M: ratio=${(bestRatio*100).toFixed(1)}%`);

  // Проверяем, попали ли
  if (bestRatio >= (1 - tolerance) && bestRatio <= (1 + tolerance)) {
    return { optimized_product: bestOpt, result: bestResult, log, converged: true, stage: 3 };
  }

  // --- ЭТАП 4: Подстройка накладных ---
  const ranges = sizeProfiles.overhead_tuning_ranges;
  const overheadTuning = {};
  const isExpensive = bestRatio > 1.0 + tolerance;

  if (isExpensive) {
    // Снижаем: прибыль → накладные → резерв
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
    // Повышаем: прибыль → накладные
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
    return { optimized_product: bestOpt, result: finalResult, log, converged: true, stage: 4 };
  }

  // --- ЭТАП 5: Подбор k_reject и цены блока ---
  // Если всё равно дорого — снижаем k_reject (меньше брака = меньше сырья)
  // Если дёшево — повышаем k_reject
  log.push(`[Этап 5] Подбор k_reject/k_allow...`);

  if (finalRatio > 1.0 + tolerance) {
    // Снижаем k_reject до минимума 1.05
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

  log.push(`[Этап 5] Финал: calc=${finalPrice.toFixed(2)}, ratio=${(finalRatio*100).toFixed(1)}%, converged=${converged}`);

  return { optimized_product: bestOpt, result: finalResult, log, converged, stage: 5 };
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
  calcSerialFactor
};
