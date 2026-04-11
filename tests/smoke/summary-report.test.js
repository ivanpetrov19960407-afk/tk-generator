#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const pdfParse = require('pdf-parse');
const { generateBatch } = require('../../src/generator');
const { generateSummaryReport, writeSummaryCsvFile, SUMMARY_CSV_COLUMNS } = require('../../src/summary-report');

const batch = require('../../examples/batch_small.json');

(async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-smoke-summary-'));

  try {
    const products = batch.products.map((p) => ({ ...p }));
    const tkResults = await generateBatch(products, tmpDir);

    const result = await generateSummaryReport(products, tkResults, tmpDir, { format: 'xlsx,pdf' });

    assert(result && Array.isArray(result.files), 'generateSummaryReport should return files array');
    const xlsxFile = result.files.find((f) => f.format === 'xlsx');
    const pdfFile = result.files.find((f) => f.format === 'pdf');
    assert(xlsxFile && fs.existsSync(xlsxFile.file), 'SUMMARY xlsx file should exist');
    assert(pdfFile && fs.existsSync(pdfFile.file), 'SUMMARY pdf file should exist');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(xlsxFile.file);

    const sheetNames = wb.worksheets.map((ws) => ws.name);
    ['Реестр ТК', 'Сводка цен', 'Материалы', 'Трудозатраты', 'Сводка по материалам', 'BOM', 'Сводка по фактурам'].forEach((requiredSheet) => {
      assert(sheetNames.includes(requiredSheet), `SUMMARY should contain sheet: ${requiredSheet}`);
    });

    const pricing = wb.getWorksheet('Сводка цен');
    assert(pricing.rowCount > 1, 'Сводка цен should contain data rows');
    assert(wb.getWorksheet('Сводка по материалам').rowCount > 1, 'Сводка по материалам should contain data rows');
    assert(wb.getWorksheet('BOM').rowCount > 1, 'BOM should contain data rows');
    assert(wb.getWorksheet('Сводка по фактурам').rowCount > 1, 'Сводка по фактурам should contain data rows');

    const csvPath = path.join(tmpDir, 'summary_export.csv');
    writeSummaryCsvFile(products.map((product) => ({
      workProduct: product,
      geometry: { qty: Number(product.quantity_pieces) || 1 },
      calcPrice: null
    })), csvPath);
    const csvBuffer = fs.readFileSync(csvPath);
    assert.strictEqual(csvBuffer[0], 0xEF, 'CSV should start with BOM byte 0xEF');
    assert.strictEqual(csvBuffer[1], 0xBB, 'CSV should start with BOM byte 0xBB');
    assert.strictEqual(csvBuffer[2], 0xBF, 'CSV should start with BOM byte 0xBF');
    const csvText = csvBuffer.toString('utf8');
    const csvLines = csvText.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    const normalizedHeader = csvLines[0].replace(/"/g, '');
    assert.strictEqual(normalizedHeader, SUMMARY_CSV_COLUMNS.join(';'), 'CSV header should match fixed columns');

    const dangerousPath = path.join(tmpDir, 'summary_export_dangerous.csv');
    writeSummaryCsvFile([{
      workProduct: {
        tk_number: 999,
        name: '=cmd',
        material: { name: '+stone' },
        texture: '@rough',
        dimensions: { length: 1, width: 2, thickness: 3 },
        quantity_pieces: 1,
        control_unit: 'шт',
        quantity: '-1',
        control_price: 10
      },
      geometry: { qty: 1 },
      calcPrice: 12
    }], dangerousPath);
    const dangerousCsv = fs.readFileSync(dangerousPath, 'utf8');
    assert(dangerousCsv.includes('\'=cmd'), 'CSV dangerous value (=) should be sanitized');
    assert(dangerousCsv.includes('\'+stone'), 'CSV dangerous value (+) should be sanitized');
    assert(dangerousCsv.includes('\'@rough'), 'CSV dangerous value (@) should be sanitized');
    assert(dangerousCsv.includes('\'-1'), 'CSV dangerous value (-) should be sanitized');

    const parsedPdf = await pdfParse(fs.readFileSync(pdfFile.file));
    assert(parsedPdf.numpages >= 1, 'SUMMARY pdf should have pages');
    const normalizedText = String(parsedPdf.text || '').replace(/\s+/g, ' ').trim();
    assert(/[А-Яа-яЁё]/.test(normalizedText), 'SUMMARY pdf should contain Cyrillic text');
    assert(normalizedText.includes('Сводный отчёт ТК+МК'), 'SUMMARY pdf should contain expected heading');

    console.log(`Summary smoke test passed: ${path.basename(xlsxFile.file)} + ${path.basename(pdfFile.file)}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error('Summary smoke test failed:', err);
  process.exit(1);
});
