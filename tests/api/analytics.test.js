#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { createApp } = require('../../src/server/index');

(async () => {
  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const payload = {
      products: [
        {
          tk_number: 127,
          name: 'Плита аналитика',
          short_name: 'plita_analytics',
          dimensions: { length: 500, width: 300, thickness: 30 },
          material: { type: 'гранит', name: 'Гранит Возрождение', density: 2700 },
          texture: 'лощение',
          quantity_pieces: 1,
          control_unit: 'шт',
          category: '1'
        }
      ]
    };

    const generateRes = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.strictEqual(generateRes.status, 200, 'expected successful generation before analytics');

    const summaryRes = await fetch(`${base}/api/analytics/summary`);
    assert.strictEqual(summaryRes.status, 200, 'analytics summary should be 200');
    const summary = await summaryRes.json();
    assert.ok(summary.total_generations >= 1, 'summary should include generations');
    assert.ok(summary.total_products >= 1, 'summary should include products');
    assert.ok(Number(summary.average_cost) >= 0, 'summary should include average_cost');

    const trendsRes = await fetch(`${base}/api/analytics/cost-trends?groupBy=day`);
    assert.strictEqual(trendsRes.status, 200, 'analytics trends should be 200');
    const trends = await trendsRes.json();
    assert.ok(Array.isArray(trends.items), 'trends should include items array');

    const materialsRes = await fetch(`${base}/api/analytics/materials`);
    assert.strictEqual(materialsRes.status, 200, 'analytics materials should be 200');
    const materials = await materialsRes.json();
    assert.ok(Array.isArray(materials.items), 'materials should include items array');

    const texturesRes = await fetch(`${base}/api/analytics/textures`);
    assert.strictEqual(texturesRes.status, 200, 'analytics textures should be 200');
    const textures = await texturesRes.json();
    assert.ok(Array.isArray(textures.items), 'textures should include items array');

    console.log('analytics.api test passed');
  } finally {
    server.close();
  }
})();
