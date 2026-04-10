#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  calculateCostByOperation,
  calculateTotalCost,
  calculateMarkup,
  calculateControlPrice
} = require('../src/cost-calculator');

const batch = require('../examples/batch_input.json');
const product = batch.products[0];

(function testOperationCost() {
  const op = calculateCostByOperation(product, 1);
  assert.strictEqual(op.operation_number, 1);
  assert(op.total_operation_cost > 0, 'operation total cost should be > 0');
})();

(function testTotalCost() {
  const total = calculateTotalCost(product);
  assert(total.operations_cost.length > 0, 'operations should not be empty');
  assert(total.total_direct_cost > 0, 'total direct cost should be > 0');
  assert.strictEqual(
    Number((total.total_direct_cost + total.overhead_cost).toFixed(2)),
    Number(total.total_cost.toFixed(2)),
    'total cost must include overhead'
  );
})();

(function testMarkupAndControlPrice() {
  const m = calculateMarkup(1000, 30);
  assert.strictEqual(m.markup_amount, 300);
  assert.strictEqual(m.selling_price, 1300);

  const c = calculateControlPrice(1000, 1.25);
  assert.strictEqual(c, 1250);
})();

(function testEdgeCaseWithZeroNorms() {
  const zeroNormProduct = {
    ...product,
    rkm: {
      norms_override: {
        1: { chel_ch: 0, mash_ch: 0 }
      }
    }
  };

  const op = calculateCostByOperation(zeroNormProduct, 1);
  assert.strictEqual(op.labor_hours, 0);
  assert.strictEqual(op.machine_hours, 0);
  assert(op.total_operation_cost >= 0);
})();

(function testInvalidNorms() {
  const invalid = {
    ...product,
    rkm: {
      norms_override: {
        1: { chel_ch: -1, mash_ch: 1 }
      }
    }
  };

  assert.throws(() => calculateCostByOperation(invalid, 1), /Некорректные трудозатраты/);
})();

console.log('cost-calculator tests passed');
