#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const { generateDocument } = require('../src/generator');

const batch = require('../examples/batch_small.json');

(async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-template-test-'));
  try {
    const product = { ...batch.products[0] };
    const result = await generateDocument(product, tmpDir, {
      templatePath: path.resolve(__dirname, '../templates/tk_default.docx')
    });

    const buffer = fs.readFileSync(result.filePath);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('word/document.xml').async('string');

    assert(!xml.includes('{{product.name}}'), 'product.name placeholder should be replaced');
    assert(xml.includes('<w:tbl>'), 'template output should contain tables');
    assert(!xml.includes('{{operations_table}}'), 'operations_table placeholder should be replaced');
    assert(!xml.includes('{{mk_table}}'), 'mk_table placeholder should be replaced');

    console.log('Template engine test passed');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error('Template engine test failed:', err);
  process.exit(1);
});
