#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { createApp } = require('../../src/server/index');

(async () => {
  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const validPayload = {
      products: [
        {
          name: 'Тестовая ступень',
          dimensions: { length: 700, width: 300, thickness: 30 },
          material: { type: 'мрамор', name: 'Crema Nova', density: 2700 },
          texture: 'лощение'
        }
      ]
    };

    const okRes = await fetch(`${base}/api/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload)
    });
    const okBody = await okRes.json();
    assert.strictEqual(okRes.status, 200, 'validate: expected HTTP 200 for valid payload');
    assert.strictEqual(okBody.valid, true, 'validate: expected valid=true for valid payload');

    const badRes = await fetch(`${base}/api/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ products: [{ name: 'broken' }] })
    });
    const badBody = await badRes.json();
    assert.strictEqual(badRes.status, 200, 'validate: expected HTTP 200 for invalid product validation report');
    assert.strictEqual(badBody.valid, false, 'validate: expected valid=false for invalid payload');
    assert.ok(Array.isArray(badBody.errors) && badBody.errors.length > 0, 'validate: expected validation errors');

    console.log('validate.api test passed');
  } finally {
    server.close();
  }
})();
