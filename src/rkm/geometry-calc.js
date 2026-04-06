'use strict';

const rates = require('../../data/rkm_rates.json');

/**
 * Calculate all geometry values for a product.
 * Dimensions in input are mm, converted to m for calculations.
 */
function calcGeometry(product) {
  const L_mm = product.dimensions.length;
  const W_mm = product.dimensions.width;
  const T_mm = product.dimensions.thickness;

  const L = L_mm / 1000;
  const W = W_mm / 1000;
  const T = T_mm / 1000;

  const qty = product.quantity_pieces || 1;
  const density = (product.material && product.material.density) || 2700;

  // Coefficients
  const rkm = product.rkm || {};
  const k_allow = rates.materials_prices.k_allow;
  const k_reject = rkm.k_reject || rates.materials_prices.k_reject['стандарт'];
  const k_reserve = rates.materials_prices.k_reserve;

  // Block price: нечёткий поиск по имени камня в справочнике
  const materialName = (product.material && product.material.name) || '';
  const materialType = (product.material && product.material.type) || '';
  let blockPriceFromRef = null;

  // 1. Точное совпадение
  blockPriceFromRef = rates.materials_prices.blocks[materialName] || null;

  // 2. Нормализованное совпадение (пробелы/подчёркивания)
  if (!blockPriceFromRef) {
    const norm = materialName.replace(/[\s_]+/g, '_').toLowerCase();
    for (const [key, price] of Object.entries(rates.materials_prices.blocks)) {
      if (key.replace(/[\s_]+/g, '_').toLowerCase() === norm) {
        blockPriceFromRef = price; break;
      }
    }
  }

  // 3. Поиск по ключевому слову (Деликато, Жалгыз, Fatima, Габбро)
  if (!blockPriceFromRef) {
    const lc = materialName.toLowerCase();
    if (lc.includes('delikato') || lc.includes('деликато')) {
      blockPriceFromRef = rates.materials_prices.blocks['Delikato_light'];
    } else if (lc.includes('жалгыз')) {
      blockPriceFromRef = rates.materials_prices.blocks['Жалгыз'];
    } else if (lc.includes('fatima') || lc.includes('фатима')) {
      blockPriceFromRef = rates.materials_prices.blocks['Fatima'];
    } else if (lc.includes('габбро')) {
      blockPriceFromRef = rates.materials_prices.blocks['Габбро-диабаз_Нинимяки'];
    }
  }

  // 4. Fallback по типу материала
  if (!blockPriceFromRef && materialType) {
    const typeLc = materialType.toLowerCase();
    if (typeLc.includes('габбро')) blockPriceFromRef = rates.materials_prices.blocks['Габбро-диабаз_Нинимяки'];
    else if (typeLc.includes('известняк')) blockPriceFromRef = rates.materials_prices.blocks['Fatima'];
  }

  const blockPrice = rkm.block_price || blockPriceFromRef || 170200;

  // Volume
  const V_net = L * W * T;

  // Areas
  const area_top = L * W;
  const area_bottom = L * W;
  const area_front = L * T;
  const area_back = L * T;
  const area_ends = 2 * W * T;
  const area_total = 2 * area_top + 2 * area_front + area_ends;

  // Profile/perimeter
  const profileLength = L + 2 * W;
  const perimeter = 4 * (L + W + T);

  // Mass
  const mass_piece = V_net * density;
  const mass_batch = mass_piece * qty;

  // Raw material need
  const raw_need_batch = V_net * qty * k_allow * k_reject * k_reserve;
  const raw_need_piece = raw_need_batch / qty;
  const raw_cost_batch = raw_need_batch * blockPrice;
  const raw_cost_piece = raw_cost_batch / qty;

  // Base areas for unit cost
  const base_m2 = area_top;
  const base_mp = L;

  return {
    L_mm, W_mm, T_mm,
    L, W, T,
    qty,
    density,
    k_allow, k_reject, k_reserve,
    blockPrice,
    V_net,
    area_top, area_bottom, area_front, area_back, area_ends, area_total,
    profileLength, perimeter,
    mass_piece, mass_batch,
    raw_need_batch, raw_need_piece,
    raw_cost_batch, raw_cost_piece,
    base_m2, base_mp,
    V_batch: V_net * qty
  };
}

module.exports = { calcGeometry };
