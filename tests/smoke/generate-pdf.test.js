#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pdfParse = require('pdf-parse');
const { generateDocument } = require('../../src/generator');

const batch = require('../../examples/batch_small.json');

(async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-smoke-pdf-'));

  try {
    const product = { ...batch.products[0] };
    const result = await generateDocument(product, tmpDir, { format: 'pdf' });

    assert(result && result.filePath, 'generateDocument should return filePath');
    assert(result.filePath.endsWith('.pdf'), 'Result should point to PDF file');
    assert(fs.existsSync(result.filePath), 'PDF file should exist');

    const buffer = fs.readFileSync(result.filePath);
    assert(buffer.slice(0, 4).toString('utf8') === '%PDF', 'PDF header should be present');

    const parsed = await pdfParse(buffer);
    assert(parsed.numpages >= 1, 'PDF should have at least one page');

    console.log(`PDF smoke test passed: ${path.basename(result.filePath)} (${buffer.length} bytes, pages: ${parsed.numpages})`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error('PDF smoke test failed:', err);
  process.exit(1);
});
