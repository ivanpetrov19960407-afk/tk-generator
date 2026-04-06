#!/usr/bin/env node
'use strict';

/**
 * Smoke-тесты нормализации единиц измерения.
 *
 * Запуск: node tests/unit-normalizer.test.js
 *
 * 3 основных теста:
 *   1. Штучные позиции (шт)
 *   2. Площадные позиции (кв.м / м²)
 *   3. Погонные позиции (пог.м / м.п.)
 * + дополнительно: unknown, sanity-проверки, price deviation
 */

const { normalizeUnit, validateUnitConsistency, checkPriceDeviation } = require('../src/utils/unit-normalizer');

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

function assertEq(actual, expected, message) {
  assert(
    actual === expected,
    `${message} (ожидалось: "${expected}", получено: "${actual}")`
  );
}

// ============================================================
// ТЕСТ 1: Штучные позиции
// ============================================================
console.log('\n=== ТЕСТ 1: Штучные позиции ===');
{
  const variants = ['шт', 'шт.', 'штук', 'штука', 'штуки', 'pcs', 'ШТ', 'Шт.'];
  for (const v of variants) {
    const { unit, measurement_type } = normalizeUnit(v);
    assertEq(unit, 'шт', `normalizeUnit("${v}").unit`);
    assertEq(measurement_type, 'count', `normalizeUnit("${v}").measurement_type`);
  }
}

// ============================================================
// ТЕСТ 2: Площадные позиции (кв.м / м²)
// ============================================================
console.log('\n=== ТЕСТ 2: Площадные позиции ===');
{
  const variants = [
    'м²', 'м2', 'кв.м.', 'кв.м', 'кв. м.', 'кв. м',
    'м.кв.', 'м.кв', 'м кв', 'кв м', 'квм', 'sqm',
    'КВ.М.', 'М²', 'Кв. м.'
  ];
  for (const v of variants) {
    const { unit, measurement_type } = normalizeUnit(v);
    assertEq(unit, 'м²', `normalizeUnit("${v}").unit`);
    assertEq(measurement_type, 'area', `normalizeUnit("${v}").measurement_type`);
  }
}

// ============================================================
// ТЕСТ 3: Погонные позиции (пог.м / м.п.)
// ============================================================
console.log('\n=== ТЕСТ 3: Погонные позиции ===');
{
  const variants = [
    'м.п.', 'м.п', 'мп', 'м п',
    'пог.м.', 'пог.м', 'пог м', 'погм',
    'м.пог.', 'м.пог', 'м пог',
    'п.м.', 'п.м', 'пм',
    'М.П.', 'ПОГ.М.'
  ];
  for (const v of variants) {
    const { unit, measurement_type } = normalizeUnit(v);
    assertEq(unit, 'м.п.', `normalizeUnit("${v}").unit`);
    assertEq(measurement_type, 'length', `normalizeUnit("${v}").measurement_type`);
  }
}

// ============================================================
// ТЕСТ 4: Нераспознанные единицы → "unknown" (НЕ "шт"!)
// ============================================================
console.log('\n=== ТЕСТ 4: Нераспознанные единицы → unknown ===');
{
  const variants = ['литр', 'тонна', 'кг', 'xyz', ''];
  for (const v of variants) {
    const { measurement_type } = normalizeUnit(v);
    assertEq(measurement_type, 'unknown', `normalizeUnit("${v}").measurement_type`);
  }

  // null/undefined
  {
    const { unit, measurement_type } = normalizeUnit(null);
    assert(unit === null, 'normalizeUnit(null).unit === null');
    assertEq(measurement_type, 'unknown', 'normalizeUnit(null).measurement_type');
  }
  {
    const { unit, measurement_type } = normalizeUnit(undefined);
    assert(unit === null, 'normalizeUnit(undefined).unit === null');
    assertEq(measurement_type, 'unknown', 'normalizeUnit(undefined).measurement_type');
  }
}

// ============================================================
// ТЕСТ 5: Sanity-проверка validateUnitConsistency
// ============================================================
console.log('\n=== ТЕСТ 5: Sanity-проверка (validateUnitConsistency) ===');
{
  // Корректные сочетания — не должны бросать ошибку
  try {
    validateUnitConsistency('м²', 'area', 'test');
    validateUnitConsistency('м.п.', 'length', 'test');
    validateUnitConsistency('шт', 'count', 'test');
    passed++;
    console.log('  ✓ Корректные сочетания unit/measurement_type не вызывают ошибку');
  } catch (e) {
    failed++;
    console.error(`  ✗ FAIL: корректное сочетание бросило ошибку: ${e.message}`);
  }

  // Некорректное сочетание — должна быть ошибка
  try {
    validateUnitConsistency('шт', 'area', 'test');
    failed++;
    console.error('  ✗ FAIL: validateUnitConsistency("шт", "area") должен бросить ошибку');
  } catch (e) {
    passed++;
    console.log(`  ✓ Некорректное сочетание "шт"/"area" бросает ошибку: ${e.message}`);
  }

  // unknown — предупреждение, но не ошибка
  try {
    validateUnitConsistency('литр', 'unknown', 'test');
    passed++;
    console.log('  ✓ unknown measurement_type не бросает ошибку (только предупреждение)');
  } catch (e) {
    failed++;
    console.error(`  ✗ FAIL: unknown бросил ошибку вместо предупреждения: ${e.message}`);
  }
}

// ============================================================
// ТЕСТ 6: Проверка отклонения цены (checkPriceDeviation)
// ============================================================
console.log('\n=== ТЕСТ 6: Проверка отклонения цены ===');
{
  // Нормальное отклонение
  const ok = checkPriceDeviation(1000, 900, 'шт', 'test');
  assert(ok === true, 'Отклонение 1.1x — в норме');

  // Космическое отклонение (>10x)
  const bad = checkPriceDeviation(100000, 900, 'шт', 'test');
  assert(bad === false, 'Отклонение 111x — обнаружено');

  // Отсутствие контрольной цены — не ошибка
  const noCtrl = checkPriceDeviation(1000, 0, 'шт', 'test');
  assert(noCtrl === true, 'Нет контрольной цены — пропуск проверки');
}

// ============================================================
// РЕЗУЛЬТАТ
// ============================================================
console.log('\n' + '='.repeat(50));
console.log(`Результат: ${passed} пройдено, ${failed} провалено`);
console.log('='.repeat(50));

if (failed > 0) {
  process.exit(1);
}
