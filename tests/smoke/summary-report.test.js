#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const pdfParse = require('pdf-parse');
const { generateBatch } = require('../../src/generator');
const { generateSummaryReport } = require('../../src/summary-report');

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
    ['Реестр ТК', 'Сводка цен', 'Материалы', 'Трудозатраты'].forEach((requiredSheet) => {
      assert(sheetNames.includes(requiredSheet), `SUMMARY should contain sheet: ${requiredSheet}`);
    });

    const pricing = wb.getWorksheet('Сводка цен');
    assert(pricing.rowCount > 1, 'Сводка цен should contain data rows');

    const parsedPdf = await pdfParse(fs.readFileSync(pdfFile.file));
    assert(parsedPdf.numpages >= 1, 'SUMMARY pdf should have pages');

    console.log(`Summary smoke test passed: ${path.basename(xlsxFile.file)} + ${path.basename(pdfFile.file)}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error('Summary smoke test failed:', err);
  process.exit(1);
});
