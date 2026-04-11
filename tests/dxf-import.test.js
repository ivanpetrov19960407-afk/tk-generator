#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseDxfFile } = require('../src/utils/dxf-import');

function makeTempDxf(name, content) {
  const file = path.join(os.tmpdir(), `tk-${Date.now()}-${name}.dxf`);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

(function run() {
  const sample = path.resolve(__dirname, 'fixtures/sample.dxf');
  const inches = path.resolve(__dirname, 'fixtures/sample-inches.dxf');

  const parsed = parseDxfFile(sample);
  assert.strictEqual(parsed.entities_count > 0, true);
  assert.strictEqual(parsed.dimensions.length, 1200);
  assert.strictEqual(parsed.dimensions.width, 600);
  assert.strictEqual(parsed.dimensions.thickness, 30);
  assert.strictEqual(parsed.meta.dimensionSource, 'DIMENSION');

  const inchesParsed = parseDxfFile(inches);
  assert.strictEqual(inchesParsed.meta.convertedFromInches, true);
  assert.strictEqual(inchesParsed.dimensions.length, 254);
  assert.strictEqual(inchesParsed.dimensions.width, 101.6);

  const bboxOnly = makeTempDxf('bbox-only', [
    '0','SECTION','2','HEADER','9','$INSUNITS','70','4','0','ENDSEC',
    '0','SECTION','2','ENTITIES',
    '0','LINE','8','A','10','0','20','0','11','400','21','0',
    '0','LINE','8','A','10','0','20','0','11','0','21','50',
    '0','ENDSEC','0','EOF'
  ].join('\n'));
  const bboxParsed = parseDxfFile(bboxOnly);
  assert.strictEqual(bboxParsed.meta.dimensionSource, 'bbox');
  assert.strictEqual(bboxParsed.dimensions.length, 400);
  assert.strictEqual(bboxParsed.dimensions.width, 50);

  const priority = makeTempDxf('priority-20mm', [
    '0','SECTION','2','ENTITIES',
    '0','LINE','8','T45','10','0','20','0','11','100','21','0',
    '0','LINE','8','T45','10','0','20','0','11','0','21','10',
    '0','TEXT','8','TXT','1','Толщина 30мм',
    '0','ENDSEC','0','EOF'
  ].join('\n'));

  const p1 = parseDxfFile(priority, { thickness: 20 });
  assert.strictEqual(p1.dimensions.thickness, 20);
  assert.strictEqual(p1.meta.thicknessSource, 'options.thickness');

  const p2 = parseDxfFile(priority);
  assert.strictEqual(p2.dimensions.thickness, 20);
  assert.strictEqual(p2.meta.thicknessSource, 'filename');

  const noThickness = makeTempDxf('nothk', [
    '0','SECTION','2','ENTITIES',
    '0','LINE','8','A','10','0','20','0','11','80','21','0',
    '0','LINE','8','A','10','0','20','0','11','0','21','10',
    '0','ENDSEC','0','EOF'
  ].join('\n'));
  const noThkParsed = parseDxfFile(noThickness);
  assert.strictEqual(noThkParsed.dimensions.thickness, null);

  const bad = makeTempDxf('bad', 'hello world');
  assert.throws(() => parseDxfFile(bad), /Невалидный DXF/);

  console.log('dxf-import test passed');
})();
