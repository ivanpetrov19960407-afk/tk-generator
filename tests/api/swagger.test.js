#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { createApp } = require('../../src/server/index');

function validateOpenApi3Spec(spec) {
  assert.ok(spec && typeof spec === 'object', 'spec should be an object');
  assert.strictEqual(spec.openapi, '3.0.0', 'spec.openapi should be 3.0.0');
  assert.ok(spec.info && typeof spec.info.title === 'string' && typeof spec.info.version === 'string', 'spec.info should contain title and version');
  assert.ok(spec.paths && typeof spec.paths === 'object', 'spec.paths should exist');
  assert.ok(spec.components && spec.components.schemas, 'spec.components.schemas should exist');

  const requiredSchemas = ['Product', 'BatchInput', 'GenerationResult', 'HistoryEntry', 'Error'];
  for (const schemaName of requiredSchemas) {
    assert.ok(spec.components.schemas[schemaName], `schema should exist: ${schemaName}`);
  }

  const requiredOperations = [
    ['/api/generate', 'post'],
    ['/api/validate', 'post'],
    ['/api/history', 'get'],
    ['/api/auth/login', 'post'],
    ['/api/auth/register', 'post'],
    ['/api/auth/me', 'get']
  ];

  for (const [pathName, method] of requiredOperations) {
    assert.ok(spec.paths[pathName], `path should exist: ${pathName}`);
    assert.ok(spec.paths[pathName][method], `${method.toUpperCase()} operation should exist for ${pathName}`);
  }
}

(async () => {
  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await fetch(`${base}/api/docs/spec.json`);
    assert.strictEqual(response.status, 200, 'spec endpoint should return HTTP 200');

    const spec = await response.json();
    validateOpenApi3Spec(spec);

    console.log('swagger.api test passed');
  } finally {
    server.close();
  }
})();
