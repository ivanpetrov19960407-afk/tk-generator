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
    const loginAdminRes = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'adminpass123' })
    });
    assert.strictEqual(loginAdminRes.status, 200);
    const adminBody = await loginAdminRes.json();
    const adminAuth = { Authorization: `Bearer ${adminBody.tokens.accessToken}`, 'Content-Type': 'application/json' };

    const viewerName = `viewer_${crypto.randomBytes(3).toString('hex')}`;
    const registerRes = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: adminAuth,
      body: JSON.stringify({ username: viewerName, password: 'viewerpass123', role: 'viewer' })
    });
    assert.strictEqual(registerRes.status, 201);

    const loginViewerRes = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: viewerName, password: 'viewerpass123' })
    });
    assert.strictEqual(loginViewerRes.status, 200);
    const viewerBody = await loginViewerRes.json();

    const viewerCreateRes = await fetch(`${base}/api/webhooks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${viewerBody.tokens.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://localhost/hook', events: ['batch.complete'], enabled: true })
    });
    assert.strictEqual(viewerCreateRes.status, 403, 'viewer must not access webhook CRUD');

    const createRes = await fetch(`${base}/api/webhooks`, {
      method: 'POST',
      headers: adminAuth,
      body: JSON.stringify({ url: 'http://localhost/hook', events: ['batch.complete'], enabled: true })
    });
    assert.strictEqual(createRes.status, 201);
    const createBody = await createRes.json();
    assert.ok(createBody.webhook && createBody.webhook.id);

    const listRes = await fetch(`${base}/api/webhooks`, { headers: { Authorization: `Bearer ${adminBody.tokens.accessToken}` } });
    assert.strictEqual(listRes.status, 200);
    const listBody = await listRes.json();
    assert.strictEqual(Array.isArray(listBody.items), true);
    assert.strictEqual(listBody.items.length, 1);

    const deleteRes = await fetch(`${base}/api/webhooks/${createBody.webhook.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminBody.tokens.accessToken}` }
    });
    assert.strictEqual(deleteRes.status, 200);

    const listAfterDelete = await fetch(`${base}/api/webhooks`, { headers: { Authorization: `Bearer ${adminBody.tokens.accessToken}` } });
    const afterBody = await listAfterDelete.json();
    assert.strictEqual(afterBody.items.length, 0);

    console.log('webhooks.api test passed');
  } finally {
    server.close();
    delete process.env.TKG_AUTH_ENABLED;
    delete process.env.TKG_AUTH_JWT_SECRET;
    delete process.env.TK_GENERATOR_DB_PATH;
    delete process.env.TKG_AUTH_ADMIN_USERNAME;
    delete process.env.TKG_AUTH_ADMIN_PASSWORD;
  }
})();
