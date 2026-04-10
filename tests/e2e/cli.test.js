#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createMinimalExcelFixture } = require('./support/fixture-excel');

const repoRoot = path.resolve(__dirname, '../..');
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-e2e-cli-'));

try {
  require.resolve('pdfkit');
} catch (_error) {
  console.log('SKIP: зависимости проекта не установлены (pdfkit).');
  process.exit(0);
}

try {
  const fixture = createMinimalExcelFixture();
  try {
    const result = spawnSync('node', ['src/index.js', '--input', fixture.filePath, '--output', outputDir, '--rkm'], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 120000
    });

    assert.strictEqual(result.status, 0, `CLI завершился с кодом ${result.status}: ${result.stderr || result.stdout}`);

    const files = fs.readdirSync(outputDir);
    const docx = files.find((name) => name.endsWith('.docx'));
    const xlsx = files.find((name) => name.endsWith('.xlsx'));

    assert.ok(docx, 'CLI не сгенерировал DOCX');
    assert.ok(xlsx, 'CLI не сгенерировал XLSX');

    const docxSize = fs.statSync(path.join(outputDir, docx)).size;
    const xlsxSize = fs.statSync(path.join(outputDir, xlsx)).size;
    assert.ok(docxSize > 0, 'Сгенерированный DOCX пустой');
    assert.ok(xlsxSize > 0, 'Сгенерированный XLSX пустой');

    console.log('cli.e2e test passed');
  } finally {
    fixture.cleanup();
  }
} finally {
  fs.rmSync(outputDir, { recursive: true, force: true });
}
