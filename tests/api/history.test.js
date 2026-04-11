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
          tk_number: 77,
          name: 'Плита история',
          short_name: 'plita_istoria',
          dimensions: { length: 600, width: 300, thickness: 20 },
          material: { type: 'мрамор', name: 'Crema Nova', density: 2700 },
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
    assert.strictEqual(generateRes.status, 200, 'expected successful generation before reading history');

    const listRes = await fetch(`${base}/api/history?page=1&pageSize=5`);
    assert.strictEqual(listRes.status, 200, 'history list should be 200');
    const listBody = await listRes.json();
    assert.ok(Array.isArray(listBody.items), 'history list should contain items array');
    assert.ok(listBody.items.length > 0, 'history list should contain at least one row');

    const id = listBody.items[0].id;
    const detailRes = await fetch(`${base}/api/history/${id}`);
    assert.strictEqual(detailRes.status, 200, 'history detail should be 200');
    const detailBody = await detailRes.json();
    assert.strictEqual(detailBody.id, id, 'detail id should match request id');
    assert.ok(Array.isArray(detailBody.items), 'detail should include generation items');

    const exportRes = await fetch(`${base}/api/export/csv?generation_id=${id}`);
    assert.strictEqual(exportRes.status, 200, 'csv export should be 200');
    assert.strictEqual(exportRes.headers.get('content-type'), 'text/csv; charset=utf-8', 'csv export should return text/csv');
    assert.ok((exportRes.headers.get('content-disposition') || '').includes(`generation_${id}_export.csv`), 'csv export should return attachment filename');
    const exportBuffer = Buffer.from(await exportRes.arrayBuffer());
    assert.strictEqual(exportBuffer[0], 0xEF, 'csv export should start with BOM byte 0xEF');
    assert.strictEqual(exportBuffer[1], 0xBB, 'csv export should start with BOM byte 0xBB');
    assert.strictEqual(exportBuffer[2], 0xBF, 'csv export should start with BOM byte 0xBF');
    const exportText = exportBuffer.toString('utf8');
    assert.ok(exportText.includes('generation_id;position;product_name;material;texture;total_cost;status;error_message'), 'csv export should contain expected header');

    console.log('history.api test passed');
  } finally {
    server.close();
  }
})();
