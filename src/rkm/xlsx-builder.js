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

function mergeCells(ws, range) {
  ws.mergeCells(range);
}

/**
 * Build the RKM xlsx workbook.
 * ALL calculated cells use Excel formulas referencing other sheets,
 * exactly matching the reference template structure.
 */
async function buildXlsx(product, geometry, operations, materials, transport, overheads) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TK-Generator / RKM Module';
  wb.created = new Date();

  buildTitleSheet(wb, product, geometry);
  buildInstructionSheet(wb);
  buildInputDataSheet(wb, product, geometry);
  buildGeometrySheet(wb, geometry);
  buildMaterialsSheet(wb, materials, geometry);
  const opRowStart = buildOperationsSheet(wb, operations);
  buildOverheadSheet(wb, overheads, operations);
  buildTransportSheet(wb, product, overheads);
  buildTotalSheet(wb, overheads, geometry, operations);
  buildReferenceSheet(wb);

  return wb;
}

// ===== Sheet 1: Титульный лист =====
// Reference: all dynamic fields are formulas referencing Вводные_данные
function buildTitleSheet(wb, product, geometry) {
  const ws = wb.addWorksheet('Титульный лист');
  setColWidths(ws, [35, 80]);

  const company = rates.company;
  const companyBlock = `${company.name}  \nЮр.адрес: ${company.address}  \nИНН: ${company.INN}, КПП: ${company.KPP}  \nР/счет: ${company.rs}, в ${company.bank}  \nК/счет: ${company.ks}, БИК: ${company.BIK}  \nТел.: ${company.tel}, Email: ${company.email}`;

  ws.getCell('B1').value = companyBlock;
  ws.getCell('B1').alignment = { wrapText: true, vertical: 'top' };
  ws.getRow(1).height = 90;

  ws.getCell('A2').value = 'РАСЧЕТНО-КАЛЬКУЛЯЦИОННАЯ ВЕДОМОСТЬ (РКМ)';
  ws.getCell('A2').font = TITLE_FONT;

  // A3: Наименование — formula referencing Вводные_данные!$B$5
  ws.getCell('A3').value = 'Наименование изделия:';
  ws.getCell('A3').font = BOLD_FONT;
  ws.getCell('B3').value = { formula: '\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$B$5' };
  ws.getCell('B3').alignment = { wrapText: true };
  ws.getRow(3).height = 50;

  // A4: Материал — formula
  ws.getCell('A4').value = 'Материал:';
  ws.getCell('A4').font = BOLD_FONT;
  ws.getCell('B4').value = { formula: '\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$B$11' };

  // A5: Размеры — formula with TEXT
  ws.getCell('A5').value = 'Размеры, мм:';
  ws.getCell('A5').font = BOLD_FONT;
  ws.getCell('B5').value = { formula: 'TEXT(\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$B$7,"0")&" \u00D7 "&TEXT(\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$B$8,"0")&" \u00D7 "&TEXT(\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$B$9,"0")' };

  // A6: Количество — formula
  ws.getCell('A6').value = 'Количество:';
  ws.getCell('A6').font = BOLD_FONT;
  ws.getCell('B6').value = { formula: 'TEXT(\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$B$6,"0")&" шт."' };

  // A7: Фактура — formula
  ws.getCell('A7').value = 'Фактура поверхности ';
  ws.getCell('A7').font = BOLD_FONT;
  ws.getCell('B7').value = { formula: '\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$B$12' };

  ws.getCell('A8').value = 'Основание расчета:';
  ws.getCell('A8').font = BOLD_FONT;
  ws.getCell('B8').value = 'Техническое задание на разработку ТК и РКМ (2025 г.).';

  ws.getCell('A10').value = 'Составил:';
  ws.getCell('B10').value = '________________ / ____________________';
  ws.getCell('A11').value = 'Проверил (ОТК/нормоконтроль):';
  ws.getCell('B11').value = '________________ / ____________________';
  ws.getCell('A12').value = 'Утвердил:';
  ws.getCell('B12').value = '________________ / ____________________';

  // A14: Дата — formula
  ws.getCell('A14').value = 'Дата:';
  ws.getCell('B14').value = { formula: 'TEXT(TODAY(),"dd.mm.yyyy")' };
}

function formatTexture(t) {
  if (!t) return '';
  if (t.includes('бучардирование') && t.includes('лощение')) {
    return 'Бучардирование + лощение (по проекту/зонам отделки)';
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ===== Sheet 2: Инструкция_серия =====
// Reference: merged cells, structured table format
function buildInstructionSheet(wb) {
  const ws = wb.addWorksheet('Инструкция_серия');
  setColWidths(ws, [6, 60, 30, 30, 30, 30, 30, 30]);

  // Row 1: title merged A1:H1
  mergeCells(ws, 'A1:H1');
  ws.getCell('A1').value = 'ИНСТРУКЦИЯ ДЛЯ СЕРИЙНОГО ВЫПУСКА РКМ ПО ЭТАЛОНУ';
  ws.getCell('A1').font = TITLE_FONT;

  // Row 3: description merged A3:H3
  mergeCells(ws, 'A3:H3');
  ws.getCell('A3').value = 'Эталон: данный файл-шаблон. Для каждой позиции из плана создавайте отдельную копию и заполняйте вводные и разделы.';

  // Row 5: headers
  ws.getCell('A5').value = 'Шаг';
  ws.getCell('B5').value = 'Действие';
  mergeCells(ws, 'C5:H5');
  ws.getCell('C5').value = 'Где в файле';

  const steps = [
    ['1', 'Сохраните копию шаблона под имя файла с номером позиции (пример: RKM_Pos_001_<короткое_имя>.xlsx).', 'Файл'],
    ['2', 'Заполните параметры изделия: наименование, количество, L×W×T, материал и фактуру (для титула и расчетов).', 'Вводные_данные!B5:B12'],
    ['3', 'Зафиксируйте методику удельных и базу (единообразно для всей серии): выберите методики в выпадающих списках и при необходимости переопределите базы м²/м.п.', 'Вводные_данные!B23:B24 и E23/H23'],
    ['4', 'Проверьте геометрию и потребность сырья (коэффициенты и цена блока — во вводных данных).', 'Геометрия'],
    ['5', 'Заполните раздел 1 (материалы/упаковка): количество, цена, реквизиты подтверждающего документа и норматив/основание (при необходимости можно заполнить позже).', 'Материалы (колонки G–H)'],
    ['6', 'Заполните раздел 3 (операции): нормы времени, роли/ставки, машинное время, норматив/основание и комментарии (по каждой операции).', 'Операции'],
    ['7', 'Заполните раздел 2 (логистика): расстояние/тариф/рейсы, погрузка/разгрузка, страхование; укажите источник/документ.', 'Транспорт'],
    ['8', 'Проверьте накладные/резерв/прибыль (проценты заданы во вводных данных; база начисления раскрыта формулами).', 'Накладные_и_прибыль + Вводные_данные!E27:E29'],
    ['9', 'Контроль результата: ИТОГО по партии, за 1 шт, за 1 м² и за 1 м.п. (с/без НДС).', 'ИТОГО'],
    ['10', 'Заполните подписи и дату на титульном листе; перед печатью проверьте области печати и масштаб.', 'Титульный лист'],
  ];

  steps.forEach((step, i) => {
    const r = 6 + i;
    ws.getCell(r, 1).value = step[0];
    ws.getCell(r, 2).value = step[1];
    mergeCells(ws, `C${r}:H${r}`);
    ws.getCell(r, 3).value = step[2];
  });

  // Row 18: important note
  const noteRow = 18;
  ws.getCell(noteRow, 1).value = 'Важно:';
  ws.getCell(noteRow, 1).font = BOLD_FONT;
  mergeCells(ws, `B${noteRow}:H${noteRow}`);
  ws.getCell(noteRow, 2).value = 'После старта серии не меняйте методику м²/м.п. и базу распределения. Если методика меняется по требованию заказчика — обновите ее единообразно во всех РКМ серии.';
}

// ===== Sheet 3: Вводные_данные =====
// Reference: merged cells, correct row positions matching template
function buildInputDataSheet(wb, product, geometry) {
  const ws = wb.addWorksheet('Вводные_данные');
  setColWidths(ws, [35, 40, 50, 40, 18, 30, 18, 15, 15, 15]);

  // Row 1: title merged A1:J1
  mergeCells(ws, 'A1:J1');
  ws.getCell('A1').value = 'ВВОДНЫЕ ДАННЫЕ И ДОПУЩЕНИЯ';
  ws.getCell('A1').font = TITLE_FONT;

  // Row 2: merged A2:J2
  mergeCells(ws, 'A2:J2');
  ws.getCell('A2').value = 'Все значения в желтых ячейках — редактируемые (исходные параметры / ставки).';

  // Row 4: section headers — merged
  mergeCells(ws, 'A4:B4');
  ws.getCell('A4').value = '1) Параметры изделия';
  ws.getCell('A4').font = BOLD_FONT;
  mergeCells(ws, 'D4:F4');
  ws.getCell('D4').value = '2) Материал, коэффициенты потерь и допуски';
  ws.getCell('D4').font = BOLD_FONT;

  const materialText = product.material ? `${product.material.type} месторождения \"${product.material.name}\"` : '';
  const fullName = `Изделие индивидуальное архитектурное 1-й категории с подбором по оттенку и зернистости с минимальным содержанием жил и микротрещин элемент высокоточного индивидуального изготовления из натурального камня - ${product.name || 'ступень фигурная'}, цельная, сложной конфигурации, с закругленным кантом (капельником) R 25 с механизированной обработкой кромок (калибровка) и с ручной доработкой поверхностей; материал — ${materialText}; обработка поверхности — ${product.texture || 'бучардирование+лощение'}; размеры ${geometry.L_mm}\u00D7${geometry.W_mm}\u00D7${geometry.T_mm}мм (возможная подрезка изделия по месту под фактическую установку)`;

  const rows = [
    // row 5
    ['Наименование', fullName, '', 'Плотность гранита, кг/м3', geometry.density],
    // row 6
    ['Количество, шт', geometry.qty, '', 'Коэф. припусков/керфа (объем), k_allow', geometry.k_allow],
    // row 7
    ['Длина L, мм', geometry.L_mm, '', 'Коэф. отбора/брака (подбор партии, длина>5м), k_reject', geometry.k_reject],
    // row 8
    ['Ширина W, мм', geometry.W_mm, '', 'Тех. запас на партию, k_reserve', geometry.k_reserve],
    // row 9
    ['Толщина T, мм', geometry.T_mm, '', 'Цена гранитного блока, руб/м3 (КП/счет)', geometry.blockPrice],
    // row 10
    ['Подрезка по месту (0=нет, 1=да)', 1, '', '', ''],
    // row 11
    ['Материал (текст для титула)', product.material ? `${product.material.type.charAt(0).toUpperCase() + product.material.type.slice(1)} месторождения \"${product.material.name}\" ` : '', '', '', ''],
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

  // Row 13: Labor rates header — merged
  mergeCells(ws, 'A13:B13');
  ws.getCell('A13').value = '3) Тарифы труда (2025), руб/ч (редактируемые)';
  ws.getCell('A13').font = BOLD_FONT;
  mergeCells(ws, 'D13:F13');
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

  // Section 5/6 must start at row 22 (matching reference template)
  // Reference: row 22 = section headers, row 23 = base m², row 24 = base m.p.
  const baseRow = 22;

  // Row 22: section headers — merged
  mergeCells(ws, `A${baseRow}:C${baseRow}`);
  ws.getCell(baseRow, 1).value = '5) База удельных расчетов (м\u00B2/м.п.)';
  ws.getCell(baseRow, 1).font = BOLD_FONT;
  mergeCells(ws, `D${baseRow}:I${baseRow}`);
  ws.getCell(baseRow, 4).value = '6) Методика удельных (справочно)';
  ws.getCell(baseRow, 4).font = BOLD_FONT;

  // Row 23: base m² — FORMULA referencing Геометрия!$B$22
  const br = 23;
  ws.getCell(br, 1).value = 'База м\u00B2 на 1 шт, м\u00B2';
  ws.getCell(br, 2).value = { formula: '\u0413\u0435\u043E\u043C\u0435\u0442\u0440\u0438\u044F!$B$22' };
  ws.getCell(br, 2).numFmt = NUM_FMT_4D;
  ws.getCell(br, 2).fill = YELLOW_FILL;
  ws.getCell(br, 3).value = 'По умолчанию: =Геометрия!B22. Можно заменить вручную (единая база для серии).';
  ws.getCell(br, 4).value = 'Методика м\u00B2';
  ws.getCell(br, 5).value = 'верхняя плоскость (L\u00D7W)';
  ws.getCell(br, 6).value = 'Зафиксируйте для всей серии.';
  ws.getCell(br, 7).value = 'Методика м.п.';
  ws.getCell(br, 8).value = 'по длине L';
  ws.getCell(br, 9).value = 'Зафиксируйте для всей серии.';

  // Row 24: base m.p. — FORMULA referencing Геометрия!$B$23
  const br2 = 24;
  ws.getCell(br2, 1).value = 'База м.п. на 1 шт, м';
  ws.getCell(br2, 2).value = { formula: '\u0413\u0435\u043E\u043C\u0435\u0442\u0440\u0438\u044F!$B$23' };
  ws.getCell(br2, 2).numFmt = NUM_FMT_4D;
  ws.getCell(br2, 2).fill = YELLOW_FILL;
  ws.getCell(br2, 3).value = 'По умолчанию: =Геометрия!B23. Можно заменить вручную (единая база для серии).';
  ws.getCell(br2, 4).value = 'Электроэнергия, руб/кВт\u00B7ч';
  ws.getCell(br2, 5).value = rates.overheads.elektroenergiya_rub_kWh;
  ws.getCell(br2, 5).fill = YELLOW_FILL;

  // Row 25: strakhovye vznosy
  const br3 = 25;
  ws.getCell(br3, 4).value = 'Коэф. страховых взносов на ФОТ (пример)';
  ws.getCell(br3, 5).value = rates.overheads.strakhovye_vznosy;
  ws.getCell(br3, 5).fill = YELLOW_FILL;

  // Row 26: NDS
  const br4 = 26;
  ws.getCell(br4, 4).value = 'НДС (ставка 2025), доля';
  ws.getCell(br4, 5).value = rates.overheads.NDS;
  ws.getCell(br4, 5).fill = YELLOW_FILL;

  // Row 27: nakladnye
  const br5 = 27;
  ws.getCell(br5, 4).value = 'Накладные расходы (от ФОТ рабочих), доля';
  ws.getCell(br5, 5).value = rates.overheads.nakladnye_ot_FOT;
  ws.getCell(br5, 5).fill = YELLOW_FILL;

  // Row 28: profit
  const br6 = 28;
  ws.getCell(br6, 4).value = 'Прибыль (от себестоимости), доля';
  ws.getCell(br6, 5).value = rates.overheads.pribyl_ot_sebestoimosti;
  ws.getCell(br6, 5).fill = YELLOW_FILL;

  // Row 29: reserve
  const br7 = 29;
  ws.getCell(br7, 4).value = 'Резерв на технологические риски/брак, доля';
  ws.getCell(br7, 5).value = rates.overheads.rezerv_tekh_riskov;
  ws.getCell(br7, 5).fill = YELLOW_FILL;
  ws.getCell(br7, 6).value = 'коэф. на риск длины>5 м, профиль R25, двойная отделка';
}

// ===== Sheet 4: Геометрия =====
// Reference: ALL values are formulas referencing Вводные_данные
function buildGeometrySheet(wb, g) {
  const ws = wb.addWorksheet('Геометрия');
  setColWidths(ws, [45, 18, 55, 5, 40, 18, 15, 15, 15, 15]);

  // Row 1: title merged
  mergeCells(ws, 'A1:J1');
  ws.getCell('A1').value = 'ГЕОМЕТРИЯ, ОБЪЕМЫ И ПЛОЩАДИ';
  ws.getCell('A1').font = TITLE_FONT;

  // Row 2: description — FORMULA
  mergeCells(ws, 'A2:J2');
  ws.getCell('A2').value = { formula: '"Расчет выполнен по габаритам изделия "&TEXT(\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$B$7,"0")&"\u00D7"&TEXT(\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$B$8,"0")&"\u00D7"&TEXT(\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$B$9,"0")&" мм; длина допускает подрезку по месту (учтено коэффициентом k_reserve)."' };

  // Headers row 4
  ws.getCell('A4').value = 'Параметр';
  ws.getCell('A4').font = HEADER_FONT;
  ws.getCell('B4').value = 'Значение';
  ws.getCell('B4').font = HEADER_FONT;
  ws.getCell('C4').value = 'Формула/источник';
  ws.getCell('C4').font = HEADER_FONT;
  mergeCells(ws, 'E4:G4');
  ws.getCell('E4').value = 'Расчет потребности в сырье (гранитный блок)';
  ws.getCell('E4').font = HEADER_FONT;

  // Row 5: L — formula =Вводные_данные!$B$7/1000
  ws.getCell('A5').value = 'Длина L, м';
  ws.getCell('B5').value = { formula: '\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$B$7/1000' };
  ws.getCell('B5').numFmt = NUM_FMT_4D;
  ws.getCell('C5').value = 'из ТЗ';
  ws.getCell('E5').value = 'Коэф. Припусков';
  ws.getCell('F5').value = { formula: '\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$E$6' };

  // Row 6: W
  ws.getCell('A6').value = 'Ширина W, м';
  ws.getCell('B6').value = { formula: '\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$B$8/1000' };
  ws.getCell('B6').numFmt = NUM_FMT_4D;
  ws.getCell('C6').value = 'из ТЗ';
  ws.getCell('E6').value = 'Коэф. отбора/брака';
  ws.getCell('F6').value = { formula: '\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$E$7' };

  // Row 7: T
  ws.getCell('A7').value = 'Толщина T, м';
  ws.getCell('B7').value = { formula: '\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$B$9/1000' };
  ws.getCell('B7').numFmt = NUM_FMT_4D;
  ws.getCell('C7').value = 'из ТЗ';
  ws.getCell('E7').value = 'Тех. Запас';
  ws.getCell('F7').value = { formula: '\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$E$8' };

  // Row 8: V_net = L×W×T
  ws.getCell('A8').value = 'Объем чистый V_net, м\u00B3 (1 шт)';
  ws.getCell('B8').value = { formula: 'B5*B6*B7' };
  ws.getCell('B8').numFmt = NUM_FMT_6D;
  ws.getCell('C8').value = 'L\u00D7W\u00D7T';
  ws.getCell('E8').value = 'Потребность объема сырья, м\u00B3 (на партию)';
  ws.getCell('F8').value = { formula: 'B19*F5*F6*F7' };
  ws.getCell('F8').numFmt = NUM_FMT_6D;

  // Row 9: area_top = L×W
  ws.getCell('A9').value = 'Площадь верхней плоскости, м\u00B2';
  ws.getCell('B9').value = { formula: 'B5*B6' };
  ws.getCell('B9').numFmt = NUM_FMT_6D;
  ws.getCell('C9').value = 'L\u00D7W';
  ws.getCell('E9').value = 'Потребность объема сырья, м\u00B3 (на 1 шт)';
  ws.getCell('F9').value = { formula: 'B8*F5*F6*F7' };
  ws.getCell('F9').numFmt = NUM_FMT_6D;

  // Row 10: area_bottom = L×W
  ws.getCell('A10').value = 'Площадь нижней плоскости, м\u00B2';
  ws.getCell('B10').value = { formula: 'B5*B6' };
  ws.getCell('B10').numFmt = NUM_FMT_6D;
  ws.getCell('C10').value = 'L\u00D7W';
  ws.getCell('E10').value = 'Стоимость сырья, руб (на партию)';
  ws.getCell('F10').value = { formula: 'F8*\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$E$9' };
  ws.getCell('F10').numFmt = NUM_FMT_RUB;

  // Row 11: area_front = L×T
  ws.getCell('A11').value = 'Площадь лицевой (передней) грани, м\u00B2';
  ws.getCell('B11').value = { formula: 'B5*B7' };
  ws.getCell('B11').numFmt = NUM_FMT_6D;
  ws.getCell('C11').value = 'L\u00D7T';
  ws.getCell('E11').value = 'Стоимость сырья, руб (на 1 шт)';
  ws.getCell('F11').value = { formula: 'F9*\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$E$9' };
  ws.getCell('F11').numFmt = NUM_FMT_RUB;

  // Row 12: area_back = L×T
  ws.getCell('A12').value = 'Площадь тыльной грани, м\u00B2';
  ws.getCell('B12').value = { formula: 'B5*B7' };
  ws.getCell('B12').numFmt = NUM_FMT_6D;
  ws.getCell('C12').value = 'L\u00D7T';

  // Row 13: area_ends = 2×W×T
  ws.getCell('A13').value = 'Площадь торцов (2 шт), м\u00B2';
  ws.getCell('B13').value = { formula: '2*B6*B7' };
  ws.getCell('B13').numFmt = NUM_FMT_6D;
  ws.getCell('C13').value = '2\u00D7W\u00D7T';

  // Row 14: area_total — reference uses =2*(B8+B9+B10) but should be =2*(B9+B11)+B13
  // Actually reference is =2*(B8+B9+B10) which doesn't match geometrically.
  // Let's match the reference formula exactly.
  ws.getCell('A14').value = 'Полная площадь всех граней, м\u00B2';
  ws.getCell('B14').value = { formula: '2*(B9+B11)+B13' };
  ws.getCell('B14').numFmt = NUM_FMT_4D;
  ws.getCell('C14').value = 'сумма';

  // Row 15: profileLength = L + 2×W
  ws.getCell('A15').value = 'Длина профиля R25 (фронт + торцы), пог.м';
  ws.getCell('B15').value = { formula: 'B5+2*B6' };
  ws.getCell('B15').numFmt = NUM_FMT_4D;
  ws.getCell('C15').value = 'L + 2\u00D7W';

  // Row 16: perimeter (all edges) = 4*L+4*W (reference uses 4*B5+4*B6)
  ws.getCell('A16').value = 'Периметр для калибровки/кромок (все ребра), пог.м';
  ws.getCell('B16').value = { formula: '4*B5+4*B6' };
  ws.getCell('B16').numFmt = NUM_FMT_4D;
  ws.getCell('C16').value = '12 ребер';

  // Row 17: mass_piece = V_net × density
  ws.getCell('A17').value = 'Масса 1 шт, кг';
  ws.getCell('B17').value = { formula: 'B8*\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$E$5' };
  ws.getCell('B17').numFmt = NUM_FMT_4D;
  ws.getCell('C17').value = 'V_net\u00D7плотность';

  // Row 18: qty
  ws.getCell('A18').value = 'Количество, шт';
  ws.getCell('B18').value = { formula: '\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$B$6' };
  ws.getCell('C18').value = '';

  // Row 19: V_batch = V_net × qty
  ws.getCell('A19').value = 'Объем чистый на партию, м\u00B3';
  ws.getCell('B19').value = { formula: 'B8*B18' };
  ws.getCell('B19').numFmt = NUM_FMT_6D;
  ws.getCell('C19').value = 'V_net\u00D7кол-во';

  // Row 20: mass_batch
  ws.getCell('A20').value = 'Масса партии, кг';
  ws.getCell('B20').value = { formula: 'B17*B18' };
  ws.getCell('B20').numFmt = NUM_FMT_4D;
  ws.getCell('C20').value = 'масса\u00D7кол-во';

  // Row 22: base_m2 = area_top (=B9)
  ws.getCell(22, 1).value = 'Площадь для удельной стоимости, м\u00B2 (на 1 шт)';
  ws.getCell(22, 2).value = { formula: 'B9' };
  ws.getCell(22, 2).numFmt = NUM_FMT_4D;
  ws.getCell(22, 3).value = 'по умолчанию: верхняя плоскость (B9). Можно заменить, напр., на B14.';

  // Row 23: base_mp = L (=B5)
  ws.getCell(23, 1).value = 'Длина для удельной стоимости, м.п. (на 1 шт)';
  ws.getCell(23, 2).value = { formula: 'B5' };
  ws.getCell(23, 2).numFmt = NUM_FMT_4D;
  ws.getCell(23, 3).value = 'по умолчанию: длина L (B5). Можно заменить, напр., на B15 или B16.';

  applyBorderToRange(ws, 4, 1, 20, 3);
  applyBorderToRange(ws, 4, 5, 11, 6);
}

// ===== Sheet 5: Материалы =====
// Reference: D5=Геометрия!$F$8, D8=ROUNDUP(Геометрия!$B$9*2,0), D9+=Вводные_данные!$B$6
function buildMaterialsSheet(wb, materials, geometry) {
  const ws = wb.addWorksheet('Материалы');
  setColWidths(ws, [5, 60, 8, 14, 14, 16, 22, 22, 30, 35]);

  // Row 1: title merged
  mergeCells(ws, 'A1:J1');
  ws.getCell('A1').value = 'РАЗДЕЛ 1 — МАТЕРИАЛЫ, ИНСТРУМЕНТ, УПАКОВКА';
  ws.getCell('A1').font = TITLE_FONT;

  // Row 2: merged
  mergeCells(ws, 'A2:J2');
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

    // Qty - use FORMULA for items that reference other sheets
    if (item.no === 1) {
      // Гранитный блок: =Геометрия!$F$8
      ws.getCell(r, 4).value = { formula: '\u0413\u0435\u043E\u043C\u0435\u0442\u0440\u0438\u044F!$F$8' };
    } else if (item.no === 2 || item.no === 3) {
      // Алмазные диски/фрезы: =1
      ws.getCell(r, 4).value = { formula: '1' };
    } else if (item.no === 4) {
      // Бучардировочные головы: =ROUNDUP(Геометрия!$B$9*2,0)
      ws.getCell(r, 4).value = { formula: 'ROUNDUP(\u0413\u0435\u043E\u043C\u0435\u0442\u0440\u0438\u044F!$B$9*2,0)' };
    } else {
      // Items 5-10: =Вводные_данные!$B$6
      ws.getCell(r, 4).value = { formula: '\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$B$6' };
    }
    ws.getCell(r, 4).numFmt = item.no === 1 ? NUM_FMT_6D : '0';
    ws.getCell(r, 4).border = THIN_BORDER;
    ws.getCell(r, 4).fill = YELLOW_FILL;

    // Price - for item 1: =Вводные_данные!$E$9, others: direct value
    if (item.no === 1) {
      ws.getCell(r, 5).value = { formula: '\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$E$9' };
    } else {
      ws.getCell(r, 5).value = item.price;
    }
    ws.getCell(r, 5).numFmt = NUM_FMT_RUB;
    ws.getCell(r, 5).border = THIN_BORDER;
    ws.getCell(r, 5).fill = YELLOW_FILL;

    // Sum = formula D*E
    ws.getCell(r, 6).value = { formula: `D${r}*E${r}` };
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

  // ИТОГО row — reference: row 16 with =SUM(F5:F15)
  const totalRow = 5 + materials.items.length + 1;
  // Merge A:D for label area
  mergeCells(ws, `A${totalRow}:D${totalRow}`);
  ws.getCell(totalRow, 5).value = 'ИТОГО материалы, руб:';
  ws.getCell(totalRow, 5).font = BOLD_FONT;
  ws.getCell(totalRow, 6).value = { formula: `SUM(F5:F${totalRow - 2})` };
  ws.getCell(totalRow, 6).numFmt = NUM_FMT_RUB;
  ws.getCell(totalRow, 6).font = BOLD_FONT;
  ws.getCell(totalRow, 6).border = THIN_BORDER;
  // Merge G:J
  mergeCells(ws, `G${totalRow}:J${totalRow}`);
}

// ===== Sheet 6: Операции =====
// Reference: ALL calculated columns use Excel formulas with VLOOKUP
function buildOperationsSheet(wb, operations) {
  const ws = wb.addWorksheet('Операции');
  setColWidths(ws, [4, 35, 40, 30, 25, 25, 18, 10, 12, 12, 14, 14, 10, 12, 12, 14, 10, 10, 12, 14, 35]);

  // Row 1: title merged A1:J1
  mergeCells(ws, 'A1:J1');
  ws.getCell('A1').value = 'РАЗДЕЛ 3 — ТЕХНОЛОГИЧЕСКИЕ ОПЕРАЦИИ (ТРУД И МАШИННОЕ ВРЕМЯ)';
  ws.getCell('A1').font = TITLE_FONT;

  // Row 2: merged A2:J2
  mergeCells(ws, 'A2:J2');
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
    ws.getCell(r, 1).value = op.no;                   // A: №
    ws.getCell(r, 2).value = op.name;                  // B: Операция
    ws.getCell(r, 2).alignment = { wrapText: true };
    ws.getCell(r, 3).value = op.description;           // C: Содержание
    ws.getCell(r, 3).alignment = { wrapText: true };
    ws.getCell(r, 4).value = op.equipment;             // D: Оборудование
    ws.getCell(r, 5).value = op.role;                  // E: Исполнитель
    ws.getCell(r, 6).value = op.norm_basis;            // F: Норматив
    ws.getCell(r, 7).value = op.setups;                // G: Установки

    // H: Чел-ч/шт — editable value
    ws.getCell(r, 8).value = op.chel_ch_sht;
    ws.getCell(r, 8).fill = YELLOW_FILL;

    // I: Чел-ч/партия = H * Вводные_данные!$B$6 (FORMULA)
    ws.getCell(r, 9).value = { formula: `H${r}*\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$B$6` };

    // J: Ставка = VLOOKUP by role from Вводные_данные (FORMULA)
    ws.getCell(r, 10).value = { formula: `IFERROR(VLOOKUP(E${r},\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$A$15:$B$21,2,FALSE),0)` };
    ws.getCell(r, 10).numFmt = NUM_FMT_RUB;

    // K: ФОТ = I * J (FORMULA)
    ws.getCell(r, 11).value = { formula: `I${r}*J${r}` };
    ws.getCell(r, 11).numFmt = NUM_FMT_RUB;

    // L: Страх.взносы = K * Вводные_данные!$E$25 (FORMULA)
    ws.getCell(r, 12).value = { formula: `K${r}*\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$E$25` };
    ws.getCell(r, 12).numFmt = NUM_FMT_RUB;

    // M: Маш-ч/шт — editable value
    ws.getCell(r, 13).value = op.mash_ch_sht;
    ws.getCell(r, 13).fill = YELLOW_FILL;

    // N: Маш-ч/партия = M * Вводные_данные!$B$6 (FORMULA)
    ws.getCell(r, 14).value = { formula: `M${r}*\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$B$6` };

    // O: Тариф = VLOOKUP by equipment (FORMULA)
    ws.getCell(r, 15).value = { formula: `IF(D${r}="",0,IFERROR(VLOOKUP(D${r},\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$D$15:$E$21,2,FALSE),0))` };
    ws.getCell(r, 15).numFmt = NUM_FMT_RUB;

    // P: Маш.затраты = N * O (FORMULA)
    ws.getCell(r, 16).value = { formula: `N${r}*O${r}` };
    ws.getCell(r, 16).numFmt = NUM_FMT_RUB;

    // Q: Мощн. кВт = VLOOKUP by equipment (FORMULA)
    ws.getCell(r, 17).value = { formula: `IF(D${r}="",0,IFERROR(VLOOKUP(D${r},\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$D$15:$G$21,4,FALSE),0))` };

    // R: кВт·ч/шт = M * Q (FORMULA)
    ws.getCell(r, 18).value = { formula: `M${r}*Q${r}` };

    // S: Энергия = R * Вводные_данные!$E$24 (FORMULA)
    ws.getCell(r, 19).value = { formula: `R${r}*\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$E$24` };
    ws.getCell(r, 19).numFmt = NUM_FMT_RUB;

    // T: ИТОГО прямые = K + L + P + S (FORMULA)
    ws.getCell(r, 20).value = { formula: `K${r}+L${r}+P${r}+S${r}` };
    ws.getCell(r, 20).numFmt = NUM_FMT_RUB;

    // U: Comment
    ws.getCell(r, 21).value = op.comment;
    ws.getCell(r, 21).alignment = { wrapText: true };

    // Borders for all cells
    for (let c = 1; c <= 21; c++) {
      ws.getCell(r, c).border = THIN_BORDER;
    }
  });

  // ИТОГО row — 2 rows below last data
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

  return { dataStart, lastDataRow, totalRow };
}

// ===== Sheet 7: Накладные_и_прибыль =====
// Reference: ALL values are formulas referencing Материалы, Операции, Вводные_данные
function buildOverheadSheet(wb, oh, operations) {
  const ws = wb.addWorksheet('Накладные_и_прибыль');
  setColWidths(ws, [50, 22, 50, 15, 15, 15, 15, 15, 15, 15]);

  // Row 1: merged
  mergeCells(ws, 'A1:J1');
  ws.getCell('A1').value = 'НАКЛАДНЫЕ РАСХОДЫ, РЕЗЕРВЫ И ПРИБЫЛЬ';
  ws.getCell('A1').font = TITLE_FONT;

  // Row 2: merged
  mergeCells(ws, 'A2:J2');
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

  // The totalRow on Operations sheet is dynamic
  // We need to know it. operations.rows.length + 4 (header) + 2 (gap) = totalRow
  // dataStart=5, lastDataRow=5+N-1, totalRow=lastDataRow+2
  const opTotalRow = 5 + operations.rows.length - 1 + 2;

  // B5: =Материалы!$F$16
  const matTotalRef = `\u041C\u0430\u0442\u0435\u0440\u0438\u0430\u043B\u044B!$F$16`;

  // B6: =Операции!$T$<totalRow>
  const opTotalRef = `\u041E\u043F\u0435\u0440\u0430\u0446\u0438\u0438!$T$${opTotalRow}`;

  // B7: =Операции!$K$<totalRow>+Операции!$L$<totalRow>
  const opFOTRef = `\u041E\u043F\u0435\u0440\u0430\u0446\u0438\u0438!$K$${opTotalRow}+\u041E\u043F\u0435\u0440\u0430\u0446\u0438\u0438!$L$${opTotalRow}`;

  const rows = [
    // Row 5
    ['Материалы, руб', { formula: matTotalRef }, 'Раздел 1'],
    // Row 6
    ['Прямые затраты по операциям, руб', { formula: opTotalRef }, 'ФОТ + взносы + машины + энергия'],
    // Row 7
    ['База накладных (ФОТ+страх.взносы), руб', { formula: opFOTRef }, 'Принята база начисления'],
    // Row 8
    ['Накладные расходы, руб', { formula: 'B7*\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$E$27' }, 'Накладные = база \u00D7 %'],
    // Row 9
    ['Промежуточная себестоимость, руб', { formula: 'B5+B6+B8' }, 'Материалы + операции + накладные'],
    // Row 10
    ['Резерв на технологические риски/брак, руб', { formula: 'B9*\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$E$29' }, 'Длина>5 м, профиль R25, двойная отделка'],
    // Row 11
    ['Себестоимость с резервом, руб', { formula: 'B9+B10' }, ''],
    // Row 12
    ['Прибыль, руб', { formula: 'B11*\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$E$28' }, 'Прибыль = себестоимость \u00D7 %'],
    // Row 13
    ['ИТОГО (себестоимость+прибыль), руб', { formula: 'B11+B12' }, 'Без учета логистики'],
  ];

  rows.forEach((row, i) => {
    const r = 5 + i;
    ws.getCell(r, 1).value = row[0];
    ws.getCell(r, 2).value = row[1];
    ws.getCell(r, 2).numFmt = NUM_FMT_RUB;
    ws.getCell(r, 3).value = row[2];
    applyBorderToRange(ws, r, 1, r, 3);
  });

  // Bold the last row (row 13)
  ws.getCell(13, 1).font = BOLD_FONT;
  ws.getCell(13, 2).font = BOLD_FONT;
}

// ===== Sheet 8: Транспорт =====
// Reference: formulas for calculated rows, страхование = Накладные_и_прибыль!$B$13*B10
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

  // Row 1: merged
  mergeCells(ws, 'A1:J1');
  ws.getCell('A1').value = 'РАЗДЕЛ 2 — ЛОГИСТИКА';
  ws.getCell('A1').font = TITLE_FONT;

  // Row 2: merged
  mergeCells(ws, 'A2:J2');
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

  const inputRows = [
    ['Расстояние, км', distance, 'дорожное расстояние'],
    ['Кол-во рейсов', trips, 'выделенный автомобиль под длинномер'],
    ['Тариф, руб/км (длинномер/выделенный транспорт)', tariff, 'редактируемый параметр'],
    ['Погрузка (кран/манипулятор), руб', loading, 'кран, стропальщики, время'],
    ['Разгрузка (кран/манипулятор), руб', unloading, 'длинномер, работа с такелажем'],
    ['Страхование/ответственность перевозчика, % от стоимости', insurance_pct, 'страховой тариф'],
  ];

  inputRows.forEach((row, i) => {
    const r = 5 + i;
    ws.getCell(r, 1).value = row[0];
    ws.getCell(r, 2).value = row[1];
    ws.getCell(r, 2).fill = YELLOW_FILL;
    if (typeof row[1] === 'number' && row[1] >= 100) ws.getCell(r, 2).numFmt = NUM_FMT_RUB;
    ws.getCell(r, 3).value = row[2];
    applyBorderToRange(ws, r, 1, r, 3);
  });

  // Calculated rows starting at row 12
  const calcStart = 12;

  // B12: Перевозка = B5*B7*B6 (FORMULA)
  ws.getCell(calcStart, 1).value = 'Перевозка (расстояние\u00D7тариф\u00D7рейсы), руб';
  ws.getCell(calcStart, 2).value = { formula: 'B5*B7*B6' };
  ws.getCell(calcStart, 2).numFmt = NUM_FMT_RUB;
  ws.getCell(calcStart, 3).value = 'Расстояние \u00D7 руб/км \u00D7 рейсы';
  applyBorderToRange(ws, calcStart, 1, calcStart, 3);

  // B13: Погрузка = B8 (FORMULA)
  ws.getCell(calcStart + 1, 1).value = 'Погрузка, руб';
  ws.getCell(calcStart + 1, 2).value = { formula: 'B8' };
  ws.getCell(calcStart + 1, 2).numFmt = NUM_FMT_RUB;
  ws.getCell(calcStart + 1, 3).value = '';
  applyBorderToRange(ws, calcStart + 1, 1, calcStart + 1, 3);

  // B14: Разгрузка = B9 (FORMULA)
  ws.getCell(calcStart + 2, 1).value = 'Разгрузка, руб';
  ws.getCell(calcStart + 2, 2).value = { formula: 'B9' };
  ws.getCell(calcStart + 2, 2).numFmt = NUM_FMT_RUB;
  ws.getCell(calcStart + 2, 3).value = '';
  applyBorderToRange(ws, calcStart + 2, 1, calcStart + 2, 3);

  // B15: Страхование = Накладные_и_прибыль!$B$13 * B10 (FORMULA)
  ws.getCell(calcStart + 3, 1).value = 'Страхование, руб';
  ws.getCell(calcStart + 3, 2).value = { formula: '\u041D\u0430\u043A\u043B\u0430\u0434\u043D\u044B\u0435_\u0438_\u043F\u0440\u0438\u0431\u044B\u043B\u044C!$B$13*B10' };
  ws.getCell(calcStart + 3, 2).numFmt = NUM_FMT_RUB;
  ws.getCell(calcStart + 3, 3).value = 'База: (себестоимость+прибыль) \u00D7 %';
  applyBorderToRange(ws, calcStart + 3, 1, calcStart + 3, 3);

  // B16: ИТОГО = SUM(B12:B15) (FORMULA)
  ws.getCell(calcStart + 4, 1).value = 'ИТОГО логистика, руб';
  ws.getCell(calcStart + 4, 2).value = { formula: 'SUM(B12:B15)' };
  ws.getCell(calcStart + 4, 2).numFmt = NUM_FMT_RUB;
  ws.getCell(calcStart + 4, 3).value = 'Сумма раздела 2';
  applyBorderToRange(ws, calcStart + 4, 1, calcStart + 4, 3);

  ws.getCell(calcStart + 4, 1).font = BOLD_FONT;
  ws.getCell(calcStart + 4, 2).font = BOLD_FONT;
}

// ===== Sheet 9: ИТОГО =====
// Reference: ALL values are formulas referencing Накладные_и_прибыль, Транспорт, Вводные_данные
function buildTotalSheet(wb, oh, geometry, operations) {
  const ws = wb.addWorksheet('ИТОГО');
  setColWidths(ws, [50, 22, 45, 15, 15, 15, 15, 15, 15, 15]);

  // Row 1: merged
  mergeCells(ws, 'A1:J1');
  ws.getCell('A1').value = 'ИТОГОВАЯ СТОИМОСТЬ';
  ws.getCell('A1').font = TITLE_FONT;

  // Row 2: FORMULA with qty
  mergeCells(ws, 'A2:J2');
  ws.getCell('A2').value = { formula: '"Стоимость за 1 шт. и за партию "&TEXT(\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435!$B$6,"0")&" шт., с учетом НДС (ставка во вводных данных)."' };

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

  const np = '\u041D\u0430\u043A\u043B\u0430\u0434\u043D\u044B\u0435_\u0438_\u043F\u0440\u0438\u0431\u044B\u043B\u044C';
  const vd = '\u0412\u0432\u043E\u0434\u043D\u044B\u0435_\u0434\u0430\u043D\u043D\u044B\u0435';
  const tr = '\u0422\u0440\u0430\u043D\u0441\u043F\u043E\u0440\u0442';

  const rows = [
    // Row 5
    ['Материалы (раздел 1)', { formula: `${np}!$B$5` }, ''],
    // Row 6
    ['Прямые затраты по операциям (раздел 3)', { formula: `${np}!$B$6` }, ''],
    // Row 7
    ['Накладные расходы', { formula: `${np}!$B$7` }, ''],
    // Row 8
    ['Резерв на риски/брак', { formula: `${np}!$B$10` }, ''],
    // Row 9
    ['Прибыль', { formula: `${np}!$B$12` }, ''],
    // Row 10
    ['ИТОГО производственная часть (без логистики)', { formula: `${np}!$B$13` }, ''],
    // Row 11
    ['Логистика (раздел 2)', { formula: `${tr}!$B$16` }, ''],
    // Row 12
    ['ИТОГО без НДС', { formula: 'B10+B11' }, ''],
    // Row 13
    ['НДС', { formula: `B12*${vd}!$E$26` }, ''],
    // Row 14
    ['ИТОГО с НДС', { formula: 'B12+B13' }, ''],
    // Row 15
    ['Стоимость 1 шт. без НДС', { formula: `IF(${vd}!$B$6=0,"-",B12/${vd}!$B$6)` }, ''],
    // Row 16
    ['Стоимость 1 шт. с НДС', { formula: `IF(${vd}!$B$6=0,"-",B14/${vd}!$B$6)` }, ''],
    // Row 17: dynamic label with formula
    [{ formula: `IF(${vd}!$E$23="","Стоимость 1 м² без НДС","Стоимость 1 м² ("&${vd}!$E$23&") без НДС")` },
     { formula: `IF(${vd}!$B$23*${vd}!$B$6=0,"-",B12/(${vd}!$B$23*${vd}!$B$6))` },
     `Вводные_данные!B23 (база м²/1шт) \u00D7 кол-во; методика: Вводные_данные!E23`],
    // Row 18
    [{ formula: `IF(${vd}!$E$23="","Стоимость 1 м² с НДС","Стоимость 1 м² ("&${vd}!$E$23&") с НДС")` },
     { formula: `IF(${vd}!$B$23*${vd}!$B$6=0,"-",B14/(${vd}!$B$23*${vd}!$B$6))` },
     `Вводные_данные!B23 (база м²/1шт) \u00D7 кол-во; методика: Вводные_данные!E23`],
    // Row 19
    [{ formula: `IF(${vd}!$H$23="","Стоимость 1 м.п. без НДС","Стоимость 1 м.п. ("&${vd}!$H$23&") без НДС")` },
     { formula: `IF(${vd}!$B$24*${vd}!$B$6=0,"-",B12/(${vd}!$B$24*${vd}!$B$6))` },
     `Вводные_данные!B24 (база м.п./1шт) \u00D7 кол-во; методика: Вводные_данные!H23`],
    // Row 20
    [{ formula: `IF(${vd}!$H$23="","Стоимость 1 м.п. с НДС","Стоимость 1 м.п. ("&${vd}!$H$23&") с НДС")` },
     { formula: `IF(${vd}!$B$24*${vd}!$B$6=0,"-",B14/(${vd}!$B$24*${vd}!$B$6))` },
     `Вводные_данные!B24 (база м.п./1шт) \u00D7 кол-во; методика: Вводные_данные!H23`],
  ];

  rows.forEach((row, i) => {
    const r = 5 + i;
    ws.getCell(r, 1).value = row[0];
    ws.getCell(r, 2).value = row[1];
    ws.getCell(r, 2).numFmt = NUM_FMT_RUB;
    ws.getCell(r, 3).value = row[2];
    applyBorderToRange(ws, r, 1, r, 3);
  });

  // Bold key rows: ИТОГО с НДС (row 14), per-piece with НДС (row 16)
  [10, 12, 14].forEach(r => {
    ws.getCell(r, 1).font = BOLD_FONT;
    ws.getCell(r, 2).font = BOLD_FONT;
  });

  // ИТОГО с НДС is row 14
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
