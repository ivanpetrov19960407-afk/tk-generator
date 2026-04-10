'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const XLSX = require('xlsx');
const { Telegraf } = require('telegraf');

const { generateDocument, applyDefaults } = require('../generator');
const { generateRKM } = require('../rkm/rkm-generator');
const { calculateTotalCost, formatMoneyRu } = require('../cost-calculator');
const { parseDimensions, resolveExcelMapping, validateRequiredColumns } = require('../utils/excel-import');
const { sanitizeName, ensureSafePath } = require('../utils/security');

const sessions = new Map();

const BOT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_USERS = String(process.env.BOT_ALLOWED_USERS || '')
  .split(',')
  .map((id) => Number(id.trim()))
  .filter((id) => Number.isInteger(id));

function isAllowedUser(ctx) {
  if (!ALLOWED_USERS.length) return true;
  return Boolean(ctx && ctx.from && ALLOWED_USERS.includes(Number(ctx.from.id)));
}

function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, {
      flow: null,
      step: null,
      form: {},
      lastStatus: 'idle',
      lastError: null,
      lastGeneratedAt: null,
      lastProducts: []
    });
  }
  return sessions.get(chatId);
}

function mkProductFromForm(form) {
  const dimsResult = parseDimensions(form.dimensions);
  if (!dimsResult.value) {
    throw new Error(`Некорректные размеры: ${dimsResult.error}`);
  }

  return applyDefaults({
    tk_number: 1,
    name: form.name,
    short_name: String(form.name || 'position')
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-zа-яё0-9_]/gi, '')
      .slice(0, 32) || 'position',
    dimensions: dimsResult.value,
    material: {
      type: form.material,
      name: form.material,
      density: 2700
    },
    texture: String(form.texture || '').toLowerCase().replace(/\s+/g, '_') || 'полировка',
    quantity: '1 шт',
    quantity_pieces: 1,
    control_unit: 'шт',
    measurement_type: 'count',
    control_price: null,
    edges: 'калибровка по всем сторонам',
    geometry_type: 'simple',
    category: '1',
    gost_primary: 'ГОСТ 9480-2024',
    packaging: 'стандартная'
  });
}

function parseExcelProducts(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
  if (rows.length < 2) {
    throw new Error('Excel-файл пустой или не содержит данных');
  }

  const header = rows[0].map((v) => String(v || '').trim());
  const mapping = resolveExcelMapping(header, null);
  const check = validateRequiredColumns(mapping);
  if (!check.ok) {
    throw new Error(`Не найдены обязательные колонки: ${check.missing.join(', ')}`);
  }

  const products = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const name = row[mapping.name];
    const dimensions = row[mapping.dimensions];
    if (!name || !dimensions) continue;

    const dimsResult = parseDimensions(dimensions);
    if (!dimsResult.value) continue;

    const position = Number(row[mapping.position]) || products.length + 1;
    const material = 'камень';
    const texture = String(row[mapping.texture] || 'полировка').trim();

    products.push(applyDefaults({
      tk_number: position,
      name: String(name),
      short_name: String(name)
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-zа-яё0-9_]/gi, '')
        .slice(0, 32) || `pos_${position}`,
      dimensions: dimsResult.value,
      material: { type: material, name: material, density: 2700 },
      texture: texture.toLowerCase().replace(/\s+/g, '_'),
      quantity: '1 шт',
      quantity_pieces: 1,
      control_unit: 'шт',
      measurement_type: 'count',
      control_price: null,
      edges: 'калибровка по всем сторонам',
      geometry_type: 'simple',
      category: '1',
      gost_primary: 'ГОСТ 9480-2024',
      packaging: 'стандартная'
    }));
  }

  if (!products.length) {
    throw new Error('Не удалось распознать ни одной позиции в Excel');
  }

  return products;
}

function downloadTelegramFile(ctx, fileId, targetPath) {
  return new Promise(async (resolve, reject) => {
    try {
      const link = await ctx.telegram.getFileLink(fileId);
      const out = fs.createWriteStream(targetPath);
      https.get(link, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Ошибка скачивания файла: HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(out);
        out.on('finish', () => {
          out.close(resolve);
        });
      }).on('error', reject);
    } catch (error) {
      reject(error);
    }
  });
}

async function runGeneration(ctx, session, products) {
  const chatId = ctx.chat.id;
  session.lastStatus = 'running';
  session.lastError = null;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `tk-bot-${chatId}-`));

  try {
    const generatedFiles = [];
    for (const product of products) {
      const tk = await generateDocument(product, tmpDir, { cache: false });
      const rkm = await generateRKM(product, tmpDir, { optimize: false, cache: false });
      generatedFiles.push({ tk: tk.filePath, rkm: rkm.file, product });
    }

    for (const row of generatedFiles) {
      await ctx.replyWithDocument({ source: row.tk });
      await ctx.replyWithDocument({ source: row.rkm });
    }

    session.lastStatus = 'success';
    session.lastGeneratedAt = new Date().toISOString();
    session.lastProducts = products;
    await ctx.reply(`Готово: сгенерировано ${generatedFiles.length} позиций (DOCX + XLSX).`);
  } catch (error) {
    session.lastStatus = 'failed';
    session.lastError = error.message;
    await ctx.reply(`Ошибка генерации: ${error.message}`);
  }
}

function registerHandlers(bot) {
  bot.use(async (ctx, next) => {
    if (!isAllowedUser(ctx)) return;
    return next();
  });
  bot.start(async (ctx) => {
    await ctx.reply([
      'Привет! Я бот для генерации ТК+МК и РКМ.',
      '',
      'Команды:',
      '/generate — пошаговый ввод параметров или отправка Excel-файла',
      '/price <позиция> — быстрый расчёт себестоимости',
      '/status — статус последней генерации'
    ].join('\n'));
  });

  bot.command('status', async (ctx) => {
    const s = getSession(ctx.chat.id);
    const details = [
      `Статус: ${s.lastStatus}`,
      `Последняя генерация: ${s.lastGeneratedAt || 'ещё не запускалась'}`,
      `Последних позиций: ${s.lastProducts.length}`
    ];
    if (s.lastError) details.push(`Ошибка: ${s.lastError}`);
    await ctx.reply(details.join('\n'));
  });

  bot.command('price', async (ctx) => {
    const s = getSession(ctx.chat.id);
    const arg = ctx.message.text.split(' ').slice(1).join(' ').trim();

    if (!arg) {
      await ctx.reply('Использование: /price <позиция>. Например: /price 2');
      return;
    }

    const product = s.lastProducts.find((p) => String(p.tk_number) === arg)
      || s.lastProducts.find((p) => (p.name || '').toLowerCase().includes(arg.toLowerCase()));

    if (!product) {
      await ctx.reply('Позиция не найдена в последней генерации. Сначала выполните /generate.');
      return;
    }

    const calc = calculateTotalCost(product);
    await ctx.reply([
      `Позиция: ${product.tk_number} — ${product.name}`,
      `Себестоимость: ${formatMoneyRu(calc.total_cost)} ₽`,
      `Цена продажи: ${formatMoneyRu(calc.selling_price)} ₽`,
      `Контрольная цена: ${formatMoneyRu(calc.control_price)} ₽`,
      `Маржа: ${calc.margin}`
    ].join('\n'));
  });

  bot.command('generate', async (ctx) => {
    const s = getSession(ctx.chat.id);
    s.flow = 'generate';
    s.step = 'name';
    s.form = {};
    await ctx.reply('Введите наименование изделия (или отправьте Excel-файл .xlsx одним сообщением).');
  });

  bot.on('document', async (ctx) => {
  const s = getSession(ctx.chat.id);
  if (s.flow !== 'generate') {
    await ctx.reply('Чтобы обработать Excel, сначала запустите /generate.');
    return;
  }

  const doc = ctx.message.document;
  if (doc.file_size && Number(doc.file_size) > BOT_MAX_UPLOAD_BYTES) {
    await ctx.reply('Файл слишком большой: максимум 10MB.');
    return;
  }
  const ext = path.extname(doc.file_name || '').toLowerCase();
  if (ext !== '.xlsx' && ext !== '.xls') {
    await ctx.reply('Поддерживаются только Excel-файлы .xlsx/.xls');
    return;
  }

  const safeFileName = sanitizeName((doc.file_name || '').replace(/\.[^.]+$/, ''), 'upload') + path.extname(doc.file_name || '.xlsx').toLowerCase();
  const tmpFile = ensureSafePath(os.tmpdir(), `tg-upload-${Date.now()}-${safeFileName}`).finalPath;
  try {
    await ctx.reply('Получил файл, обрабатываю...');
    await downloadTelegramFile(ctx, doc.file_id, tmpFile);
    const products = parseExcelProducts(tmpFile);
    await runGeneration(ctx, s, products);
    s.flow = null;
    s.step = null;
    s.form = {};
  } catch (error) {
    s.lastStatus = 'failed';
    s.lastError = error.message;
    await ctx.reply(`Ошибка обработки Excel: ${error.message}`);
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
  });

  bot.on('text', async (ctx) => {
  const s = getSession(ctx.chat.id);
  if (s.flow !== 'generate') return;

  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;

  try {
    if (s.step === 'name') {
      s.form.name = text;
      s.step = 'dimensions';
      await ctx.reply('Введите размеры в формате ДxШxТ, например 1200x300x30');
      return;
    }

    if (s.step === 'dimensions') {
      s.form.dimensions = text;
      s.step = 'material';
      await ctx.reply('Введите материал (например: мрамор, гранит)');
      return;
    }

    if (s.step === 'material') {
      s.form.material = text;
      s.step = 'texture';
      await ctx.reply('Введите фактуру (например: полировка, термообработка)');
      return;
    }

    if (s.step === 'texture') {
      s.form.texture = text;
      const product = mkProductFromForm(s.form);
      await ctx.reply('Запускаю генерацию DOCX/XLSX...');
      await runGeneration(ctx, s, [product]);
      s.flow = null;
      s.step = null;
      s.form = {};
    }
  } catch (error) {
    s.lastStatus = 'failed';
    s.lastError = error.message;
    await ctx.reply(`Ошибка: ${error.message}. Попробуйте /generate снова.`);
    s.flow = null;
    s.step = null;
    s.form = {};
  }
  });
}

function createBot(options = {}) {
  const token = options.token || process.env.BOT_TOKEN;
  const TelegrafClass = options.TelegrafClass || Telegraf;
  if (!token) throw new Error('Не задан BOT_TOKEN в переменных окружения');
  const bot = new TelegrafClass(token);
  registerHandlers(bot);
  return bot;
}

if (require.main === module) {
  const bot = createBot();
  bot.launch().then(() => {
    console.log('Telegram bot started');
  });

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

module.exports = {
  createBot,
  parseExcelProducts
};
