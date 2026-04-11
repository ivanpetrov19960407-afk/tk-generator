#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createApp } = require('../../src/server/index');

(async () => {
  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const form = new FormData();
    const sample = path.resolve(__dirname, '../fixtures/sample.dxf');
    form.append('file', new Blob([fs.readFileSync(sample)]), 'sample.dxf');

    const okRes = await fetch(`${base}/api/import-dxf`, { method: 'POST', body: form });
    const okBody = await okRes.json();
    assert.strictEqual(okRes.status, 200);
    assert.strictEqual(okBody.ok, true);
    assert.strictEqual(okBody.data.dimensions.length, 1200);

    const badForm = new FormData();
    badForm.append('file', new Blob([Buffer.from('bad')]), 'broken.txt');
    const badExt = await fetch(`${base}/api/import-dxf`, { method: 'POST', body: badForm });
    assert.strictEqual(badExt.status, 400);

    const invalidForm = new FormData();
    invalidForm.append('file', new Blob([Buffer.from('broken content')]), 'broken.dxf');
    const invalidRes = await fetch(`${base}/api/import-dxf`, { method: 'POST', body: invalidForm });
    assert.strictEqual(invalidRes.status, 400);

    console.log('import-dxf.api test passed');
  } finally {
    server.close();
  }
})();
