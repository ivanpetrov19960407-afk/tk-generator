'use strict';

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { calcGeometry } = require('./rkm/geometry-calc');
const { mapOperations } = require('./rkm/operations-mapper');
const { calcMaterials } = require('./rkm/materials-calc');
const { calcOverheads } = require('./rkm/overhead-calc');
const { calcTransport } = require('./rkm/rkm-generator');
const {
  detectAreaMode,
  buildSizeBasedOverrides,
  buildSizeBasedMaterialPrices,
  getSizeBasedKReject,
  getControlUnit,
  getCalcPrice
} = require('./rkm/optimizer');

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      right: { style: 'thin', color: { argb: 'FFD9D9D9' } }
    };
  });
}

function autoFitColumns(ws, minWidth = 10, maxWidth = 60) {
  ws.columns.forEach((column) => {
    let max = minWidth;
    column.eachCell({ includeEmpty: true }, (cell) => {
      const text = cell.value == null ? '' : String(cell.value);
      max = Math.max(max, Math.min(maxWidth, text.length + 2));
    });
    column.width = max;
  });
}

function applyAreaModeAdjustments(product) {
  const workProduct = deepClone(product);
  const areaMode = detectAreaMode(workProduct);

  if (!areaMode) return workProduct;

  if (!workProduct.quantity_pieces && areaMode.quantityPieces) {
    workProduct.quantity_pieces = areaMode.quantityPieces;
  }

  const geometry = calcGeometry(workProduct);
  const V_net = geometry.V_net;
  const qty = workProduct.quantity_pieces || 1;
  if (!workProduct.rkm) workProduct.rkm = {};

  const userNorms = workProduct.rkm.norms_override || {};
  workProduct.rkm.norms_override = {
    ...buildSizeBasedOverrides(workProduct, geometry, areaMode),
    ...userNorms
  };

  const userPrices = workProduct.rkm.material_prices || {};
  workProduct.rkm.material_prices = {
    ...buildSizeBasedMaterialPrices(V_net, qty),
    ...userPrices
  };

  if (!product.rkm || !product.rkm.k_reject) {
    workProduct.rkm.k_reject = getSizeBasedKReject(V_net);
  }

  return workProduct;
}

function calcProductSummary(product) {
  const workProduct = applyAreaModeAdjustments(product);
  const geometry = calcGeometry(workProduct);
  const operations = mapOperations(workProduct, geometry);
  const areaMode = detectAreaMode(workProduct);
  const unitLabel = areaMode ? (areaMode.controlUnit === 'm2' ? 'м²' : 'м.п.') : 'шт';
  const materials = calcMaterials(workProduct, geometry, unitLabel);

  const tempOverheads = calcOverheads(materials, operations, { total: 0 }, geometry);
  const transport = calcTransport(workProduct, tempOverheads);
  const overheads = calcOverheads(materials, operations, transport, geometry);

  const controlUnit = getControlUnit(workProduct);
  const calcPrice = getCalcPrice(overheads, controlUnit);

  return {
    workProduct,
    geometry,
    operations,
    materials,
    overheads,
    controlUnit,
    calcPrice
  };
}

async function generateSummaryReport(products, tkResults, outputDir) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'tk-generator';
  wb.created = new Date();

  const calculations = products.map((p) => calcProductSummary(p));

  const tkStatusByNumber = new Map(
    tkResults.map((r) => [String(r.product && r.product.tk_number), r.success ? 'Сгенерировано' : `Ошибка: ${r.error || 'неизвестно'}`])
  );

  const registry = wb.addWorksheet('Реестр ТК');
  registry.addRow(['№', 'Наименование', 'Размеры, мм', 'Материал', 'Фактура', 'Статус генерации']);
  styleHeaderRow(registry.getRow(1));

  calculations.forEach(({ workProduct }) => {
    const d = workProduct.dimensions || {};
    const dims = `${d.length || 0}×${d.width || 0}×${d.thickness || 0}`;
    registry.addRow([
      workProduct.tk_number || '',
      workProduct.name || '',
      dims,
      (workProduct.material && workProduct.material.name) || (workProduct.material && workProduct.material.type) || '',
      workProduct.texture || '',
      tkStatusByNumber.get(String(workProduct.tk_number)) || 'Не запускалось'
    ]);
  });

  const pricing = wb.addWorksheet('Сводка цен');
  pricing.addRow(['№', 'Наименование', 'Ед.', 'Контрольная цена', 'Расчётная цена', 'Отклонение, %']);
  styleHeaderRow(pricing.getRow(1));

  calculations.forEach(({ workProduct, calcPrice, controlUnit }) => {
    const controlPrice = Number(workProduct.control_price) || 0;
    const deviation = controlPrice > 0 ? ((calcPrice - controlPrice) / controlPrice) * 100 : null;

    pricing.addRow([
      workProduct.tk_number || '',
      workProduct.name || '',
      controlUnit === 'm2' ? 'м²' : controlUnit === 'mp' ? 'м.п.' : 'шт',
      controlPrice,
      calcPrice,
      deviation
    ]);
  });

  const lastPricingRow = pricing.rowCount;
  pricing.getColumn(4).numFmt = '#,##0.00';
  pricing.getColumn(5).numFmt = '#,##0.00';
  pricing.getColumn(6).numFmt = '0.00';

  if (lastPricingRow >= 2) {
    pricing.addConditionalFormatting({
      ref: `F2:F${lastPricingRow}`,
      rules: [{
        type: 'expression',
        formulae: ['ABS(F2)>5'],
        style: {
          fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' }, fgColor: { argb: 'FFFFC7CE' } },
          font: { color: { argb: 'FF9C0006' }, bold: true }
        }
      }]
    });
  }

  const materialsWs = wb.addWorksheet('Материалы');
  materialsWs.addRow(['Материал', 'Общий объём сырья, м³', 'Общая масса, кг']);
  styleHeaderRow(materialsWs.getRow(1));

  const materialAgg = new Map();
  calculations.forEach(({ workProduct, geometry }) => {
    const matName = (workProduct.material && workProduct.material.name) || (workProduct.material && workProduct.material.type) || 'Не указан';
    if (!materialAgg.has(matName)) {
      materialAgg.set(matName, { volume: 0, mass: 0 });
    }
    const acc = materialAgg.get(matName);
    acc.volume += Number(geometry.raw_need_batch) || 0;
    acc.mass += Number(geometry.mass_batch) || 0;
  });

  for (const [material, totals] of materialAgg.entries()) {
    materialsWs.addRow([material, totals.volume, totals.mass]);
  }

  const materialTotalVolume = Array.from(materialAgg.values()).reduce((s, v) => s + v.volume, 0);
  const materialTotalMass = Array.from(materialAgg.values()).reduce((s, v) => s + v.mass, 0);
  const matTotalRow = materialsWs.addRow(['ИТОГО', materialTotalVolume, materialTotalMass]);
  matTotalRow.font = { bold: true };
  materialsWs.getColumn(2).numFmt = '0.000000';
  materialsWs.getColumn(3).numFmt = '#,##0.00';

  const laborWs = wb.addWorksheet('Трудозатраты');
  laborWs.addRow(['№ оп.', 'Операция', 'Суммарно чел-ч', 'Суммарно маш-ч']);
  styleHeaderRow(laborWs.getRow(1));

  const opAgg = new Map();
  calculations.forEach(({ operations }) => {
    (operations.rows || []).forEach((op) => {
      if (!opAgg.has(op.no)) {
        opAgg.set(op.no, { name: op.name, chel: 0, mash: 0 });
      }
      const acc = opAgg.get(op.no);
      acc.chel += Number(op.chel_ch_party) || 0;
      acc.mash += Number(op.mash_ch_party) || 0;
    });
  });

  const sortedOps = Array.from(opAgg.entries()).sort((a, b) => Number(a[0]) - Number(b[0]));
  for (const [no, data] of sortedOps) {
    laborWs.addRow([no, data.name, data.chel, data.mash]);
  }

  const totalChel = sortedOps.reduce((s, [, d]) => s + d.chel, 0);
  const totalMash = sortedOps.reduce((s, [, d]) => s + d.mash, 0);
  const laborTotalRow = laborWs.addRow(['', 'ИТОГО', totalChel, totalMash]);
  laborTotalRow.font = { bold: true };
  laborWs.getColumn(3).numFmt = '0.000';
  laborWs.getColumn(4).numFmt = '0.000';

  [registry, pricing, materialsWs, laborWs].forEach((ws) => {
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    autoFitColumns(ws);
  });

  fs.mkdirSync(outputDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const outPath = path.join(outputDir, `SUMMARY_${date}.xlsx`);
  await wb.xlsx.writeFile(outPath);

  return { file: outPath };
}

module.exports = {
  generateSummaryReport
};
