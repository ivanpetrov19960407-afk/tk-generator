#!/usr/bin/env node
'use strict';

const { validateProduct } = require('../src/generator');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function baseProduct(texture) {
  return {
    tk_number: 99,
    name: 'Плита тестовая',
    dimensions: { length: 600, width: 600, thickness: 20 },
    material: { type: 'мрамор', name: 'TestStone', density: 2700 },
    texture,
    quantity: '10 шт',
    quantity_pieces: 10
  };
}

console.log('\n=== ТЕСТЫ ВАЛИДАЦИИ ФАКТУР ===');

{
  const errors = validateProduct(baseProduct('лощение'));
  assert(errors.length === 0, 'texture="лощение" проходит валидацию (регрессия)');
}

{
  const errors = validateProduct(baseProduct('полировка'));
  assert(errors.some(e => e.includes('Неизвестная фактура: "полировка"')), 'texture="полировка" отклоняется валидатором');
  assert(errors.some(e => e.includes('лощение, рельефная_матовая, бучардирование_лощение')), 'ошибка для "полировка" содержит список допустимых фактур');
}

{
  const errors = validateProduct(baseProduct('unknown_texture'));
  assert(errors.some(e => e.includes('Неизвестная фактура: "unknown_texture"')), 'texture="unknown_texture" даёт раннюю ошибку валидации');
}

console.log('\n' + '='.repeat(50));
console.log(`Результат: ${passed} пройдено, ${failed} провалено`);
console.log('='.repeat(50));

if (failed > 0) process.exit(1);
