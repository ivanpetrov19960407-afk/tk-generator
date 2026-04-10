'use strict';

const fs = require('fs');
const path = require('path');
const { sanitizeCsvValue } = require('./utils/security');

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function formatDateForFile(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function xmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function csvEscape(value) {
  const normalized = sanitizeCsvValue(value);
  const raw = String(normalized == null ? '' : normalized);
  const escaped = raw.replace(/"/g, '""');
  return /[",\n;]/.test(raw) ? `"${escaped}"` : escaped;
}

function makeOperationsSpec(costItem) {
  const operations = Array.isArray(costItem && costItem.operations_cost) ? costItem.operations_cost : [];
  return operations.map((operation) => ({
    number: operation.operation_number,
    name: operation.operation_name,
    laborNormHours: round2(operation.labor_hours),
    machineNormHours: round2(operation.machine_hours),
    laborCost: round2(operation.labor_cost),
    machineCost: round2(operation.machine_cost),
    materialCost: round2(operation.material_cost),
    totalCost: round2(operation.total_operation_cost)
  }));
}

function buildExportRows(products, costs) {
  return products.map((product, index) => {
    const costItem = costs[index] || {};
    const operations = makeOperationsSpec(costItem);

    const materialsCost = round2(operations.reduce((sum, op) => sum + op.materialCost, 0));
    const laborCost = round2(operations.reduce((sum, op) => sum + op.laborCost, 0));

    return {
      nomenclature: {
        name: product.name || `Позиция ${product.tk_number || index + 1}`,
        article: product.tk_number != null ? String(product.tk_number) : String(index + 1),
        unit: product.control_unit || 'шт'
      },
      calculation: {
        materials: materialsCost,
        labor: laborCost,
        overhead: round2(costItem.overhead_cost),
        profit: round2(costItem.markup_amount),
        total: round2(costItem.selling_price)
      },
      specification: operations
    };
  });
}

function write1CXml(products, costs, outputDir, date = new Date()) {
  const rows = buildExportRows(products, costs);
  const fileDate = formatDateForFile(date);
  const exportPath = path.join(outputDir, `1c_export_${fileDate}.xml`);

  fs.mkdirSync(outputDir, { recursive: true });

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<КоммерческаяИнформация ВерсияСхемы="2.0" ДатаФормирования="' + xmlEscape(fileDate) + '">',
    '  <Калькуляции>'
  ];

  rows.forEach((row) => {
    xml.push('    <Позиция>');
    xml.push('      <Номенклатура>');
    xml.push(`        <Наименование>${xmlEscape(row.nomenclature.name)}</Наименование>`);
    xml.push(`        <Артикул>${xmlEscape(row.nomenclature.article)}</Артикул>`);
    xml.push(`        <ЕдиницаИзмерения>${xmlEscape(row.nomenclature.unit)}</ЕдиницаИзмерения>`);
    xml.push('      </Номенклатура>');

    xml.push('      <Калькуляция>');
    xml.push(`        <Материалы>${row.calculation.materials.toFixed(2)}</Материалы>`);
    xml.push(`        <ФОТ>${row.calculation.labor.toFixed(2)}</ФОТ>`);
    xml.push(`        <Накладные>${row.calculation.overhead.toFixed(2)}</Накладные>`);
    xml.push(`        <Прибыль>${row.calculation.profit.toFixed(2)}</Прибыль>`);
    xml.push(`        <Итого>${row.calculation.total.toFixed(2)}</Итого>`);
    xml.push('      </Калькуляция>');

    xml.push('      <Спецификация>');
    row.specification.forEach((op) => {
      xml.push('        <Операция>');
      xml.push(`          <Номер>${xmlEscape(op.number)}</Номер>`);
      xml.push(`          <Наименование>${xmlEscape(op.name)}</Наименование>`);
      xml.push(`          <НормаТруда>${op.laborNormHours.toFixed(2)}</НормаТруда>`);
      xml.push(`          <НормаМаш>${op.machineNormHours.toFixed(2)}</НормаМаш>`);
      xml.push('        </Операция>');
    });
    xml.push('      </Спецификация>');
    xml.push('    </Позиция>');
  });

  xml.push('  </Калькуляции>');
  xml.push('</КоммерческаяИнформация>');

  fs.writeFileSync(exportPath, `${xml.join('\n')}\n`, 'utf8');
  return exportPath;
}

function write1CCsv(products, costs, outputDir, date = new Date()) {
  const rows = buildExportRows(products, costs);
  const fileDate = formatDateForFile(date);
  const exportPath = path.join(outputDir, `1c_export_${fileDate}.csv`);

  fs.mkdirSync(outputDir, { recursive: true });

  const header = [
    'Наименование',
    'Артикул',
    'ЕдИзм',
    'Материалы',
    'ФОТ',
    'Накладные',
    'Прибыль',
    'Итого',
    'Спецификация'
  ];

  const lines = [header.join(';')];

  rows.forEach((row) => {
    const specification = row.specification
      .map((op) => `#${op.number} ${op.name} (труд:${op.laborNormHours.toFixed(2)}; маш:${op.machineNormHours.toFixed(2)})`)
      .join(' | ');

    const line = [
      row.nomenclature.name,
      row.nomenclature.article,
      row.nomenclature.unit,
      row.calculation.materials.toFixed(2),
      row.calculation.labor.toFixed(2),
      row.calculation.overhead.toFixed(2),
      row.calculation.profit.toFixed(2),
      row.calculation.total.toFixed(2),
      specification
    ].map(csvEscape).join(';');

    lines.push(line);
  });

  fs.writeFileSync(exportPath, `${lines.join('\n')}\n`, 'utf8');
  return exportPath;
}

module.exports = {
  formatDateForFile,
  buildExportRows,
  write1CXml,
  write1CCsv
};
