'use strict';

const ExcelJS = require('exceljs');
const rates = require('../../data/rkm_rates.json');

const YELLOW_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
const THIN_BORDER = {
  top: { style: 'thin' }, bottom: { style: 'thin' },
  left: { style: 'thin' }, right: { style: 'thin' }
};
const BOLD_FONT = { bold: true };
const TITLE_FONT = { bold: true, size: 14 };
const HEADER_FONT = { bold: true, size: 10 };
const NUM_FMT_RUB = '#,##0.00';
const NUM_FMT_4D = '#,##0.0000';
const NUM_FMT_6D = '0.000000';

function applyBorderToRange(ws, r1, c1, r2, c2) {
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      ws.getCell(r, c).border = THIN_BORDER;
    }
  }
}

function setColWidths(ws, widths) {
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
}

/**
 * Build the RKM xlsx workbook.
 */
async function buildXlsx(product, geometry, operations, materials, transport, overheads) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TK-Generator / RKM Module';
  wb.created = new Date();

  buildTitleSheet(wb, product, geometry);
  buildInstructionSheet(wb);
  buildInputDataSheet(wb, product, geometry);
  buildGeometrySheet(wb, geometry);
  buildMaterialsSheet(wb, materials);
  const opRowStart = buildOperationsSheet(wb, operations);
  buildOverheadSheet(wb, overheads);
  buildTransportSheet(wb, product, overheads);
  buildTotalSheet(wb, overheads, geometry);
  buildReferenceSheet(wb);

  return wb;
}

// ===== Sheet 1: Титульный лист =====
function buildTitleSheet(wb, product, geometry) {
  const ws = wb.addWorksheet('Титульный лист');
  setColWidths(ws, [20, 80, 15, 15, 15, 15, 15, 15, 15, 15]);

  const company = rates.company;
  const companyBlock = `${company.name}  \nЮр.адрес: ${company.address}  \nИНН: ${company.INN}, КПП: ${company.KPP}  \nР/счет: ${company.rs}, в ${company.bank}  \nК/счет: ${company.ks}, БИК: ${company.BIK}  \nТел.: ${company.tel}, Email: ${company.email}`;

  ws.getCell('B1').value = companyBlock;
  ws.getCell('B1').alignment = { wrapText: true, vertical: 'top' };
  ws.getRow(1).height = 90;

  ws.getCell('A2').value = 'РАСЧЕТНО-КАЛЬКУЛЯЦИОННАЯ ВЕДОМОСТЬ (РКМ)';
  ws.getCell('A2').font = TITLE_FONT;

  const materialText = product.material ? `${product.material.type} месторождения "${product.material.name}"` : '';
  const fullName = `Изделие индивидуальное архитектурное 1-й категории с подбором по оттенку и зернистости с минимальным содержанием жил и микротрещин элемент высокоточного индивидуального изготовления из натурального камня - ${product.name || 'ступень фигурная'}, цельная, сложной конфигурации, с закругленным кантом (капельником) R 25 с механизированной обработкой кромок (калибровка) и с ручной доработкой поверхностей; материал — ${materialText}; обработка поверхности — ${product.texture || 'бучардирование+лощение'}; размеры ${geometry.L_mm}\u00D7${geometry.W_mm}\u00D7${geometry.T_mm}мм (возможная подрезка изделия по месту под фактическую установку)`;

  ws.getCell('A3').value = 'Наименование изделия:';
  ws.getCell('A3').font = BOLD_FONT;
  ws.getCell('B3').value = fullName;
  ws.getCell('B3').alignment = { wrapText: true };
  ws.getRow(3).height = 50;

  ws.getCell('A4').value = 'Материал:';
  ws.getCell('A4').font = BOLD_FONT;
  ws.getCell('B4').value = materialText ? `${product.material.type.charAt(0).toUpperCase() + product.material.type.slice(1)} месторождения "${product.material.name}" ` : '';

  ws.getCell('A5').value = 'Размеры, мм:';
  ws.getCell('A5').font = BOLD_FONT;
  ws.getCell('B5').value = `${geometry.L_mm} \u00D7 ${geometry.W_mm} \u00D7 ${geometry.T_mm}`;

  ws.getCell('A6').value = 'Количество:';
  ws.getCell('A6').font = BOLD_FONT;
  ws.getCell('B6').value = `${geometry.qty} шт.`;

  ws.getCell('A7').value = 'Фактура поверхности ';
  ws.getCell('A7').font = BOLD_FONT;
  ws.getCell('B7').value = formatTexture(product.texture);

  ws.getCell('A8').value = 'Основание расчета:';
  ws.getCell('A8').font = BOLD_FONT;
  ws.getCell('B8').value = 'Техническое задание на разработку ТК и РКМ (2025 г.).';

  ws.getCell('A10').value = 'Составил:';
  ws.getCell('B10').value = '________________ / ____________________';
  ws.getCell('A11').value = 'Проверил (ОТК/нормоконтроль):';
  ws.getCell('B11').value = '________________ / ____________________';
  ws.getCell('A12').value = 'Утвердил:';
  ws.getCell('B12').value = '________________ / ____________________';

  const today = new Date();
  ws.getCell('A14').value = 'Дата:';
  ws.getCell('B14').value = `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`;
}

function formatTexture(t) {
  if (!t) return '';
  if (t.includes('бучардирование') && t.includes('лощение')) {
    return 'Бучардирование + лощение (по проекту/зонам отделки)';
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ===== Sheet 2: Инструкция_серия =====
function buildInstructionSheet(wb) {
  const ws = wb.addWorksheet('Инструкция_серия');
  setColWidths(ws, [100]);
  ws.getCell('A1').value = 'ИНСТРУКЦИЯ ПО РАБОТЕ С РКМ (СЕРИЯ)';
  ws.getCell('A1').font = TITLE_FONT;
  const instructions = [
    '1. Все значения в желтых ячейках — редактируемые параметры.',
    '2. Формулы пересчитываются автоматически при изменении вводных данных.',
    '3. Лист «Вводные_данные» содержит все ставки, коэффициенты и параметры изделия.',
    '4. Лист «Геометрия» рассчитывает объемы, площади и потребность в сырье.',
    '5. Лист «Материалы» (Раздел 1) — стоимость сырья, инструмента и расходников.',
    '6. Лист «Операции» (Раздел 3) — трудозатраты и машинное время по операциям.',
    '7. Лист «Транспорт» (Раздел 2) — логистика.',
    '8. Лист «Накладные_и_прибыль» — расчет накладных, резерва и прибыли.',
    '9. Лист «ИТОГО» — сводная таблица с итоговой стоимостью.',
    '10. Для серии изделий: заполните количество на листе Вводные_данные, пересчет автоматический.',
    '',
    'ВАЖНО: Не удаляйте строки с формулами! При необходимости скройте их.',
    'Коэффициент отбора/брака (k_reject) зависит от длины и сложности изделия.',
    'Страховые взносы начисляются на ФОТ (30.2%).',
    'Накладные расходы начисляются на базу (ФОТ+страх.взносы).',
  ];
  instructions.forEach((line, i) => {
    ws.getCell(`A${i + 3}`).value = line;
  });
}

// ===== Sheet 3: Вводные_данные =====
function buildInputDataSheet(wb, product, geometry) {
  const ws = wb.addWorksheet('Вводные_данные');
  setColWidths(ws, [35, 40, 5, 40, 18, 30, 18, 15, 15, 15]);

  ws.getCell('A1').value = 'ВВОДНЫЕ ДАННЫЕ И ДОПУЩЕНИЯ';
  ws.getCell('A1').font = TITLE_FONT;
  ws.getCell('A2').value = 'Все значения в желтых ячейках — редактируемые (исходные параметры / ставки).';

  // Row 4: section headers
  ws.getCell('A4').value = '1) Параметры изделия';
  ws.getCell('A4').font = BOLD_FONT;
  ws.getCell('D4').value = '2) Материал, коэффициенты потерь и допуски';
  ws.getCell('D4').font = BOLD_FONT;

  const materialText = product.material ? `${product.material.type} месторождения "${product.material.name}"` : '';
  const fullName = `Изделие индивидуальное архитектурное 1-й категории с подбором по оттенку и зернистости с минимальным содержанием жил и микротрещин элемент высокоточного индивидуального изготовления из натурального камня - ${product.name || 'ступень фигурная'}, цельная, сложной конфигурации, с закругленным кантом (капельником) R 25 с механизированной обработкой кромок (калибровка) и с ручной доработкой поверхностей; материал — ${materialText}; обработка поверхности — ${product.texture || 'бучардирование+лощение'}; размеры ${geometry.L_mm}\u00D7${geometry.W_mm}\u00D7${geometry.T_mm}мм (возможная подрезка изделия по месту под фактическую установку)`;

  const rows = [
    // row 5
    ['Наименование', fullName, '', 'Плотность гранита, кг/м3', geometry.density],
    // row 6
    ['Количество, шт', geometry.qty, '', 'Коэф. припусков/керфа (объем), k_allow', geometry.k_allow],
    // row 7
    ['Длина L, мм', geometry.L_mm, '', 'Коэф. отбора/брака (подбор партии), k_reject', geometry.k_reject],
    // row 8
    ['Ширина W, мм', geometry.W_mm, '', 'Тех. запас на партию, k_reserve', geometry.k_reserve],
    // row 9
    ['Толщина T, мм', geometry.T_mm, '', 'Цена гранитного блока, руб/м3 (КП/счет)', geometry.blockPrice],
    // row 10
    ['Подрезка по месту (0=нет, 1=да)', 1, '', '', ''],
    // row 11
    ['Материал (текст для титула)', `${product.material.type.charAt(0).toUpperCase() + product.material.type.slice(1)} месторождения "${product.material.name}" `, '', '', ''],
    // row 12
    ['Фактура/отделка (текст для титула)', formatTexture(product.texture), '', '', ''],
  ];

  rows.forEach((row, i) => {
    const r = i + 5;
    ws.getCell(r, 1).value = row[0];
    ws.getCell(r, 2).value = row[1];
    if (r === 5) {
      ws.getCell(r, 2).alignment = { wrapText: true };
      ws.getRow(r).height = 40;
    }
    if (row[3]) ws.getCell(r, 4).value = row[3];
    if (row[4] !== '' && row[4] !== undefined) {
      ws.getCell(r, 5).value = row[4];
      ws.getCell(r, 5).fill = YELLOW_FILL;
    }
    // Yellow fill for editable cells in column B
    if (typeof row[1] === 'number') {
      ws.getCell(r, 2).fill = YELLOW_FILL;
    }
  });

  // Row 13: Labor rates header
  ws.getCell('A13').value = '3) Тарифы труда (2025), руб/ч (редактируемые)';
  ws.getCell('A13').font = BOLD_FONT;
  ws.getCell('D13').value = '4) Тарифы машинного времени и энергоносителей';
  ws.getCell('D13').font = BOLD_FONT;

  // Row 14: sub-headers
  ws.getCell('A14').value = 'Категория/роль';
  ws.getCell('A14').font = HEADER_FONT;
  ws.getCell('B14').value = 'Ставка, руб/ч';
  ws.getCell('B14').font = HEADER_FONT;
  ws.getCell('D14').value = 'Оборудование/ресурс';
  ws.getCell('D14').font = HEADER_FONT;
  ws.getCell('E14').value = 'Ставка, руб/маш-ч';
  ws.getCell('E14').font = HEADER_FONT;
  ws.getCell('F14').value = 'Примечание';
  ws.getCell('F14').font = HEADER_FONT;
  ws.getCell('G14').value = 'Средн. мощность, кВт';
  ws.getCell('G14').font = HEADER_FONT;

  const laborKeys = Object.keys(rates.labor);
  const equipKeys = Object.keys(rates.equipment);
  const equipNotes = [
    'рез длинномера, учет износа дисков',
    'калибровка плоскостей, толщина 150 мм',
    'контур/карман/капельник',
    'профиль R25 на длине 5,15 м',
    'поверхность 1 кат.',
    'лицевые плоскости',
    'перемещения/перевороты'
  ];

  const maxRows = Math.max(laborKeys.length, equipKeys.length);
  for (let i = 0; i < maxRows; i++) {
    const r = 15 + i;
    if (i < laborKeys.length) {
      ws.getCell(r, 1).value = laborKeys[i];
      ws.getCell(r, 2).value = rates.labor[laborKeys[i]].stavka;
      ws.getCell(r, 2).numFmt = NUM_FMT_RUB;
      ws.getCell(r, 2).fill = YELLOW_FILL;
    }
    if (i < equipKeys.length) {
      ws.getCell(r, 4).value = equipKeys[i];
      ws.getCell(r, 5).value = rates.equipment[equipKeys[i]].tarif;
      ws.getCell(r, 5).numFmt = NUM_FMT_RUB;
      ws.getCell(r, 5).fill = YELLOW_FILL;
      ws.getCell(r, 6).value = equipNotes[i] || '';
      ws.getCell(r, 7).value = rates.equipment[equipKeys[i]].kW;
      ws.getCell(r, 7).fill = YELLOW_FILL;
    }
  }

  // Section 5/6: Base unit costs
  const baseRow = 15 + maxRows + 1;
  ws.getCell(baseRow, 1).value = '5) База удельных расчетов (м\u00B2/м.п.)';
  ws.getCell(baseRow, 1).font = BOLD_FONT;
  ws.getCell(baseRow, 4).value = '6) Методика удельных (справочно)';
  ws.getCell(baseRow, 4).font = BOLD_FONT;

  const br = baseRow + 1;
  ws.getCell(br, 1).value = 'База м\u00B2 на 1 шт, м\u00B2';
  ws.getCell(br, 2).value = geometry.base_m2;
  ws.getCell(br, 2).numFmt = NUM_FMT_4D;
  ws.getCell(br, 2).fill = YELLOW_FILL;
  ws.getCell(br, 3).value = 'По умолчанию: =Геометрия!B9. Можно заменить вручную (единая база для серии).';
  ws.getCell(br, 4).value = 'Методика м\u00B2';
  ws.getCell(br, 5).value = 'верхняя плоскость (L\u00D7W)';
  ws.getCell(br, 6).value = 'Зафиксируйте для всей серии.';
  ws.getCell(br, 7).value = 'Методика м.п.';
  ws.getCell(br, 8).value = 'по длине L';
  ws.getCell(br, 9).value = 'Зафиксируйте для всей серии.';

  const br2 = br + 1;
  ws.getCell(br2, 1).value = 'База м.п. на 1 шт, м';
  ws.getCell(br2, 2).value = geometry.base_mp;
  ws.getCell(br2, 2).numFmt = NUM_FMT_4D;
  ws.getCell(br2, 2).fill = YELLOW_FILL;
  ws.getCell(br2, 3).value = 'По умолчанию: =Геометрия!B16. Можно заменить вручную (единая база для серии).';
  ws.getCell(br2, 4).value = 'Электроэнергия, руб/кВт\u00B7ч';
  ws.getCell(br2, 5).value = rates.overheads.elektroenergiya_rub_kWh;
  ws.getCell(br2, 5).fill = YELLOW_FILL;

  const br3 = br + 2;
  ws.getCell(br3, 4).value = 'Коэф. страховых взносов на ФОТ (пример)';
  ws.getCell(br3, 5).value = rates.overheads.strakhovye_vznosy;
  ws.getCell(br3, 5).fill = YELLOW_FILL;

  const br4 = br + 3;
  ws.getCell(br4, 4).value = 'НДС (ставка 2025), доля';
  ws.getCell(br4, 5).value = rates.overheads.NDS;
  ws.getCell(br4, 5).fill = YELLOW_FILL;

  const br5 = br + 4;
  ws.getCell(br5, 4).value = 'Накладные расходы (от ФОТ рабочих), доля';
  ws.getCell(br5, 5).value = rates.overheads.nakladnye_ot_FOT;
  ws.getCell(br5, 5).fill = YELLOW_FILL;

  const br6 = br + 5;
  ws.getCell(br6, 4).value = 'Прибыль (от себестоимости), доля';
  ws.getCell(br6, 5).value = rates.overheads.pribyl_ot_sebestoimosti;
  ws.getCell(br6, 5).fill = YELLOW_FILL;

  const br7 = br + 6;
  ws.getCell(br7, 4).value = 'Резерв на технологические риски/брак, доля';
  ws.getCell(br7, 5).value = rates.overheads.rezerv_tekh_riskov;
  ws.getCell(br7, 5).fill = YELLOW_FILL;
  ws.getCell(br7, 6).value = 'коэф. на риск длины>5 м, профиль R25, двойная отделка';
}

// ===== Sheet 4: Геометрия =====
function buildGeometrySheet(wb, g) {
  const ws = wb.addWorksheet('Геометрия');
  setColWidths(ws, [45, 18, 35, 5, 40, 18, 15, 15, 15, 15]);

  ws.getCell('A1').value = 'ГЕОМЕТРИЯ, ОБЪЕМЫ И ПЛОЩАДИ';
  ws.getCell('A1').font = TITLE_FONT;
  ws.getCell('A2').value = `Расчет выполнен по габаритам изделия ${g.L_mm}\u00D7${g.W_mm}\u00D7${g.T_mm} мм; длина допускает подрезку по месту (учтено коэффициентом k_reserve).`;

  // Headers row 4
  ws.getCell('A4').value = 'Параметр';
  ws.getCell('A4').font = HEADER_FONT;
  ws.getCell('B4').value = 'Значение';
  ws.getCell('B4').font = HEADER_FONT;
  ws.getCell('C4').value = 'Формула/источник';
  ws.getCell('C4').font = HEADER_FONT;
  ws.getCell('E4').value = 'Расчет потребности в сырье (гранитный блок)';
  ws.getCell('E4').font = HEADER_FONT;

  const geoRows = [
    // Row 5
    ['Длина L, м', g.L, 'из ТЗ', 'Коэф. Припусков', g.k_allow],
    // Row 6
    ['Ширина W, м', g.W, 'из ТЗ', 'Коэф. отбора/брака', g.k_reject],
    // Row 7
    ['Толщина T, м', g.T, 'из ТЗ', 'Тех. Запас', g.k_reserve],
    // Row 8
    ['Объем чистый V_net, м\u00B3 (1 шт)', g.V_net, 'L\u00D7W\u00D7T', 'Потребность объема сырья, м\u00B3 (на партию)', g.raw_need_batch],
    // Row 9
    ['Площадь верхней плоскости, м\u00B2', g.area_top, 'L\u00D7W', 'Потребность объема сырья, м\u00B3 (на 1 шт)', g.raw_need_piece],
    // Row 10
    ['Площадь нижней плоскости, м\u00B2', g.area_bottom, 'L\u00D7W', 'Стоимость сырья, руб (на партию)', g.raw_cost_batch],
    // Row 11
    ['Площадь лицевой (передней) грани, м\u00B2', g.area_front, 'L\u00D7T', 'Стоимость сырья, руб (на 1 шт)', g.raw_cost_piece],
    // Row 12
    ['Площадь тыльной грани, м\u00B2', g.area_back, 'L\u00D7T', '', ''],
    // Row 13
    ['Площадь торцов (2 шт), м\u00B2', g.area_ends, '2\u00D7W\u00D7T', '', ''],
    // Row 14
    ['Полная площадь всех граней, м\u00B2', g.area_total, 'сумма', '', ''],
    // Row 15
    ['Длина профиля R25 (фронт + торцы), пог.м', g.profileLength, 'L + 2\u00D7W', '', ''],
    // Row 16
    ['Периметр для калибровки/кромок (все ребра), пог.м', g.perimeter, '12 ребер', '', ''],
    // Row 17
    ['Масса 1 шт, кг', g.mass_piece, 'V_net\u00D7плотность', '', ''],
    // Row 18
    ['Количество, шт', g.qty, '', '', ''],
    // Row 19
    ['Объем чистый на партию, м\u00B3', g.V_batch, 'V_net\u00D7кол-во', '', ''],
    // Row 20
    ['Масса партии, кг', g.mass_batch, 'масса\u00D7кол-во', '', ''],
  ];

  geoRows.forEach((row, i) => {
    const r = 5 + i;
    ws.getCell(r, 1).value = row[0];
    ws.getCell(r, 2).value = row[1];
    ws.getCell(r, 2).numFmt = typeof row[1] === 'number' && row[1] < 1 ? NUM_FMT_6D : NUM_FMT_4D;
    ws.getCell(r, 3).value = row[2];
    if (row[3]) {
      ws.getCell(r, 5).value = row[3];
      if (row[4] !== '' && row[4] !== undefined) {
        ws.getCell(r, 6).value = row[4];
        ws.getCell(r, 6).numFmt = typeof row[4] === 'number' && row[4] > 100 ? NUM_FMT_RUB : NUM_FMT_6D;
      }
    }
  });

  // Row 22, 23: base areas for unit cost
  ws.getCell(22, 1).value = 'Площадь для удельной стоимости, м\u00B2 (на 1 шт)';
  ws.getCell(22, 2).value = g.base_m2;
  ws.getCell(22, 2).numFmt = NUM_FMT_4D;
  ws.getCell(22, 3).value = 'по умолчанию: верхняя плоскость (B9). Можно заменить.';

  ws.getCell(23, 1).value = 'Длина для удельной стоимости, м.п. (на 1 шт)';
  ws.getCell(23, 2).value = g.base_mp;
  ws.getCell(23, 2).numFmt = NUM_FMT_4D;
  ws.getCell(23, 3).value = 'по умолчанию: длина L (B5). Можно заменить.';

  applyBorderToRange(ws, 4, 1, 20, 3);
  applyBorderToRange(ws, 4, 5, 11, 6);
}

// ===== Sheet 5: Материалы =====
function buildMaterialsSheet(wb, materials) {
  const ws = wb.addWorksheet('Материалы');
  setColWidths(ws, [5, 60, 8, 14, 14, 16, 22, 22, 30, 35]);

  ws.getCell('A1').value = 'РАЗДЕЛ 1 — МАТЕРИАЛЫ, ИНСТРУМЕНТ, УПАКОВКА';
  ws.getCell('A1').font = TITLE_FONT;
  ws.getCell('A2').value = 'Требование: каждая статья имеет формулу количества и реквизит подтверждающего документа (может быть заполнен позже).';

  // Header row 4
  const headers = ['№', 'Наименование (полное)', 'Ед.', 'Кол-во (партия)', 'Цена, руб/ед', 'Сумма, руб', 'Подтв. документ', 'Норматив/основание', 'Формула/расчет количества', 'Комментарий'];
  headers.forEach((h, i) => {
    const cell = ws.getCell(4, i + 1);
    cell.value = h;
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.border = THIN_BORDER;
    cell.alignment = { wrapText: true };
  });

  // Data rows starting at row 5
  materials.items.forEach((item, i) => {
    const r = 5 + i;
    ws.getCell(r, 1).value = item.no;
    ws.getCell(r, 1).border = THIN_BORDER;
    ws.getCell(r, 2).value = item.name;
    ws.getCell(r, 2).border = THIN_BORDER;
    ws.getCell(r, 2).alignment = { wrapText: true };
    ws.getCell(r, 3).value = item.unit;
    ws.getCell(r, 3).border = THIN_BORDER;

    // Qty - use value (editable)
    ws.getCell(r, 4).value = item.qty_val;
    ws.getCell(r, 4).numFmt = item.no === 1 ? NUM_FMT_6D : '0';
    ws.getCell(r, 4).border = THIN_BORDER;
    ws.getCell(r, 4).fill = YELLOW_FILL;

    // Price
    ws.getCell(r, 5).value = item.price;
    ws.getCell(r, 5).numFmt = NUM_FMT_RUB;
    ws.getCell(r, 5).border = THIN_BORDER;
    ws.getCell(r, 5).fill = YELLOW_FILL;

    // Sum = formula D*E
    const dRef = `D${r}`;
    const eRef = `E${r}`;
    ws.getCell(r, 6).value = { formula: `${dRef}*${eRef}` };
    ws.getCell(r, 6).numFmt = NUM_FMT_RUB;
    ws.getCell(r, 6).border = THIN_BORDER;

    ws.getCell(r, 7).value = item.doc;
    ws.getCell(r, 7).border = THIN_BORDER;
    ws.getCell(r, 8).value = item.norm;
    ws.getCell(r, 8).border = THIN_BORDER;
    ws.getCell(r, 9).value = item.formula;
    ws.getCell(r, 9).border = THIN_BORDER;
    ws.getCell(r, 10).value = item.comment;
    ws.getCell(r, 10).border = THIN_BORDER;
    ws.getCell(r, 10).alignment = { wrapText: true };
  });

  // ИТОГО row
  const totalRow = 5 + materials.items.length + 1;
  ws.getCell(totalRow, 5).value = 'ИТОГО материалы, руб:';
  ws.getCell(totalRow, 5).font = BOLD_FONT;
  ws.getCell(totalRow, 6).value = { formula: `SUM(F5:F${totalRow - 2})` };
  ws.getCell(totalRow, 6).numFmt = NUM_FMT_RUB;
  ws.getCell(totalRow, 6).font = BOLD_FONT;
  ws.getCell(totalRow, 6).border = THIN_BORDER;
}

// ===== Sheet 6: Операции =====
function buildOperationsSheet(wb, operations) {
  const ws = wb.addWorksheet('Операции');
  // 21 columns: A-U
  setColWidths(ws, [4, 35, 40, 30, 25, 25, 18, 10, 12, 12, 14, 14, 10, 12, 12, 14, 10, 10, 12, 14, 35]);

  ws.getCell('A1').value = 'РАЗДЕЛ 3 — ТЕХНОЛОГИЧЕСКИЕ ОПЕРАЦИИ (ТРУД И МАШИННОЕ ВРЕМЯ)';
  ws.getCell('A1').font = TITLE_FONT;
  ws.getCell('A2').value = 'Трудозатраты нормированы по операциям. Машинное время включает переналадку и простои из-за длинномера.';

  // Header row 4
  const headers = [
    '№', 'Операция', 'Содержание/примечание', 'Оборудование', 'Исполнитель (роль)',
    'Норматив/основание', 'Установки/перевороты', 'Чел-час/шт', 'Чел-час/партия',
    'Ставка, руб/ч', 'ФОТ, руб', 'Страх.взносы, руб', 'Маш-ч/шт', 'Маш-ч/партия',
    'Тариф, руб/маш-ч', 'Маш.затраты, руб', 'Мощн., кВт', 'кВт\u00B7ч/шт',
    'Энергия, руб', 'Итого прямые, руб', 'Комментарий'
  ];

  headers.forEach((h, i) => {
    const cell = ws.getCell(4, i + 1);
    cell.value = h;
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.border = THIN_BORDER;
    cell.alignment = { wrapText: true, vertical: 'middle' };
  });
  ws.getRow(4).height = 35;

  // Data rows starting at row 5
  const dataStart = 5;
  operations.rows.forEach((op, i) => {
    const r = dataStart + i;
    ws.getCell(r, 1).value = op.no;
    ws.getCell(r, 2).value = op.name;
    ws.getCell(r, 2).alignment = { wrapText: true };
    ws.getCell(r, 3).value = op.description;
    ws.getCell(r, 3).alignment = { wrapText: true };
    ws.getCell(r, 4).value = op.equipment;
    ws.getCell(r, 5).value = op.role;
    ws.getCell(r, 6).value = op.norm_basis;
    ws.getCell(r, 7).value = op.setups;

    // Чел-ч/шт (H) - editable
    ws.getCell(r, 8).value = op.chel_ch_sht;
    ws.getCell(r, 8).fill = YELLOW_FILL;

    // Чел-ч/партия (I) = formula: H * qty (from Вводные_данные)
    ws.getCell(r, 9).value = { formula: `H${r}*\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!B6` };
    // Fall back to pre-computed for compatibility
    ws.getCell(r, 9).value = op.chel_ch_party;

    // Ставка (J) - editable
    ws.getCell(r, 10).value = op.stavka;
    ws.getCell(r, 10).numFmt = NUM_FMT_RUB;

    // ФОТ (K) = I * J
    ws.getCell(r, 11).value = { formula: `I${r}*J${r}` };
    ws.getCell(r, 11).numFmt = NUM_FMT_RUB;

    // Страх.взносы (L) = K * 0.302
    ws.getCell(r, 12).value = { formula: `K${r}*0.302` };
    ws.getCell(r, 12).numFmt = NUM_FMT_RUB;

    // Маш-ч/шт (M) - editable
    ws.getCell(r, 13).value = op.mash_ch_sht;
    ws.getCell(r, 13).fill = YELLOW_FILL;

    // Маш-ч/партия (N) = M * qty
    ws.getCell(r, 14).value = op.mash_ch_party;

    // Тариф (O)
    ws.getCell(r, 15).value = op.tarif;
    ws.getCell(r, 15).numFmt = NUM_FMT_RUB;

    // Маш.затраты (P) = N * O
    ws.getCell(r, 16).value = { formula: `N${r}*O${r}` };
    ws.getCell(r, 16).numFmt = NUM_FMT_RUB;

    // Мощн. кВт (Q)
    ws.getCell(r, 17).value = op.kW;

    // кВт·ч/шт (R) = Q * M
    ws.getCell(r, 18).value = { formula: `Q${r}*M${r}` };

    // Энергия (S) = Q * N * 12
    ws.getCell(r, 19).value = { formula: `Q${r}*N${r}*12` };
    ws.getCell(r, 19).numFmt = NUM_FMT_RUB;

    // ИТОГО прямые (T) = K + L + P + S
    ws.getCell(r, 20).value = { formula: `K${r}+L${r}+P${r}+S${r}` };
    ws.getCell(r, 20).numFmt = NUM_FMT_RUB;

    // Comment (U)
    ws.getCell(r, 21).value = op.comment;
    ws.getCell(r, 21).alignment = { wrapText: true };

    // Borders for all cells
    for (let c = 1; c <= 21; c++) {
      ws.getCell(r, c).border = THIN_BORDER;
    }
  });

  // ИТОГО row
  const lastDataRow = dataStart + operations.rows.length - 1;
  const totalRow = lastDataRow + 2;

  ws.getCell(totalRow, 2).value = 'ИТОГО по операциям';
  ws.getCell(totalRow, 2).font = BOLD_FONT;
  ws.getCell(totalRow, 7).value = '—';

  // Sum formulas for totals
  const sumCols = [8, 9, 11, 12, 14, 16, 19, 20];
  const colLetters = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U'];

  for (const c of sumCols) {
    const col = colLetters[c - 1];
    ws.getCell(totalRow, c).value = { formula: `SUM(${col}${dataStart}:${col}${lastDataRow})` };
    ws.getCell(totalRow, c).numFmt = NUM_FMT_RUB;
    ws.getCell(totalRow, c).font = BOLD_FONT;
    ws.getCell(totalRow, c).border = THIN_BORDER;
  }

  ws.getCell(totalRow, 10).value = '—';

  return dataStart;
}

// ===== Sheet 7: Накладные_и_прибыль =====
function buildOverheadSheet(wb, oh) {
  const ws = wb.addWorksheet('Накладные_и_прибыль');
  setColWidths(ws, [50, 22, 50, 15, 15, 15, 15, 15, 15, 15]);

  ws.getCell('A1').value = 'НАКЛАДНЫЕ РАСХОДЫ, РЕЗЕРВЫ И ПРИБЫЛЬ';
  ws.getCell('A1').font = TITLE_FONT;
  ws.getCell('A2').value = 'База начисления раскрыта формулами. Проценты — во вводных данных.';

  ws.getCell('A4').value = 'Показатель';
  ws.getCell('A4').font = HEADER_FONT;
  ws.getCell('A4').fill = HEADER_FILL;
  ws.getCell('B4').value = 'Значение';
  ws.getCell('B4').font = HEADER_FONT;
  ws.getCell('B4').fill = HEADER_FILL;
  ws.getCell('C4').value = 'Формула/комментарий';
  ws.getCell('C4').font = HEADER_FONT;
  ws.getCell('C4').fill = HEADER_FILL;
  applyBorderToRange(ws, 4, 1, 4, 3);

  const rows = [
    ['Материалы, руб', oh.materialsTotal, 'Раздел 1'],
    ['Прямые затраты по операциям, руб', oh.operationsTotal, 'ФОТ + взносы + машины + энергия'],
    ['База накладных (ФОТ+страх.взносы), руб', oh.nakladnye_base, 'Принята база начисления'],
    ['Накладные расходы, руб', oh.nakladnye, 'Накладные = база \u00D7 %'],
    ['Промежуточная себестоимость, руб', oh.promezhutochnaya_sebestoimost, 'Материалы + операции + накладные'],
    ['Резерв на технологические риски/брак, руб', oh.rezerv, 'Длина>5 м, профиль R25, двойная отделка'],
    ['Себестоимость с резервом, руб', oh.sebestoimost_s_rezervom, ''],
    ['Прибыль, руб', oh.pribyl, 'Прибыль = себестоимость \u00D7 %'],
    ['ИТОГО (себестоимость+прибыль), руб', oh.itogo_production, 'Без учета логистики'],
  ];

  rows.forEach((row, i) => {
    const r = 5 + i;
    ws.getCell(r, 1).value = row[0];
    ws.getCell(r, 2).value = row[1];
    ws.getCell(r, 2).numFmt = NUM_FMT_RUB;
    ws.getCell(r, 3).value = row[2];
    applyBorderToRange(ws, r, 1, r, 3);
  });

  // Bold the last row
  ws.getCell(13, 1).font = BOLD_FONT;
  ws.getCell(13, 2).font = BOLD_FONT;
}

// ===== Sheet 8: Транспорт =====
function buildTransportSheet(wb, product, oh) {
  const ws = wb.addWorksheet('Транспорт');
  setColWidths(ws, [50, 22, 40, 15, 15, 15, 15, 15, 15, 15]);

  const tr = (product.rkm && product.rkm.transport) || {};
  const distance = tr.distance_km || 940;
  const tariff = tr.tariff_rub_km || 120;
  const trips = tr.trips || 1;
  const loading = tr.loading || 25000;
  const unloading = tr.unloading || 35000;
  const insurance_pct = tr.insurance_pct || 0.005;

  const perevozka = distance * tariff * trips;
  const insurance_val = oh.itogo_production * insurance_pct;
  const total_logistics = perevozka + loading + unloading + insurance_val;

  ws.getCell('A1').value = 'РАЗДЕЛ 2 — ЛОГИСТИКА';
  ws.getCell('A1').font = TITLE_FONT;
  ws.getCell('A2').value = 'Расчет: расстояние \u00D7 ставка \u00D7 рейсы + погрузка/разгрузка + страхование груза.';

  ws.getCell('A4').value = 'Параметр';
  ws.getCell('A4').font = HEADER_FONT;
  ws.getCell('A4').fill = HEADER_FILL;
  ws.getCell('B4').value = 'Значение';
  ws.getCell('B4').font = HEADER_FONT;
  ws.getCell('B4').fill = HEADER_FILL;
  ws.getCell('C4').value = 'Примечание/источник/документ';
  ws.getCell('C4').font = HEADER_FONT;
  ws.getCell('C4').fill = HEADER_FILL;
  applyBorderToRange(ws, 4, 1, 4, 3);

  const rows = [
    ['Расстояние, км', distance, 'дорожное расстояние'],
    ['Кол-во рейсов', trips, 'выделенный автомобиль под длинномер'],
    ['Тариф, руб/км (длинномер/выделенный транспорт)', tariff, 'редактируемый параметр'],
    ['Погрузка (кран/манипулятор), руб', loading, 'кран, стропальщики, время'],
    ['Разгрузка (кран/манипулятор), руб', unloading, 'длинномер, работа с такелажем'],
    ['Страхование/ответственность перевозчика, % от стоимости', insurance_pct, 'страховой тариф'],
  ];

  rows.forEach((row, i) => {
    const r = 5 + i;
    ws.getCell(r, 1).value = row[0];
    ws.getCell(r, 2).value = row[1];
    ws.getCell(r, 2).fill = YELLOW_FILL;
    if (typeof row[1] === 'number' && row[1] >= 100) ws.getCell(r, 2).numFmt = NUM_FMT_RUB;
    ws.getCell(r, 3).value = row[2];
    applyBorderToRange(ws, r, 1, r, 3);
  });

  // Calculated rows
  const calcStart = 12;
  const calcRows = [
    ['Перевозка (расстояние\u00D7тариф\u00D7рейсы), руб', { formula: 'B5*B7*B6' }, 'Расстояние \u00D7 руб/км \u00D7 рейсы'],
    ['Погрузка, руб', { formula: 'B8' }, ''],
    ['Разгрузка, руб', { formula: 'B9' }, ''],
    ['Страхование, руб', insurance_val, 'База: (себестоимость+прибыль) \u00D7 %'],
    ['ИТОГО логистика, руб', { formula: `B${calcStart}+B${calcStart+1}+B${calcStart+2}+B${calcStart+3}` }, 'Сумма раздела 2'],
  ];

  calcRows.forEach((row, i) => {
    const r = calcStart + i;
    ws.getCell(r, 1).value = row[0];
    ws.getCell(r, 2).value = row[1];
    ws.getCell(r, 2).numFmt = NUM_FMT_RUB;
    ws.getCell(r, 3).value = row[2];
    applyBorderToRange(ws, r, 1, r, 3);
  });

  const lastRow = calcStart + calcRows.length - 1;
  ws.getCell(lastRow, 1).font = BOLD_FONT;
  ws.getCell(lastRow, 2).font = BOLD_FONT;
}

// ===== Sheet 9: ИТОГО =====
function buildTotalSheet(wb, oh, geometry) {
  const ws = wb.addWorksheet('ИТОГО');
  setColWidths(ws, [50, 22, 45, 15, 15, 15, 15, 15, 15, 15]);

  ws.getCell('A1').value = 'ИТОГОВАЯ СТОИМОСТЬ';
  ws.getCell('A1').font = TITLE_FONT;
  ws.getCell('A2').value = `Стоимость за 1 шт. и за партию ${geometry.qty} шт., с учетом НДС (ставка во вводных данных).`;

  ws.getCell('A4').value = 'Показатель';
  ws.getCell('A4').font = HEADER_FONT;
  ws.getCell('A4').fill = HEADER_FILL;
  ws.getCell('B4').value = 'Значение, руб';
  ws.getCell('B4').font = HEADER_FONT;
  ws.getCell('B4').fill = HEADER_FILL;
  ws.getCell('C4').value = 'Формула/источник';
  ws.getCell('C4').font = HEADER_FONT;
  ws.getCell('C4').fill = HEADER_FILL;
  applyBorderToRange(ws, 4, 1, 4, 3);

  const rows = [
    ['Материалы (раздел 1)', oh.materialsTotal, ''],
    ['Прямые затраты по операциям (раздел 3)', oh.operationsTotal, ''],
    ['Накладные расходы', oh.nakladnye, ''],
    ['Резерв на риски/брак', oh.rezerv, ''],
    ['Прибыль', oh.pribyl, ''],
    ['ИТОГО производственная часть (без логистики)', oh.itogo_production, ''],
    ['Логистика (раздел 2)', oh.logisticsTotal, ''],
    ['ИТОГО без НДС', oh.itogo_bez_NDS, ''],
    ['НДС', oh.NDS, ''],
    ['ИТОГО с НДС', oh.itogo_s_NDS, ''],
    ['Стоимость 1 шт. без НДС', oh.per_piece_bez_NDS, ''],
    ['Стоимость 1 шт. с НДС', oh.per_piece_s_NDS, ''],
    [`Стоимость 1 м\u00B2 (верхняя плоскость (L\u00D7W)) без НДС`, oh.per_m2_bez_NDS, `Вводные_данные!B23 (база м\u00B2/1шт) \u00D7 кол-во; методика: Вводные_данные!E23`],
    [`Стоимость 1 м\u00B2 (верхняя плоскость (L\u00D7W)) с НДС`, oh.per_m2_s_NDS, `Вводные_данные!B23 (база м\u00B2/1шт) \u00D7 кол-во; методика: Вводные_данные!E23`],
    [`Стоимость 1 м.п. (по длине L) без НДС`, oh.per_mp_bez_NDS, `Вводные_данные!B24 (база м.п./1шт) \u00D7 кол-во; методика: Вводные_данные!H23`],
    [`Стоимость 1 м.п. (по длине L) с НДС`, oh.per_mp_s_NDS, `Вводные_данные!B24 (база м.п./1шт) \u00D7 кол-во; методика: Вводные_данные!H23`],
  ];

  rows.forEach((row, i) => {
    const r = 5 + i;
    ws.getCell(r, 1).value = row[0];
    ws.getCell(r, 2).value = row[1];
    ws.getCell(r, 2).numFmt = NUM_FMT_RUB;
    ws.getCell(r, 3).value = row[2];
    applyBorderToRange(ws, r, 1, r, 3);
  });

  // Bold key rows
  [9, 13, 14].forEach(offset => {
    ws.getCell(5 + offset - 1, 1).font = BOLD_FONT;
    ws.getCell(5 + offset - 1, 2).font = BOLD_FONT;
  });

  // ИТОГО с НДС is row 14 (5+9)
  ws.getCell(14, 1).font = { bold: true, size: 12 };
  ws.getCell(14, 2).font = { bold: true, size: 12 };
}

// ===== Sheet 10: Справочники =====
function buildReferenceSheet(wb) {
  const ws = wb.addWorksheet('Справочники');
  setColWidths(ws, [30, 30, 30, 30]);

  ws.getCell('A1').value = 'СПРАВОЧНИКИ И ВЫПАДАЮЩИЕ СПИСКИ';
  ws.getCell('A1').font = TITLE_FONT;

  ws.getCell('A3').value = 'Методика м\u00B2';
  ws.getCell('A3').font = BOLD_FONT;
  ['верхняя плоскость (L\u00D7W)', 'лицевая грань (L\u00D7T)', 'полная площадь всех граней', 'площадь бучардирования'].forEach((v, i) => {
    ws.getCell(4 + i, 1).value = v;
  });

  ws.getCell('B3').value = 'Методика м.п.';
  ws.getCell('B3').font = BOLD_FONT;
  ['по длине L', 'длина профиля (L+2W)', 'периметр (все ребра)'].forEach((v, i) => {
    ws.getCell(4 + i, 2).value = v;
  });

  ws.getCell('C3').value = 'Фактура';
  ws.getCell('C3').font = BOLD_FONT;
  ['лощение', 'бучардирование+лощение', 'рельефная матовая', 'полировка'].forEach((v, i) => {
    ws.getCell(4 + i, 3).value = v;
  });

  ws.getCell('D3').value = 'Сложность';
  ws.getCell('D3').font = BOLD_FONT;
  ['простая прямоугольная', 'фигурная с радиусами', 'сегментная радиусная', 'объёмная с профилем'].forEach((v, i) => {
    ws.getCell(4 + i, 4).value = v;
  });
}

module.exports = { buildXlsx };
