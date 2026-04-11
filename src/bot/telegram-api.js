'use strict';

const RETRYABLE_NETWORK_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorCode(error) {
  return (error && error.code) || (error && error.cause && error.cause.code) || null;
}

function getTelegramStatus(error) {
  return (error && error.response && error.response.error_code)
    || (error && error.statusCode)
    || null;
}

function getRetryAfterMs(error) {
  const retryAfter = error
    && error.response
    && error.response.parameters
    && error.response.parameters.retry_after;
  if (!Number.isFinite(Number(retryAfter))) return null;
  return Number(retryAfter) * 1000;
}

function isAuthFailure(error) {
  const status = getTelegramStatus(error);
  if (status === 401) return true;
  const description = String(error && error.description ? error.description : '').toLowerCase();
  return description.includes('unauthorized') || description.includes('invalid token');
}

function isTransientTelegramError(error) {
  const status = getTelegramStatus(error);
  return Number.isFinite(status) && status >= 500 && status < 600;
}

function isTransientNetworkError(error) {
  return RETRYABLE_NETWORK_CODES.has(getErrorCode(error));
}

function isRetryableError(error) {
  if (isAuthFailure(error)) return false;
  const status = getTelegramStatus(error);
  if (status === 429) return true;
  if (isTransientTelegramError(error)) return true;
  if (isTransientNetworkError(error)) return true;
  return false;
}

function getRetryDelayMs(error, attempt, baseDelayMs) {
  const status = getTelegramStatus(error);
  if (status === 429) {
    return getRetryAfterMs(error) || baseDelayMs;
  }
  return baseDelayMs * (2 ** attempt);
}

async function withTelegramRetry(fn, options = {}) {
  const {
    retries = 3,
    baseDelayMs = 250,
    logger = console,
    label = 'Telegram API call'
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (isAuthFailure(error)) {
        logger.error(`[bot] ${label} auth failure: ${error.message}`);
        throw error;
      }

      if (!isRetryableError(error) || attempt >= retries) {
        throw error;
      }

      const delay = getRetryDelayMs(error, attempt, baseDelayMs);
      logger.warn(`[bot] ${label} failed (${error.message}). Retry ${attempt + 1}/${retries} in ${delay}ms`);
      await sleep(delay);
    }
  }

  throw lastError;
}

function wrapTelegramApi(bot, options = {}) {
  if (!bot || !bot.telegram || typeof bot.telegram.callApi !== 'function') {
    return;
  }

  const originalCallApi = bot.telegram.callApi.bind(bot.telegram);
  bot.telegram.callApi = async (method, payload, signal) => withTelegramRetry(
    () => originalCallApi(method, payload, signal),
    {
      ...options,
      label: `Telegram API ${method}`
    }
  );
}

async function launchBot(bot, launchOptions, options = {}) {
  return withTelegramRetry(
    () => bot.launch(launchOptions),
    {
      ...options,
      label: 'bot.launch'
    }
  );
}

module.exports = {
  withTelegramRetry,
  wrapTelegramApi,
  launchBot,
  isAuthFailure,
  isRetryableError
};
