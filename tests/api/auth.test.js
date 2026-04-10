#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { createApp } = require('../../src/server/index');

(async () => {
  process.env.TKG_AUTH_ENABLED = 'true';
  process.env.TKG_AUTH_JWT_SECRET = 'test-secret-very-strong-123';
  process.env.TK_GENERATOR_DB_PATH = ':memory:';
  process.env.TKG_AUTH_ADMIN_USERNAME = 'admin';
  process.env.TKG_AUTH_ADMIN_PASSWORD = 'adminpass123';

  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const meNoAuth = await fetch(`${base}/api/auth/me`);
    assert.strictEqual(meNoAuth.status, 401, 'me should require auth');

    const loginRes = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'adminpass123' })
    });
    assert.strictEqual(loginRes.status, 200, 'login should succeed for bootstrap admin');
    const loginBody = await loginRes.json();
    assert.ok(loginBody.tokens && loginBody.tokens.accessToken, 'access token should exist');

    const authz = { Authorization: `Bearer ${loginBody.tokens.accessToken}`, 'Content-Type': 'application/json' };

    const registerRes = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: authz,
      body: JSON.stringify({ username: `viewer_${crypto.randomBytes(3).toString('hex')}`, password: 'viewerpass123', role: 'viewer' })
    });
    assert.strictEqual(registerRes.status, 201, 'admin should register users');

    const meRes = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${loginBody.tokens.accessToken}` } });
    assert.strictEqual(meRes.status, 200, 'me should return current user');
    const meBody = await meRes.json();
    assert.strictEqual(meBody.user.role, 'admin', 'bootstrap role should be admin');

    console.log('auth.api test passed');
  } finally {
    server.close();
    delete process.env.TKG_AUTH_ENABLED;
    delete process.env.TKG_AUTH_JWT_SECRET;
    delete process.env.TK_GENERATOR_DB_PATH;
    delete process.env.TKG_AUTH_ADMIN_USERNAME;
    delete process.env.TKG_AUTH_ADMIN_PASSWORD;
  }
})();
