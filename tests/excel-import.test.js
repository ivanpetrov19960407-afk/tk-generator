#!/usr/bin/env node
'use strict';

const {
  parseDimensions,
  resolveExcelMapping,
  validateRequiredColumns
} = require('../src/utils/excel-import');
const { normalizeUnit } = require('../src/utils/unit-normalizer');

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

console.log('\n=== ТЕСТЫ excel-import ===');

{
  const res = parseDimensions('70070030');
  assert(!res.value, 'Размеры без разделителей не парсятся');
  assert(res.error.includes('не содержит разделителей'), 'Есть понятное сообщение об ошибке формата размеров');
}

{
  const ok = parseDimensions('700x700x30 мм');
  assert(Boolean(ok.value), 'Размеры с x корректно парсятся');
  assert(ok.value.length === 700 && ok.value.width === 700 && ok.value.thickness === 30, 'Размеры нормализуются в length/width/thickness');
}

{
  const unit = normalizeUnit('м2 ');
  assert(unit.unit === 'м²' && unit.measurement_type === 'area', 'Единица "м2 " нормализуется корректно');
}

{
  const header = ['№', 'Наименование изделия', 'Фактура', 'Ед. изм.', 'Кол-во'];
  const mapping = resolveExcelMapping(header, null);
  const validation = validateRequiredColumns(mapping);
  assert(!validation.ok, 'Отсутствие колонки размеров считается ошибкой');
  assert(validation.missing.includes('dimensions'), 'В missing присутствует dimensions');
}

console.log(`\nРезультат: ${passed} пройдено, ${failed} провалено`);
if (failed > 0) process.exit(1);
