'use strict';

const rates = require('../../data/rkm_rates.json');
const norms = require('../../data/rkm_norms.json');

/**
 * Map operations from norms to RKM table rows.
 * Filters by texture, calculates FOT, insurance, machine costs, energy.
 */
function mapOperations(product, geometry) {
  const texture = (product.texture || '').toLowerCase();
  const hasBucharda = texture.includes('бучардирование');
  const qty = geometry.qty;
  const overrides = (product.rkm && product.rkm.norms_override) || {};

  const strakhovye_rate = rates.overheads.strakhovye_vznosy;
  const energy_price = rates.overheads.elektroenergiya_rub_kWh;

  const rows = [];

  for (const op of norms.operations) {
    // Filter by applies_when
    if (op.applies_when === 'бучардирование' && !hasBucharda) continue;

    // Get norms (allow overrides)
    const override = overrides[op.no] || {};
    const chel_ch_sht = override.chel_ch || op.base_chel_ch;
    const mash_ch_sht = override.mash_ch || op.base_mash_ch;
    const chel_ch_party = chel_ch_sht * qty;
    const mash_ch_party = mash_ch_sht * qty;

    // Look up labor rate
    const laborInfo = rates.labor[op.role];
    const stavka = laborInfo ? laborInfo.stavka : 0;

    // Look up equipment
    let tarif = 0;
    let kW = 0;
    if (op.equipment && rates.equipment[op.equipment]) {
      tarif = rates.equipment[op.equipment].tarif;
      kW = rates.equipment[op.equipment].kW;
    }

    // Calculations
    const FOT = chel_ch_party * stavka;
    const strakhovye = FOT * strakhovye_rate;
    const mash_zatraty = mash_ch_party * tarif;
    const kWh_sht = kW * mash_ch_sht;
    const energiya = kW * mash_ch_party * energy_price;
    const itogo_pryamye = FOT + strakhovye + mash_zatraty + energiya;

    rows.push({
      no: op.no,
      name: op.name,
      description: op.description || '',
      equipment: op.equipment || '',
      role: op.role,
      norm_basis: op.norm_basis || '',
      setups: op.setups || '—',
      chel_ch_sht,
      chel_ch_party,
      stavka,
      FOT,
      strakhovye,
      mash_ch_sht,
      mash_ch_party,
      tarif,
      mash_zatraty,
      kW,
      kWh_sht,
      energiya,
      itogo_pryamye,
      comment: op.comment || ''
    });
  }

  // Totals
  const totals = {
    chel_ch_sht: rows.reduce((s, r) => s + r.chel_ch_sht, 0),
    chel_ch_party: rows.reduce((s, r) => s + r.chel_ch_party, 0),
    FOT: rows.reduce((s, r) => s + r.FOT, 0),
    strakhovye: rows.reduce((s, r) => s + r.strakhovye, 0),
    mash_ch_party: rows.reduce((s, r) => s + r.mash_ch_party, 0),
    mash_zatraty: rows.reduce((s, r) => s + r.mash_zatraty, 0),
    energiya: rows.reduce((s, r) => s + r.energiya, 0),
    itogo_pryamye: rows.reduce((s, r) => s + r.itogo_pryamye, 0)
  };

  return { rows, totals };
}

module.exports = { mapOperations };
