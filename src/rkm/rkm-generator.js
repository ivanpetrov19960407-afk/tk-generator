'use strict';

const path = require('path');
const fs = require('fs');
const { calcGeometry } = require('./geometry-calc');
const { mapOperations } = require('./operations-mapper');
const { calcMaterials } = require('./materials-calc');
const { calcOverheads } = require('./overhead-calc');
const { buildXlsx } = require('./xlsx-builder');
const { optimizeRKM, getControlUnit, getCalcPrice, detectAreaMode } = require('./optimizer');
const rates = require('../../data/rkm_rates.json');

/**
 * Calculate transport costs.
 */
function calcTransport(product, overheadData) {
  const tr = (product.rkm && product.rkm.transport) || {};
  const distance = tr.distance_km || 940;
  const tariff = tr.tariff_rub_km || 120;
  const trips = tr.trips || 1;
  const loading = tr.loading || 25000;
  const unloading = tr.unloading || 35000;
  const insurance_pct = tr.insurance_pct || 0.005;

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

  // === Оптимизация ===
  let optimizerInfo = null;
  let workProduct = product;

  if (doOptimize) {
    const optResult = optimizeRKM(product, product.control_price, { tolerance: 0.15 });
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
      console.log(`  [ПЛОЩАДНОЙ РЕЖИМ] Виртуальное изделие: ${optResult.area_mode.virtualDims.length}×${optResult.area_mode.virtualDims.width}×${optResult.area_mode.virtualDims.thickness}мм, ${optResult.area_mode.virtualQty} шт`);
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

  // === Основной расчёт ===
  // 1. Geometry
  const geometry = calcGeometry(workProduct);
  console.log(`  Геометрия: V_net=${geometry.V_net.toFixed(6)} м³, масса=${geometry.mass_piece.toFixed(2)} кг`);
  console.log(`  Потребность сырья: ${geometry.raw_need_batch.toFixed(6)} м³, стоимость: ${geometry.raw_cost_batch.toFixed(2)} руб`);

  // 2. Operations
  const operations = mapOperations(workProduct, geometry);
  console.log(`  Операций: ${operations.rows.length}, прямые затраты: ${operations.totals.itogo_pryamye.toFixed(2)} руб`);

  // 3. Materials
  const materials = calcMaterials(workProduct, geometry);
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
  }

  // 7. Build Excel
  const wb = await buildXlsx(workProduct, geometry, operations, materials, transport, overheads, optimizerInfo);

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

module.exports = { generateRKM, calcTransport };
