#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { generateBatch } = require('../../src/generator');
const { generateSummaryReport } = require('../../src/summary-report');

const batch = require('../../examples/batch_small.json');

(async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-smoke-summary-'));

  try {
    const products = batch.products.map((p) => ({ ...p }));
    const tkResults = await generateBatch(products, tmpDir);

    const result = await generateSummaryReport(products, tkResults, tmpDir);

    assert(result && result.file, 'generateSummaryReport should return file path in result.file');
    assert(fs.existsSync(result.file), 'SUMMARY xlsx file should exist');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(result.file);

    const sheetNames = wb.worksheets.map((ws) => ws.name);
    ['Реестр ТК', 'Сводка цен', 'Материалы', 'Трудозатраты'].forEach((requiredSheet) => {
      assert(sheetNames.includes(requiredSheet), `SUMMARY should contain sheet: ${requiredSheet}`);
    });

    const pricing = wb.getWorksheet('Сводка цен');
    assert(pricing.rowCount > 1, 'Сводка цен should contain data rows');

    console.log(`Summary smoke test passed: ${path.basename(result.file)}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error('Summary smoke test failed:', err);
  process.exit(1);
});
