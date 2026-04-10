#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateDocument } = require('../../src/generator');

const batch = require('../../examples/batch_small.json');

(async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-smoke-docx-'));

  try {
    const product = { ...batch.products[0] };
    const result = await generateDocument(product, tmpDir);

    assert(result && result.filePath, 'generateDocument should return filePath');
    assert(fs.existsSync(result.filePath), 'DOCX file should exist');

    const stat = fs.statSync(result.filePath);
    assert(stat.size > 0, 'DOCX file should be non-empty');

    console.log(`DOCX smoke test passed: ${path.basename(result.filePath)} (${stat.size} bytes)`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error('DOCX smoke test failed:', err);
  process.exit(1);
});
