#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { initDb } = require('../../src/db');
const { createRepository } = require('../../src/db/repository');

(() => {
  const db = initDb({ dbPath: ':memory:' });
  const repository = createRepository(db);

  const generationId = repository.saveGeneration({
    timestamp: '2026-04-10T00:00:00.000Z',
    input_file: 'examples/batch_small.json',
    products_count: 2,
    success_count: 1,
    error_count: 1,
    duration_ms: 350,
    output_dir: 'output/'
  });

  assert.ok(generationId > 0, 'saveGeneration should return id');

  repository.saveGenerationItem({
    generation_id: generationId,
    position: 1,
    product_name: 'Изделие 1',
    material: 'Crema Nova',
    texture: 'лощение',
    status: 'success',
    output_files: ['output/TK_01_test.docx']
  });

  repository.saveGenerationItem({
    generation_id: generationId,
    position: 2,
    product_name: 'Изделие 2',
    material: 'Black Galaxy',
    texture: 'бучардирование_лощение',
    status: 'error',
    error_message: 'Ошибка валидации',
    output_files: []
  });

  const page = repository.getGenerations({ page: 1, pageSize: 10 });
  assert.strictEqual(page.items.length, 1, 'expected one generation in history');
  assert.strictEqual(page.items[0].id, generationId, 'expected generation id in list');

  const detail = repository.getGenerationById(generationId);
  assert.ok(detail, 'expected generation detail');
  assert.strictEqual(detail.items.length, 2, 'expected two detail items');
  assert.deepStrictEqual(detail.items[0].output_files, ['output/TK_01_test.docx']);

  const stats = repository.getStats({ from: '2026-04-01T00:00:00.000Z', to: '2026-04-30T23:59:59.999Z' });
  assert.strictEqual(stats.total_generations, 1, 'expected one generation in stats range');
  assert.strictEqual(stats.total_products, 2, 'expected total products sum in stats');
  assert.strictEqual(stats.total_errors, 1, 'expected total errors sum in stats');

  console.log('repository.db test passed');
})();
