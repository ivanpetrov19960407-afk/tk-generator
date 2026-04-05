'use strict';

const path = require('path');
const fs = require('fs');
const { calcGeometry } = require('./geometry-calc');
const { mapOperations } = require('./operations-mapper');
const { calcMaterials } = require('./materials-calc');
const { calcOverheads } = require('./overhead-calc');
const { buildXlsx } = require('./xlsx-builder');
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
 */
async function generateRKM(product, outputDir) {
  console.log(`\n[RKM] Генерация РКМ для: ${product.name || 'изделие'}`);

  // 1. Calculate geometry
  const geometry = calcGeometry(product);
  console.log(`  Геометрия: V_net=${geometry.V_net.toFixed(6)} м³, масса=${geometry.mass_piece.toFixed(2)} кг`);
  console.log(`  Потребность сырья: ${geometry.raw_need_batch.toFixed(6)} м³, стоимость: ${geometry.raw_cost_batch.toFixed(2)} руб`);

  // 2. Map operations
  const operations = mapOperations(product, geometry);
  console.log(`  Операций: ${operations.rows.length}, прямые затраты: ${operations.totals.itogo_pryamye.toFixed(2)} руб`);

  // 3. Calculate materials
  const materials = calcMaterials(product, geometry);
  console.log(`  Материалы: ${materials.total.toFixed(2)} руб`);

  // 4. Calculate overheads (without transport first to get itogo_production)
  // We need a two-pass approach: first compute production total, then transport (which depends on it)
  const tempTransport = { total: 0 };
  const tempOverheads = calcOverheads(materials, operations, tempTransport, geometry);

  // 5. Calculate transport (depends on itogo_production for insurance)
  const transport = calcTransport(product, tempOverheads);
  console.log(`  Логистика: ${transport.total.toFixed(2)} руб`);

  // 6. Final overheads with transport
  const overheads = calcOverheads(materials, operations, transport, geometry);
  console.log(`  ИТОГО без НДС: ${overheads.itogo_bez_NDS.toFixed(2)} руб`);
  console.log(`  НДС: ${overheads.NDS.toFixed(2)} руб`);
  console.log(`  ИТОГО с НДС: ${overheads.itogo_s_NDS.toFixed(2)} руб`);

  // 7. Build Excel
  const wb = await buildXlsx(product, geometry, operations, materials, transport, overheads);

  // 8. Save
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Use short_name or tk_number for filename (full name is too long)
  const shortId = product.short_name || `pos_${String(product.tk_number || 0).padStart(2, '0')}`;
  const fileName = `RKM_${shortId}.xlsx`;
  const filePath = path.join(outputDir, fileName);

  await wb.xlsx.writeFile(filePath);
  console.log(`  [RKM] Файл сохранен: ${filePath}`);

  return {
    success: true,
    file: filePath,
    summary: {
      materials: materials.total,
      operations: operations.totals.itogo_pryamye,
      logistics: transport.total,
      itogo_bez_NDS: overheads.itogo_bez_NDS,
      itogo_s_NDS: overheads.itogo_s_NDS,
      per_piece_s_NDS: overheads.per_piece_s_NDS,
      per_m2_s_NDS: overheads.per_m2_s_NDS
    }
  };
}

module.exports = { generateRKM };
