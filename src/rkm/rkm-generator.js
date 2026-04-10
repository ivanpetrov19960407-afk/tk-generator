'use strict';

const path = require('path');
const fs = require('fs');
const { calcGeometry } = require('./geometry-calc');
const { mapOperations } = require('./operations-mapper');
const { calcMaterials } = require('./materials-calc');
const { calcOverheads } = require('./overhead-calc');
const { buildXlsx } = require('./xlsx-builder');
const { optimizeRKM, getControlUnit, getCalcPrice, detectAreaMode, buildSizeBasedOverrides, buildSizeBasedMaterialPrices, getSizeBasedKReject } = require('./optimizer');
const { checkPriceDeviation } = require('../utils/unit-normalizer');
const rates = require('../../data/rkm_rates.json');
const { getConfig } = require('../config');

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

/**
 * Calculate transport costs.
 */
function calcTransport(product, overheadData) {
  const tr = (product.rkm && product.rkm.transport) || {};
  const logisticsDefaults = getConfig().rkm.logisticsDefaults || {};

  // Если логистика явно отключена для позиции (transport.skip = true)
  if (tr.skip) {
    return {
      distance: 0, tariff: 0, trips: 0, loading: 0, unloading: 0, insurance_pct: 0,
      perevozka: 0, insurance_val: 0, total: 0
    };
  }

  const distance = tr.distance_km ?? logisticsDefaults.distance_km ?? 940;
  const tariff = tr.tariff_rub_km ?? logisticsDefaults.tariff_rub_km ?? 120;
  const trips = tr.trips ?? logisticsDefaults.trips ?? 1;
  const loading = tr.loading ?? logisticsDefaults.loading ?? 25000;
  const unloading = tr.unloading ?? logisticsDefaults.unloading ?? 35000;
  const insurance_pct = tr.insurance_pct ?? logisticsDefaults.insurance_pct ?? 0.005;

  const perevozka = distance * tariff * trips;
  const insurance_val = overheadData.itogo_production * insurance_pct;
  const total = perevozka + loading + unloading + insurance_val;

  return {
    distance, tariff, trips, loading, unloading, insurance_pct,
    perevozka, insurance_val, total
  };
}

/**
 * Main RKM generator function.
 * @param {Object} product - параметры изделия
 * @param {string} outputDir - папка для выходных файлов
 * @param {Object} options - { optimize: false } — включить обратную калькуляцию
 */
async function generateRKM(product, outputDir, options = {}) {
  const doOptimize = options.optimize && product.control_price;
  console.log(`\n[RKM] Генерация РКМ для: ${product.name || 'изделие'}`);
  if (doOptimize) {
    console.log(`  [ОПТИМИЗАЦИЯ] Контрольная цена: ${product.control_price} руб`);
  }

  // === Площадной режим (без подмены размеров) ===
  // Определяем area mode для любого продукта с единицей кв.м./пог.м.
  const areaMode = detectAreaMode(product);

  // === Оптимизация ===
  let optimizerInfo = null;
  let workProduct = product;

  if (doOptimize) {
    const optResult = optimizeRKM(product, product.control_price, { tolerance: 0.10 });
    optimizerInfo = {
      control_price: product.control_price,
      control_unit: product.control_unit || 'шт',
      converged: optResult.converged,
      stage: optResult.stage,
      log: optResult.log,
      area_mode: optResult.area_mode || null,
      market_price_recommendation: optResult.market_price_recommendation || null
    };

    if (optResult.area_mode) {
      const am = optResult.area_mode;
      const dims = am.originalDims;
      console.log(`  [ПЛОЩАДНОЙ РЕЖИМ] ${am.controlUnit === 'm2' ? 'кв.м.' : 'пог.м.'}: ${am.totalArea.toFixed(1)} ${am.controlUnit === 'm2' ? 'м²' : 'м.п.'}, ${am.quantityPieces} шт (${dims.length}×${dims.width}×${dims.thickness}мм)`);
    }

    if (optResult.converged) {
      workProduct = optResult.optimized_product;
      console.log(`  [ОПТИМИЗАЦИЯ] Сходимость достигнута на этапе ${optResult.stage}`);
    } else {
      workProduct = optResult.optimized_product;
      if (optResult.market_price_recommendation) {
        console.warn(`  [РЫНОЧНАЯ ЦЕНА] Рекомендуемая цена: ${optResult.market_price_recommendation.toFixed(2)} руб`);
      } else {
        console.warn(`  [ОПТИМИЗАЦИЯ] Не удалось войти в коридор \u00b115%`);
      }
    }
    optResult.log.forEach(l => console.log(`    ${l}`));
  }

  // === Площадной режим без --optimize ===
  // Если не оптимизация, но единица м²/м.п. — применяем size-based overrides
  // к реальному продукту (без подмены размеров)
  if (!doOptimize && areaMode) {
    workProduct = deepClone(product); // клон с РЕАЛЬНЫМИ размерами
    // Установить quantity_pieces из areaMode если не задано
    if (!workProduct.quantity_pieces && areaMode.quantityPieces) {
      workProduct.quantity_pieces = areaMode.quantityPieces;
    }
    const realGeometry = calcGeometry(workProduct);
    const V_net = realGeometry.V_net;
    const qty = workProduct.quantity_pieces || 1;
    if (!workProduct.rkm) workProduct.rkm = {};
    const userNormsOvr = workProduct.rkm.norms_override || {};
    workProduct.rkm.norms_override = { ...buildSizeBasedOverrides(workProduct, realGeometry, areaMode), ...userNormsOvr };
    // Для площадных позиций size-based цены имеют приоритет над дефолтными из JSON
    const userMatPrices = workProduct.rkm.material_prices || {};
    workProduct.rkm.material_prices = { ...buildSizeBasedMaterialPrices(V_net, qty), ...userMatPrices };
    if (!product.rkm || !product.rkm.k_reject) {
      workProduct.rkm.k_reject = getSizeBasedKReject(V_net);
    }

    const dims = product.dimensions;
    console.log(`  [ПЛОЩАДНОЙ РЕЖИМ] ${areaMode.controlUnit === 'm2' ? 'кв.м.' : 'пог.м.'}: ${areaMode.totalArea.toFixed(1)} ${areaMode.controlUnit === 'm2' ? 'м²' : 'м.п.'}, ${qty} шт (${dims.length}×${dims.width}×${dims.thickness}мм)`);
  }

  // === Основной расчёт ===
  // 1. Geometry
  const geometry = calcGeometry(workProduct);
  console.log(`  Геометрия: V_net=${geometry.V_net.toFixed(6)} м³, масса=${geometry.mass_piece.toFixed(2)} кг`);
  console.log(`  Потребность сырья: ${geometry.raw_need_batch.toFixed(6)} м³, стоимость: ${geometry.raw_cost_batch.toFixed(2)} руб`);

  // 2. Operations
  const operations = mapOperations(workProduct, geometry);
  console.log(`  Операций: ${operations.rows.length}, прямые затраты: ${operations.totals.itogo_pryamye.toFixed(2)} руб`);

  // 3. Materials
  const curAreaMode = areaMode || (optimizerInfo && optimizerInfo.area_mode) || null;
  const unitLabel = curAreaMode ? (curAreaMode.controlUnit === 'm2' ? 'м²' : 'м.п.') : 'шт';
  const materials = calcMaterials(workProduct, geometry, unitLabel);
  console.log(`  Материалы: ${materials.total.toFixed(2)} руб`);

  // 4. Overheads (two-pass: first without transport, then with)
  // Применяем переопределения накладных если они есть
  const origOH = { ...rates.overheads };
  const ohOverrides = (workProduct.rkm && workProduct.rkm.overrides_overheads) || {};
  for (const [k, v] of Object.entries(ohOverrides)) {
    if (v !== undefined) rates.overheads[k] = v;
  }

  const tempTransport = { total: 0 };
  const tempOverheads = calcOverheads(materials, operations, tempTransport, geometry);

  // 5. Transport
  const transport = calcTransport(workProduct, tempOverheads);
  console.log(`  Логистика: ${transport.total.toFixed(2)} руб`);

  // 6. Final overheads
  const overheads = calcOverheads(materials, operations, transport, geometry);

  // Восстанавливаем оригинальные настройки накладных
  Object.assign(rates.overheads, origOH);

  console.log(`  ИТОГО без НДС: ${overheads.itogo_bez_NDS.toFixed(2)} руб`);
  console.log(`  НДС: ${overheads.NDS.toFixed(2)} руб`);
  console.log(`  ИТОГО с НДС: ${overheads.itogo_s_NDS.toFixed(2)} руб`);

  if (doOptimize) {
    const ctrlUnit = getControlUnit(workProduct);
    const calcPrice = getCalcPrice(overheads, ctrlUnit);
    const ratio = calcPrice / product.control_price;
    console.log(`  [СВЕРКА] Расчёт: ${calcPrice.toFixed(2)}, Контроль: ${product.control_price.toFixed(2)}, Отклонение: ${((ratio - 1) * 100).toFixed(1)}%`);
    // Sanity-проверка: расчётная цена не должна отклоняться от контрольной более чем в 10 раз
    checkPriceDeviation(calcPrice, product.control_price, product.control_unit || 'ед', `Поз.${product.tk_number}`);
  }

  // 7. Build Excel
  // Размеры теперь всегда реальные — originalProduct не нужен
  const wb = await buildXlsx(workProduct, geometry, operations, materials, transport, overheads, optimizerInfo, {
    areaMode: areaMode || (optimizerInfo && optimizerInfo.area_mode) || null
  });

  // 8. Save
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const shortId = workProduct.short_name || `pos_${String(workProduct.tk_number || 0).padStart(2, '0')}`;
  const fileName = `RKM_${shortId}.xlsx`;
  const filePath = path.join(outputDir, fileName);

  await wb.xlsx.writeFile(filePath);
  console.log(`  [RKM] Файл сохранен: ${filePath}`);

  return {
    success: true,
    file: filePath,
    optimized: doOptimize || false,
    converged: optimizerInfo ? optimizerInfo.converged : null,
    summary: {
      materials: materials.total,
      operations: operations.totals.itogo_pryamye,
      logistics: transport.total,
      itogo_bez_NDS: overheads.itogo_bez_NDS,
      itogo_s_NDS: overheads.itogo_s_NDS,
      per_piece_s_NDS: overheads.per_piece_s_NDS,
      per_m2_s_NDS: overheads.per_m2_s_NDS,
      control_price: product.control_price || null
    }
  };
}

/**
 * Pre-calculate production cost (without transport) for a product.
 * Used for proportional logistics distribution across batch.
 */
function calcProductionCost(product) {
  const { calcGeometry: cg } = require('./geometry-calc');
  const { mapOperations: mo } = require('./operations-mapper');
  const { calcMaterials: cm } = require('./materials-calc');
  const { calcOverheads: co } = require('./overhead-calc');
  const { detectAreaMode: dam, buildSizeBasedOverrides: bso, buildSizeBasedMaterialPrices: bsmp, getSizeBasedKReject: gskr } = require('./optimizer');

  const workProduct = deepClone(product);
  const areaMode = dam(workProduct);
  if (areaMode && !workProduct.quantity_pieces && areaMode.quantityPieces) {
    workProduct.quantity_pieces = areaMode.quantityPieces;
  }

  if (areaMode) {
    const realGeo = cg(workProduct);
    const V_net = realGeo.V_net;
    const qty = workProduct.quantity_pieces || 1;
    if (!workProduct.rkm) workProduct.rkm = {};
    workProduct.rkm.norms_override = bso(workProduct, realGeo, areaMode);
    workProduct.rkm.material_prices = { ...(workProduct.rkm.material_prices || {}), ...bsmp(V_net, qty) };
    if (!product.rkm || !product.rkm.k_reject) {
      workProduct.rkm.k_reject = gskr(V_net);
    }
  }

  const geometry = cg(workProduct);
  const operations = mo(workProduct, geometry);
  const unitLabel = areaMode ? (areaMode.controlUnit === 'm2' ? 'м²' : 'м.п.') : 'шт';
  const materials = cm(workProduct, geometry, unitLabel);
  const tempTransport = { total: 0 };
  const overheads = co(materials, operations, tempTransport, geometry);

  return {
    itogo_production: overheads.itogo_production,
    mass_batch: geometry.mass_batch
  };
}

module.exports = { generateRKM, calcTransport, calcProductionCost };
