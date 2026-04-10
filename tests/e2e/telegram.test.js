#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const stream = require('stream');
const https = require('https');
const { createMinimalExcelFixture } = require('./support/fixture-excel');

class FakeTelegraf {
  constructor(_token) {
    this.handlers = { commands: new Map(), events: new Map() };
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

  async launch() {}
  stop() {}
}

(async () => {
  try {
    require.resolve('pdfkit');
  } catch (_error) {
    console.log('SKIP: зависимости проекта не установлены (pdfkit).');
    process.exit(0);
  }
  const { createBot } = require('../../src/bot/index');
  const bot = createBot({ token: 'test-token', TelegrafClass: FakeTelegraf });
  const commandGenerate = bot.handlers.commands.get('generate');
  const documentHandler = bot.handlers.events.get('document');

  assert.ok(commandGenerate, 'Команда /generate не зарегистрирована');
  assert.ok(documentHandler, 'Обработчик document не зарегистрирован');

  const replies = [];
  const documents = [];
  const ctx = {
    chat: { id: 1001 },
    message: { text: '/generate' },
    telegram: {
      getFileLink: async () => 'https://mock.telegram.local/file.xlsx'
    },
    reply: async (text) => { replies.push(String(text)); },
    replyWithDocument: async ({ source }) => { documents.push(source); }
  };

  await commandGenerate(ctx);
  const fixture = createMinimalExcelFixture();

  const originalHttpsGet = https.get;
  https.get = (url, callback) => {
    const passthrough = new stream.PassThrough();
    passthrough.statusCode = 200;
    callback(passthrough);

    fs.createReadStream(fixture.filePath).pipe(passthrough);

    return { on: () => {} };
  };

  try {
    ctx.message = {
      document: {
        file_name: 'minimal-input.xlsx',
        file_id: 'fixture-file-id'
      }
    };

    await documentHandler(ctx);
  } finally {
    https.get = originalHttpsGet;
    fixture.cleanup();
  }

  assert.ok(replies.some((text) => text.includes('Получил файл, обрабатываю')), 'Бот должен подтвердить приём файла');
  assert.ok(replies.some((text) => text.includes('Готово: сгенерировано')), 'Бот должен вернуть сообщение об успешной генерации');
  assert.ok(documents.length >= 2, 'Бот должен отправить минимум DOCX и XLSX документ');

  console.log('telegram.e2e test passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
