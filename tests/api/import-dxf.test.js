#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { createApp } = require('../../src/server/index');

(async () => {
  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // Test 1: DXF with DIMENSION entities
    {
      const dxf = [
        '0', 'SECTION', '2', 'ENTITIES',
        '0', 'DIMENSION', '42', '700', '13', '0', '23', '0', '14', '700', '24', '0',
        '0', 'DIMENSION', '42', '400', '13', '0', '23', '0', '14', '0', '24', '400',
        '0', 'DIMENSION', '42', '30', '13', '0', '23', '0', '14', '30', '24', '0',
        '0', 'ENDSEC', '0', 'EOF'
      ].join('\n');

      const res = await fetch(`${base}/api/import-dxf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: dxf
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200, 'import-dxf: expected 200 for valid DXF');
      assert.strictEqual(body.method, 'DIMENSION', 'import-dxf: should use DIMENSION method');
      assert.deepStrictEqual(body.dimensions, { length: 700, width: 400, thickness: 30 },
        'import-dxf: dimensions should match');
    }

    // Test 2: empty DXF
    {
      const res = await fetch(`${base}/api/import-dxf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: ''
      });
      const body = await res.json();
      assert.strictEqual(res.status, 400, 'import-dxf: expected 400 for empty DXF');
      assert.ok(body.error, 'import-dxf: should return error for empty DXF');
    }

    // Test 3: DXF with only lines (bbox fallback)
    {
      const dxf = [
        '0', 'SECTION', '2', 'ENTITIES',
        '0', 'LINE', '10', '0', '20', '0', '11', '600', '21', '300',
        '0', 'ENDSEC', '0', 'EOF'
      ].join('\n');

      const res = await fetch(`${base}/api/import-dxf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: dxf
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200, 'import-dxf: expected 200 for bbox DXF');
      assert.strictEqual(body.method, 'bbox', 'import-dxf: should use bbox method for lines-only');
    }

    console.log('import-dxf.api test passed');
  } finally {
    server.close();
  }
})();
