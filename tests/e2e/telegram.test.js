#!/usr/bin/env node
'use strict';

const assert = require('assert');

class FakeTelegraf {
  constructor(_token) {
    this.handlers = { commands: new Map(), events: new Map() };
    this.middlewares = [];
    this.telegram = {
      callApi: async () => ({ ok: true })
    };
    this.launchAttempts = 0;
    this.launchScenario = [];
  }

  use(handler) {
    this.middlewares.push(handler);
  }

  start(handler) {
    this.handlers.start = handler;
  }

  command(name, handler) {
    this.handlers.commands.set(name, handler);
  }

  on(event, handler) {
    this.handlers.events.set(event, handler);
  }

  async launch() {
    this.launchAttempts += 1;
    const action = this.launchScenario.shift();
    if (typeof action === 'function') {
      return action();
    }
    return { ok: true };
  }

  stop() {}
}

function createCtx(userId, replies) {
  return {
    from: { id: userId },
    chat: { id: 1 },
    message: { text: '/status', from: { id: userId } },
    reply: async (text) => {
      replies.push(String(text));
    }
  };
}

(async () => {
  try {
    require.resolve('pdfkit');
  } catch (_error) {
    console.log('SKIP: зависимости проекта не установлены (pdfkit).');
    process.exit(0);
  }

  try {
  const { createBot } = require('../../src/bot/index');
  const { launchBot, withTelegramRetry } = require('../../src/bot/telegram-api');

    const bot = createBot({ token: 'test-token', TelegrafClass: FakeTelegraf });
    assert.ok(bot.handlers.commands.get('generate'), 'Команда /generate не зарегистрирована');

    const launchOk = new FakeTelegraf('test-token');
    await launchBot(launchOk, undefined, { retries: 0, baseDelayMs: 1 });
    assert.strictEqual(launchOk.launchAttempts, 1, 'Бот должен запускаться с первого раза при валидном токене');

    const launchBadToken = new FakeTelegraf('test-token');
    launchBadToken.launchScenario = [() => Promise.reject({
      message: '401: Unauthorized',
      response: { error_code: 401, description: 'Unauthorized' }
    })];

    let unauthorizedFailed = false;
    try {
      await launchBot(launchBadToken, undefined, { retries: 3, baseDelayMs: 1 });
    } catch (error) {
      unauthorizedFailed = error && error.response && error.response.error_code === 401;
    }
    assert.ok(unauthorizedFailed, 'При невалидном токене должен быть fail-fast без бесконечных retry');
    assert.strictEqual(launchBadToken.launchAttempts, 1, '401 ошибка не должна повторяться');

    const allowedBot = createBot({
      token: 'test-token',
      TelegrafClass: FakeTelegraf,
      allowedUsers: [777]
    });

    const middleware = allowedBot.middlewares[0];
    assert.ok(typeof middleware === 'function', 'Middleware whitelist не зарегистрирован');

    const allowedReplies = [];
    const allowedCtx = createCtx(777, allowedReplies);
    let nextCalled = false;
    await middleware(allowedCtx, async () => {
      nextCalled = true;
    });
    assert.ok(nextCalled, 'Пользователь из whitelist должен проходить middleware');

    const deniedReplies = [];
    const deniedCtx = createCtx(888, deniedReplies);
    let deniedNextCalled = false;
    await middleware(deniedCtx, async () => {
      deniedNextCalled = true;
    });
    assert.strictEqual(deniedNextCalled, false, 'Пользователь вне whitelist должен блокироваться');

    let tooManyAttempts = 0;
    const tooManyResult = await withTelegramRetry(async () => {
      tooManyAttempts += 1;
      if (tooManyAttempts < 2) {
        const err = new Error('Too Many Requests');
        err.response = {
          error_code: 429,
          parameters: { retry_after: 0 }
        };
        throw err;
      }
      return 'ok';
    }, { retries: 2, baseDelayMs: 1 });
    assert.strictEqual(tooManyResult, 'ok', '429 должен быть обработан с retry');
    assert.strictEqual(tooManyAttempts, 2, '429 должен ретраиться ограниченно');

    let networkAttempts = 0;
    const networkResult = await withTelegramRetry(async () => {
      networkAttempts += 1;
      if (networkAttempts < 3) {
        const err = new Error('socket hang up');
        err.code = 'ECONNRESET';
        throw err;
      }
      return 'recovered';
    }, { retries: 3, baseDelayMs: 1 });

    assert.strictEqual(networkResult, 'recovered', 'Transient network error должен успешно восстановиться');
    assert.strictEqual(networkAttempts, 3, 'Сетевые ошибки должны ретраиться с лимитом');

    console.log('telegram.e2e test passed');
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
