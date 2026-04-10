#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { generateRKM } = require('../../src/rkm/rkm-generator');

const batch = require('../../examples/batch_small.json');

(async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-smoke-rkm-'));

  try {
    const product = { ...batch.products[0] };
    const result = await generateRKM(product, tmpDir, { optimize: false });

    assert(result && result.file, 'generateRKM should return file path in result.file');
    assert(fs.existsSync(result.file), 'XLSX file should exist');

    const stat = fs.statSync(result.file);
    assert(stat.size > 0, 'XLSX file should be non-empty');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(result.file);

    const sheetNames = wb.worksheets.map((ws) => ws.name);
    ['Титульный лист', 'Вводные_данные', 'ИТОГО'].forEach((requiredSheet) => {
      assert(
        sheetNames.includes(requiredSheet),
        `XLSX should contain sheet: ${requiredSheet}`
      );
    });

    console.log(`RKM smoke test passed: ${path.basename(result.file)} (${stat.size} bytes)`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error('RKM smoke test failed:', err);
  process.exit(1);
});
