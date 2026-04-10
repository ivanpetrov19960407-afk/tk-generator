#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { calculateTotalCost } = require('../src/cost-calculator');
const { buildExportRows, write1CXml, write1CCsv, formatDateForFile } = require('../src/export-1c');
const batch = require('../examples/batch_input.json');

(function testDateFormat() {
  const d = new Date('2026-04-10T12:00:00Z');
  assert.strictEqual(formatDateForFile(d), '2026-04-10');
})();

(function testBuildRows() {
  const product = batch.products[0];
  const cost = calculateTotalCost(product);
  const rows = buildExportRows([product], [cost]);

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].nomenclature.article, String(product.tk_number));
  assert(rows[0].calculation.total > 0, 'total must be > 0');
  assert(rows[0].specification.length > 0, 'specification must not be empty');
})();

(function testXmlAndCsvWrites() {
  const product = batch.products[0];
  const cost = calculateTotalCost(product);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-1c-export-'));

  const date = new Date('2026-04-10T12:00:00Z');
  const xmlPath = write1CXml([product], [cost], outDir, date);
  const csvPath = write1CCsv([product], [cost], outDir, date);

  assert(fs.existsSync(xmlPath), 'xml file must exist');
  assert(fs.existsSync(csvPath), 'csv file must exist');

  const xmlText = fs.readFileSync(xmlPath, 'utf8');
  const csvText = fs.readFileSync(csvPath, 'utf8');

  assert(xmlText.includes('<КоммерческаяИнформация'), 'xml should have root');
  assert(xmlText.includes('<Калькуляция>'), 'xml should include calculation block');
  assert(csvText.startsWith('Наименование;Артикул;ЕдИзм;'), 'csv should include header');
})();

console.log('export-1c tests passed');
