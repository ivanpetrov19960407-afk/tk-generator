#!/usr/bin/env node
'use strict';

const assert = require('assert');
const JSZip = require('jszip');
const { createApp } = require('../../src/server/index');

(async () => {
  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const payload = {
      products: [
        {
          tk_number: 1,
          name: 'Плита тестовая',
          short_name: 'plita_test',
          dimensions: { length: 600, width: 300, thickness: 20 },
          material: { type: 'мрамор', name: 'Crema Nova', density: 2700 },
          texture: 'лощение',
          quantity_pieces: 1,
          control_unit: 'шт',
          category: '1'
        }
      ]
    };

    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.strictEqual(res.status, 200, 'generate: expected HTTP 200');
    const contentType = res.headers.get('content-type') || '';
    assert.ok(contentType.includes('application/zip'), 'generate: expected ZIP response');

    const zipBuffer = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(zipBuffer);
    const names = Object.keys(zip.files);

    assert.ok(names.some((n) => n.endsWith('.docx')), 'generate: zip should contain DOCX');
    assert.ok(names.some((n) => n.endsWith('.xlsx')), 'generate: zip should contain XLSX');

    console.log('generate.api test passed');
  } finally {
    server.close();
  }
})();
