'use strict';

/**
 * Calculate materials section (10 mandatory items).
 */
function calcMaterials(product, geometry, unitLabel) {
  const qty = geometry.qty;
  const rkm = product.rkm || {};
  const mp = rkm.material_prices || {};
  const texture = (product.texture || '').toLowerCase();
  const hasBucharda = texture.includes('бучардирование');
  const ul = unitLabel || 'шт';

  // Bush-hammer heads: ~2 pcs per m2 of bucharda surface (area_top)
  const buchardaArea = geometry.area_top * qty;
  const bushHammerQty = hasBucharda ? Math.ceil(buchardaArea * 2) : 0;

  const items = [
    {
      no: 1,
      name: `Гранитный блок/сырье месторождения "${product.material.name}" (подбор по оттенку/зернистости, мин. жилы/микротрещины)`,
      unit: 'м\u00B3',
      qty_val: geometry.raw_need_batch,
      price: geometry.blockPrice,
      doc: 'КП/счет поставщика',
      norm: 'ТЗ; расчет объема сырья',
      formula: 'V_партии = V_net\u00D7k_allow\u00D7k_reject\u00D7k_reserve',
      comment: 'Коэф. отбора/брака учитывает отбор и повышенный брак длинномера (>5 м).'
    },
    {
      no: 2,
      name: 'Алмазные диски/канат (износ на распиловку длинномера)',
      unit: 'компл',
      qty_val: 1,
      price: mp.diamond_discs || 10000,
      doc: 'КП поставщика',
      norm: 'внутр. норма износа',
      formula: '1 компл на партию (учет повыш. износа)',
      comment: 'Включено как амортизируемый расход на инструмент.'
    },
    {
      no: 3,
      name: 'Алмазные фрезы/профильные головки (износ)',
      unit: 'компл',
      qty_val: 1,
      price: mp.diamond_milling_heads || 8000,
      doc: 'КП поставщика',
      norm: 'внутр. норма износа',
      formula: '1 компл на партию',
      comment: 'Повышенный риск сколов и перегрева на длине >5 м.'
    },
    {
      no: 4,
      name: 'Бучардировочные головы (пневмо), расход',
      unit: 'шт',
      qty_val: bushHammerQty,
      price: mp.bush_hammer_heads_price || 8500,
      doc: 'КП поставщика',
      norm: 'норма на м2',
      formula: '\u22482 шт/м\u00B2 бучардирования (арх. 1 кат.)',
      comment: 'Расход зависит от требуемой фактуры.'
    },
    {
      no: 5,
      name: 'Абразивы/шлифкруги/черепашки для лощения (набор зернистостей)',
      unit: 'компл',
      qty_val: qty,
      price: mp.abrasives || 6500,
      doc: 'КП поставщика',
      norm: `1 компл на ${ul}`,
      formula: `${qty} компл на ${qty} ${ul}`,
      comment: 'Включая ручную доводку переходов.'
    },
    {
      no: 6,
      name: 'Химия и расходники: СОЖ, чистящие средства, ветошь',
      unit: 'компл',
      qty_val: qty,
      price: mp.coolant_chemistry || 1200,
      doc: 'внутр. лимит/смета',
      norm: `лимит на ${ul}`,
      formula: `1 компл/${ul}`,
      comment: 'Для мойки/сушки между операциями.'
    },
    {
      no: 7,
      name: 'Защитные материалы для разделения зон отделки (скотч, пленка)',
      unit: 'компл',
      qty_val: qty,
      price: mp.protective_materials || 800,
      doc: 'счет',
      norm: `лимит на ${ul}`,
      formula: `1 компл/${ul}`,
      comment: 'Защита зон лощения при бучардировании.'
    },
    {
      no: 8,
      name: 'Усиленная упаковка длинномера: деревянный короб, подкладки, амортизаторы, уголки',
      unit: 'компл',
      qty_val: qty,
      price: mp.packaging || 18000,
      doc: 'КП/смета тары',
      norm: 'по чертежу упаковки',
      formula: `1 короб/${ul}`,
      comment: 'Длина изделия требует усиления и распорок.'
    },
    {
      no: 9,
      name: 'Маркировка/бирки/стрейч/скотч/ремни крепления',
      unit: 'компл',
      qty_val: qty,
      price: mp.marking || 1500,
      doc: 'счет',
      norm: `лимит на ${ul}`,
      formula: `1 компл/${ul}`,
      comment: 'Маркировка, защита кромок.'
    },
    {
      no: 10,
      name: 'СИЗ по операциям (очки, перчатки, респираторы, беруши) — расход',
      unit: 'компл',
      qty_val: qty,
      price: mp.ppe || 600,
      doc: 'счет',
      norm: `лимит на ${ul}`,
      formula: `1 компл/${ul}`,
      comment: 'Пылевые операции (бучардирование/шлифование).'
    }
  ];

  // Calculate sums
  for (const item of items) {
    item.sum = item.qty_val * item.price;
  }

  const total = items.reduce((s, i) => s + i.sum, 0);

  return { items, total };
}

module.exports = { calcMaterials };
