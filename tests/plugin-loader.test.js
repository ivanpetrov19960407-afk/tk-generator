#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadPlugins, resolveLoadOrder } = require('../src/plugin-loader');
const { getDefaultDensityByMaterialType, getSupportedTextures } = require('../src/plugin-registry');
const { generateDocument } = require('../src/generator');

async function run() {
  const report = loadPlugins({ pluginsDir: path.resolve(__dirname, '..', 'plugins') });
  assert.strictEqual(report.errors.length, 0, 'Плагины должны загружаться без ошибок');
  assert.ok(report.loaded.some((p) => p.name === 'granite-special'), 'Плагин granite-special должен быть загружен');

  const density = getDefaultDensityByMaterialType('гранит_спец');
  assert.strictEqual(density, 2850, 'Плагин должен регистрировать материал с плотностью 2850');
  assert.ok(getSupportedTextures().includes('гранит_спец'), 'Плагин должен регистрировать новую фактуру');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-plugin-'));
  try {
    const product = {
      tk_number: 901,
      name: 'Плита тестовая гранит спец',
      short_name: 'plita_plugin',
      dimensions: { length: 600, width: 300, thickness: 30 },
      material: { type: 'гранит_спец', name: 'Гранит Special Black' },
      texture: 'гранит_спец',
      quantity_pieces: 2,
      edges: 'фаска 2мм'
    };

    const result = await generateDocument(product, tmpDir);
    assert.ok(result.filePath && fs.existsSync(result.filePath), 'ТК с плагинным материалом должна успешно генерироваться');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const ordered = resolveLoadOrder([
    { manifest: { name: 'a', dependencies: [] } },
    { manifest: { name: 'b', dependencies: ['a'] } }
  ]);
  assert.deepStrictEqual(ordered.map((x) => x.manifest.name), ['a', 'b'], 'resolveLoadOrder должен учитывать зависимости');

  console.log('plugin-loader.test.js passed');
}

run().catch((err) => {
  console.error('plugin-loader.test.js failed:', err);
  process.exit(1);
});
