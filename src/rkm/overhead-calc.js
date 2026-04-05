'use strict';

const rates = require('../../data/rkm_rates.json');

/**
 * Calculate overheads, reserves, profit, and final totals.
 */
function calcOverheads(materials, operations, transport, geometry) {
  const oh = rates.overheads;
  const qty = geometry.qty;

  const materialsTotal = materials.total;
  const operationsTotal = operations.totals.itogo_pryamye;
  const FOT_total = operations.totals.FOT;
  const strakhovye_total = operations.totals.strakhovye;

  // Overhead base = FOT + strakhovye (matching reference: "База накладных (ФОТ+страх.взносы)")
  const nakladnye_base = FOT_total + strakhovye_total;
  const nakladnye = nakladnye_base * oh.nakladnye_ot_FOT;

  // Intermediate cost = materials + operations + overhead
  const promezhutochnaya_sebestoimost = materialsTotal + operationsTotal + nakladnye;

  // Reserve for technical risks
  const rezerv = promezhutochnaya_sebestoimost * oh.rezerv_tekh_riskov;

  // Full cost with reserve
  const sebestoimost_s_rezervom = promezhutochnaya_sebestoimost + rezerv;

  // Profit
  const pribyl = sebestoimost_s_rezervom * oh.pribyl_ot_sebestoimosti;

  // Production total (without logistics)
  const itogo_production = sebestoimost_s_rezervom + pribyl;

  // Logistics
  const logisticsTotal = transport.total;

  // Grand totals
  const itogo_bez_NDS = itogo_production + logisticsTotal;
  const NDS = itogo_bez_NDS * oh.NDS;
  const itogo_s_NDS = itogo_bez_NDS + NDS;

  // Per-piece
  const per_piece_bez_NDS = itogo_bez_NDS / qty;
  const per_piece_s_NDS = itogo_s_NDS / qty;

  // Per m2
  const base_m2_total = geometry.base_m2 * qty;
  const per_m2_bez_NDS = itogo_bez_NDS / base_m2_total;
  const per_m2_s_NDS = itogo_s_NDS / base_m2_total;

  // Per m.p.
  const base_mp_total = geometry.base_mp * qty;
  const per_mp_bez_NDS = itogo_bez_NDS / base_mp_total;
  const per_mp_s_NDS = itogo_s_NDS / base_mp_total;

  return {
    materialsTotal,
    operationsTotal,
    FOT_total,
    strakhovye_total,
    nakladnye_base,
    nakladnye,
    promezhutochnaya_sebestoimost,
    rezerv,
    sebestoimost_s_rezervom,
    pribyl,
    itogo_production,
    logisticsTotal,
    itogo_bez_NDS,
    NDS,
    itogo_s_NDS,
    per_piece_bez_NDS,
    per_piece_s_NDS,
    per_m2_bez_NDS,
    per_m2_s_NDS,
    per_mp_bez_NDS,
    per_mp_s_NDS,
    base_m2_total,
    base_mp_total
  };
}

module.exports = { calcOverheads };
