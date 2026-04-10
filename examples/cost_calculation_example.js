#!/usr/bin/env node
'use strict';

const productsFile = require('./batch_input.json');
const { calculateTotalCost } = require('../src/cost-calculator');

const products = productsFile.products || [];
const firstProduct = products[0];

if (!firstProduct) {
  console.error('[COST] В examples/batch_input.json нет изделий для расчёта');
  process.exit(1);
}

const estimate = calculateTotalCost(firstProduct);
console.log(JSON.stringify(estimate, null, 2));
