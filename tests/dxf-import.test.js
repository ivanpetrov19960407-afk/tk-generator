#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  parseDxfContent,
  extractFromDimensions,
  extractFromBbox,
  extractDimensions,
  toDimensions,
  parseDxfDimensions
} = require('../src/utils/dxf-import');

// --- Helper: build minimal DXF content ---

function run() {
  console.log('\n=== ТЕСТЫ dxf-import ===');

  // Test 1: DIMENSION entities are preferred over bbox
  {
    const dxf = buildDxfWithDimensionAndLines();
    const result = extractDimensions(dxf);
    assert.strictEqual(result.method, 'DIMENSION',
      'extractDimensions should prefer DIMENSION entities over bbox');
    assert.ok(result.values.length > 0, 'DIMENSION extraction should produce values');
    console.log('  ✓ DIMENSION entities preferred over bbox');
  }

  // Test 2: bbox fallback when no DIMENSION entities
  {
    const dxf = buildDxfWithLinesOnly();
    const result = extractDimensions(dxf);
    assert.strictEqual(result.method, 'bbox',
      'extractDimensions should fallback to bbox when no DIMENSION entities');
    assert.ok(result.values.length > 0, 'bbox extraction should produce values');
    console.log('  ✓ bbox fallback works when no DIMENSION entities');
  }

  // Test 3: empty DXF
  {
    const result = extractDimensions('');
    assert.strictEqual(result.method, null, 'empty content returns null method');
    assert.ok(result.error, 'empty content returns error');
    console.log('  ✓ empty DXF handled correctly');
  }

  // Test 4: parseDxfContent extracts entities
  {
    const dxf = buildDxfWithDimensionAndLines();
    const parsed = parseDxfContent(dxf);
    assert.ok(parsed.entities.length > 0, 'should parse entities from DXF');
    const types = parsed.entities.map((e) => e.type);
    assert.ok(types.includes('DIMENSION'), 'should find DIMENSION entity');
    assert.ok(types.includes('LINE'), 'should find LINE entity');
    console.log('  ✓ parseDxfContent extracts entities correctly');
  }

  // Test 5: toDimensions sorts values correctly
  {
    const dims = toDimensions({ values: [30, 700, 400], method: 'DIMENSION' });
    assert.deepStrictEqual(dims.value, { length: 700, width: 400, thickness: 30 },
      'toDimensions should sort values into length > width > thickness');
    assert.strictEqual(dims.method, 'DIMENSION');
    console.log('  ✓ toDimensions sorts values correctly');
  }

  // Test 6: parseDxfDimensions end-to-end
  {
    const dxf = buildDxfWithDimensionAndLines();
    const result = parseDxfDimensions(dxf);
    assert.ok(result.value, 'parseDxfDimensions should return dimensions');
    assert.strictEqual(result.method, 'DIMENSION');
    assert.strictEqual(result.error, null);
    console.log('  ✓ parseDxfDimensions end-to-end works');
  }

  // Test 7: DIMENSION with text override (group code 1)
  {
    const dxf = buildDxfWithTextDimension();
    const result = extractDimensions(dxf);
    assert.strictEqual(result.method, 'DIMENSION');
    assert.ok(result.values.includes(500), 'should extract dimension from text override');
    console.log('  ✓ DIMENSION text override extraction works');
  }

  // Test 8: DIMENSION with measurement value (group code 42)
  {
    const dxf = buildDxfWithMeasuredDimension();
    const result = extractDimensions(dxf);
    assert.strictEqual(result.method, 'DIMENSION');
    assert.ok(result.values.includes(750), 'should extract dimension from group code 42');
    console.log('  ✓ DIMENSION measurement value extraction works');
  }

  // Test 9: no geometric entities at all
  {
    const dxf = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'TEXT',
      '1', 'Hello',
      '0', 'ENDSEC',
      '0', 'EOF'
    ].join('\n');
    const result = extractDimensions(dxf);
    assert.strictEqual(result.method, null);
    assert.ok(result.error, 'should report error when no geometric entities');
    console.log('  ✓ handles DXF with no geometric entities');
  }

  console.log('\ndxf-import: все тесты пройдены');
}

// --- DXF builders ---

function buildDxfWithDimensionAndLines() {
  return [
    '0', 'SECTION',
    '2', 'ENTITIES',
    // DIMENSION entity with definition points (700mm span)
    '0', 'DIMENSION',
    '13', '0',
    '23', '0',
    '14', '700',
    '24', '0',
    '42', '700',
    // DIMENSION entity with definition points (400mm span)
    '0', 'DIMENSION',
    '13', '0',
    '23', '0',
    '14', '0',
    '24', '400',
    '42', '400',
    // DIMENSION entity with definition points (30mm span)
    '0', 'DIMENSION',
    '13', '0',
    '23', '0',
    '14', '30',
    '24', '0',
    '42', '30',
    // LINE entities (would give bbox, but should be ignored)
    '0', 'LINE',
    '10', '0',
    '20', '0',
    '11', '800',
    '21', '500',
    '0', 'ENDSEC',
    '0', 'EOF'
  ].join('\n');
}

function buildDxfWithLinesOnly() {
  return [
    '0', 'SECTION',
    '2', 'ENTITIES',
    '0', 'LINE',
    '10', '0',
    '20', '0',
    '11', '600',
    '21', '0',
    '0', 'LINE',
    '10', '0',
    '20', '0',
    '11', '0',
    '21', '300',
    '0', 'ENDSEC',
    '0', 'EOF'
  ].join('\n');
}

function buildDxfWithTextDimension() {
  return [
    '0', 'SECTION',
    '2', 'ENTITIES',
    '0', 'DIMENSION',
    '1', '500',
    '13', '0',
    '23', '0',
    '14', '0',
    '24', '0',
    '0', 'ENDSEC',
    '0', 'EOF'
  ].join('\n');
}

function buildDxfWithMeasuredDimension() {
  return [
    '0', 'SECTION',
    '2', 'ENTITIES',
    '0', 'DIMENSION',
    '42', '750',
    '13', '0',
    '23', '0',
    '14', '100',
    '24', '0',
    '0', 'ENDSEC',
    '0', 'EOF'
  ].join('\n');
}

run();
