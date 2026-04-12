#!/usr/bin/env node
'use strict';

const assert = require('assert');
const http = require('http');
const crypto = require('crypto');

const { sendWebhook, buildSignature } = require('../src/webhooks');

function createServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`
      });
    });
  });
}

(async () => {
  let receivedBody = null;
  let receivedSignature = null;
  const okServer = await createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      receivedBody = Buffer.concat(chunks).toString('utf8');
      receivedSignature = req.headers['x-tkg-signature'] || null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });

  try {
    const secret = 'top-secret';
    const result = await sendWebhook('generation.complete', { id: 1 }, {
      webhooks: [{ url: `${okServer.baseUrl}/hook`, events: ['generation.complete'], secret, enabled: true }]
    });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].ok, true);

    const expectedSignature = `sha256=${crypto.createHmac('sha256', secret).update(receivedBody).digest('hex')}`;
    assert.strictEqual(receivedSignature, expectedSignature, 'signature must be sha256=<hex>');
    assert.strictEqual(buildSignature(secret, receivedBody), expectedSignature);
  } finally {
    okServer.server.close();
  }

  let retryAttempts = 0;
  const retryServer = await createServer((_req, res) => {
    retryAttempts += 1;
    if (retryAttempts < 3) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{"error":"temporary"}');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });

  try {
    const result = await sendWebhook('batch.complete', { id: 2 }, {
      webhooks: [{ url: `${retryServer.baseUrl}/retry`, events: ['batch.complete'], enabled: true }]
    });
    assert.strictEqual(result[0].ok, true, '5xx should retry and eventually succeed');
    assert.strictEqual(retryAttempts, 3, 'expected retry attempts for 5xx');
  } finally {
    retryServer.server.close();
  }

  let noRetryAttempts = 0;
  const noRetryServer = await createServer((_req, res) => {
    noRetryAttempts += 1;
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end('{"error":"bad"}');
  });

  try {
    const result = await sendWebhook('generation.error', { id: 3 }, {
      webhooks: [{ url: `${noRetryServer.baseUrl}/noretry`, events: ['generation.error'], enabled: true }]
    });
    assert.strictEqual(result[0].ok, false);
    assert.strictEqual(noRetryAttempts, 1, '4xx should not retry');
  } finally {
    noRetryServer.server.close();
  }

  let filteredCalls = 0;
  const filteredServer = await createServer((_req, res) => {
    filteredCalls += 1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });

  try {
    const result = await sendWebhook('health.check', { ping: true }, {
      webhooks: [{ url: `${filteredServer.baseUrl}/filtered`, events: ['batch.complete'], enabled: true }]
    });
    assert.strictEqual(result.length, 0, 'event filter should skip non-matching subscriptions');
    assert.strictEqual(filteredCalls, 0, 'request should not be sent for filtered events');
  } finally {
    filteredServer.server.close();
  }

  console.log('webhooks.test.js passed');
})();
