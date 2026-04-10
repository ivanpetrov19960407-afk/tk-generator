#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const JSZip = require('jszip');
const { createMinimalExcelFixture } = require('./support/fixture-excel');

(async () => {
  let request;
  try {
    request = require('supertest');
  } catch (_error) {
    console.log('SKIP: supertest не установлен в окружении.');
    process.exit(0);
  }
  try {
    require.resolve('pdfkit');
  } catch (_error) {
    console.log('SKIP: зависимости проекта не установлены (pdfkit).');
    process.exit(0);
  }

  const { createApp } = require('../../src/server/index');

  const app = createApp();
  const api = request(app.listen());
  let fixture = null;

  try {
    fixture = createMinimalExcelFixture();
    const fixtureXlsx = fixture.filePath;
    const uploadRes = await api
      .post('/api/upload-excel')
      .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .send(fs.readFileSync(fixtureXlsx));

    assert.strictEqual(uploadRes.status, 200, `upload-excel: expected 200, got ${uploadRes.status}`);
    assert.ok(Array.isArray(uploadRes.body.products), 'upload-excel: products должен быть массивом');
    assert.strictEqual(uploadRes.body.products.length, 3, 'upload-excel: expected 3 products');

    const generateRes = await api
      .post('/api/generate')
      .set('Content-Type', 'application/json')
      .send({ products: uploadRes.body.products });

    assert.strictEqual(generateRes.status, 200, `generate: expected 200, got ${generateRes.status}`);
    const zip = await JSZip.loadAsync(generateRes.body);
    const names = Object.keys(zip.files);

    assert.ok(names.some((n) => n.endsWith('.docx')), 'generate: ZIP должен содержать DOCX');
    assert.ok(names.some((n) => n.endsWith('.xlsx')), 'generate: ZIP должен содержать XLSX');

    const docxName = names.find((n) => n.endsWith('.docx'));
    const xlsxName = names.find((n) => n.endsWith('.xlsx'));
    const docxBuffer = await zip.file(docxName).async('nodebuffer');
    const xlsxBuffer = await zip.file(xlsxName).async('nodebuffer');

    assert.ok(docxBuffer.length > 0, 'DOCX в ZIP не должен быть пустым');
    assert.ok(xlsxBuffer.length > 0, 'XLSX в ZIP не должен быть пустым');

    console.log('api.e2e test passed');
  } finally {
    if (fixture) fixture.cleanup();
    api.app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
