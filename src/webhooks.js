'use strict';

const crypto = require('crypto');
const { logger } = require('./logger');
const AbortControllerImpl = globalThis.AbortController;

const WEBHOOK_EVENTS = new Set([
  'generation.complete',
  'generation.error',
  'batch.complete',
  'health.check'
]);

const RETRY_DELAYS_MS = [1000, 4000, 16000];
const REQUEST_TIMEOUT_MS = 10_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return Number(status) >= 500;
}

function shouldRetryError(error) {
  return error && error.name === 'AbortError';
}

function buildSignature(secret, body) {
  if (!secret) return null;
  const digest = crypto.createHmac('sha256', String(secret)).update(body).digest('hex');
  // Unified signature format: "sha256=<hex_digest>"
  return `sha256=${digest}`;
}

function normalizeSubscriptions(config) {
  const source = config && Array.isArray(config.webhooks) ? config.webhooks : [];
  return source
    .filter((item) => item && item.enabled !== false && item.url)
    .map((item) => ({
      id: item.id != null ? Number(item.id) : null,
      url: String(item.url).trim(),
      events: Array.isArray(item.events) ? item.events.map((event) => String(event)) : [],
      secret: item.secret ? String(item.secret) : null,
      enabled: item.enabled !== false
    }));
}

function supportsEvent(subscription, event) {
  return subscription.events.length === 0 || subscription.events.includes(event);
}

async function postWithRetry(subscription, body) {
  const signature = buildSignature(subscription.secret, body);
  let attempt = 0;

  while (attempt <= RETRY_DELAYS_MS.length) {
    const controller = AbortControllerImpl ? new AbortControllerImpl() : null;
    const timeout = setTimeout(() => {
      if (controller) controller.abort();
    }, REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(subscription.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(signature ? { 'X-TKG-Signature': signature } : {})
        },
        body,
        signal: controller ? controller.signal : undefined
      });
      clearTimeout(timeout);

      if (response.ok) {
        return { ok: true, status: response.status, attempt: attempt + 1 };
      }

      if (response.status >= 400 && response.status < 500) {
        return { ok: false, status: response.status, attempt: attempt + 1, retryable: false };
      }

      if (!isRetryableStatus(response.status) || attempt === RETRY_DELAYS_MS.length) {
        return { ok: false, status: response.status, attempt: attempt + 1, retryable: true };
      }
    } catch (error) {
      clearTimeout(timeout);
      const isRetryableError = shouldRetryError(error) || error instanceof TypeError;
      if (!isRetryableError || attempt === RETRY_DELAYS_MS.length) {
        return { ok: false, attempt: attempt + 1, retryable: isRetryableError, error: error.message };
      }
    }

    await sleep(RETRY_DELAYS_MS[attempt]);
    attempt += 1;
  }

  return { ok: false, attempt: RETRY_DELAYS_MS.length + 1, retryable: true };
}

async function sendWebhook(event, payload, config = {}) {
  if (!WEBHOOK_EVENTS.has(event)) {
    throw new Error(`Unsupported webhook event: ${event}`);
  }

  const subscriptions = normalizeSubscriptions(config).filter((subscription) => supportsEvent(subscription, event));
  if (subscriptions.length === 0) return [];

  const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
  const results = [];
  for (const subscription of subscriptions) {
    const result = await postWithRetry(subscription, body);
    if (!result.ok) {
      logger.warn({ event, url: subscription.url, result }, 'Webhook delivery failed');
    }
    results.push({ id: subscription.id, url: subscription.url, ...result });
  }

  return results;
}

module.exports = {
  WEBHOOK_EVENTS,
  sendWebhook,
  buildSignature,
  RETRY_DELAYS_MS,
  REQUEST_TIMEOUT_MS
};
