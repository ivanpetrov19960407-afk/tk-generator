'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { validateBatchInput, validateProduct } = require('../src/validation/validator');

const batchInput = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'examples', 'batch_input.json'), 'utf8'));

function run() {
  // Positive: example passes
  const okReport = validateBatchInput(batchInput, { unknownUnitPolicy: 'warning' });
  assert.strictEqual(okReport.valid, true, 'examples/batch_input.json должен проходить валидацию');
  assert.strictEqual(okReport.errors.length, 0, 'В позитивном примере не ожидаются ошибки');

  // Negative: thickness = 0 => error
  const p1 = JSON.parse(JSON.stringify(batchInput.products[0]));
  p1.dimensions.thickness = 0;
  const r1 = validateProduct(p1, { unknownUnitPolicy: 'warning' });
  assert.strictEqual(r1.valid, false, 'thickness=0 должен быть ошибкой');
  assert.ok(r1.errors.some((e) => e.includes('dimensions/thickness')),
    'Ошибка должна указывать на dimensions.thickness');

  // Negative: quantity_pieces < 0 => error
  const p2 = JSON.parse(JSON.stringify(batchInput.products[0]));
  p2.quantity_pieces = -5;
  const r2 = validateProduct(p2, { unknownUnitPolicy: 'warning' });
  assert.strictEqual(r2.valid, false, 'quantity_pieces=-5 должен быть ошибкой');
  assert.ok(r2.errors.some((e) => e.includes('quantity_pieces')),
    'Ошибка должна указывать на quantity_pieces');

  // Unknown unit policy fixed: warning by default, error by policy
  const p3 = JSON.parse(JSON.stringify(batchInput.products[0]));
  p3.control_unit = 'шт/';
  const r3warn = validateProduct(p3, { unknownUnitPolicy: 'warning' });
  assert.strictEqual(r3warn.valid, true, 'unknown unit в режиме warning не должен падать ошибкой');
  assert.ok(r3warn.warnings.some((w) => w.includes('control_unit="шт/"')),
    'Должно быть предупреждение для неизвестной единицы');

  const r3err = validateProduct(p3, { unknownUnitPolicy: 'error' });
  assert.strictEqual(r3err.valid, false, 'unknown unit в режиме error должен быть ошибкой');
  assert.ok(r3err.errors.some((e) => e.includes('control_unit="шт/"')),
    'Должна быть ошибка для неизвестной единицы при policy=error');

  console.log('validation.test.js passed');
}

run();
