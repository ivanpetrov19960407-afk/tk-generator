#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildOperations } = require('../src/operations');
const { loadOverridesFile } = require('../src/utils/overrides-loader');

fs.mkdirSync(path.resolve(process.cwd(), 'overrides'), { recursive: true });

function makeProduct(extra = {}) {
  return {
    tk_number: 1,
    name: 'Плита облицовочная',
    short_name: 'plita',
    dimensions: { length: 600, width: 300, thickness: 20 },
    material: { type: 'мрамор', name: 'Delikato light', density: 2700 },
    texture: 'бучардирование_лощение',
    quantity: '10 м²',
    quantity_pieces: 56,
    edges: 'калибровка по всем сторонам',
    ...extra
  };
}

(function testOverridesApplyReplaceAndDropAndPriority() {
  const dir = fs.mkdtempSync(path.join(path.resolve(process.cwd(), 'overrides'), 'tk-overrides-'));
  const filePath = path.join(dir, 'overrides.json');

  fs.writeFileSync(filePath, JSON.stringify({
    version: 1,
    rules: [
      {
        match: { texture: 'бучардирование_лощение' },
        patch: {
          drop_operations: [29],
          replace_fields: {
            10: {
              name: 'Уточнённая операция 10 (из overrides)',
              comment: 'переопределено overrides'
            }
          }
        }
      }
    ]
  }, null, 2), 'utf8');

  const { operations } = buildOperations(makeProduct({
    overrides_path: filePath,
    operation_overrides: {
      replace_fields: {
        10: { title: 'Ручная правка 10 (product)', text: 'ручная правка в product' }
      }
    }
  }));

  const op10 = operations.find((op) => op.number === 10);
  assert(op10, 'операция 10 должна существовать');
  assert.strictEqual(op10.title, 'Ручная правка 10 (product)');
  assert.strictEqual(op10.text, 'ручная правка в product');

  const op29 = operations.find((op) => op.number === 29);
  assert.strictEqual(op29, undefined, 'операция 29 должна быть удалена override-ом');
})();

(function testInvalidJsonErrorContainsPath() {
  const dir = fs.mkdtempSync(path.join(path.resolve(process.cwd(), 'overrides'), 'tk-overrides-invalid-'));
  const filePath = path.join(dir, 'broken.json');
  fs.writeFileSync(filePath, '{"version": 1,', 'utf8');

  assert.throws(
    () => loadOverridesFile(filePath),
    (err) => err.message.includes('Некорректный JSON') && err.message.includes(filePath)
  );
})();

(function testUnknownOperationWarning() {
  const dir = fs.mkdtempSync(path.join(path.resolve(process.cwd(), 'overrides'), 'tk-overrides-warn-'));
  const filePath = path.join(dir, 'warn.json');

  fs.writeFileSync(filePath, JSON.stringify({
    version: 1,
    rules: [
      {
        match: { texture: 'бучардирование_лощение' },
        patch: {
          drop_operations: [999],
          replace_fields: {
            999: { title: 'несуществующая' }
          }
        }
      }
    ]
  }, null, 2), 'utf8');

  const { warnings } = buildOperations(makeProduct({ overrides_path: filePath }));
  assert(warnings.some((w) => w.includes('операция №999 не найдена')), 'должно быть предупреждение по несуществующей операции');
})();

console.log('overrides-loader tests passed');
