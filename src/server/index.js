'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const XLSX = require('xlsx');
const JSZip = require('jszip');

const { generateBatch, applyDefaults, normalizeFormats } = require('../generator');
const { generateRKM } = require('../rkm/rkm-generator');
const { validateBatchInput } = require('../validation/validator');
const { calculateTotalCost } = require('../cost-calculator');
const { parseDimensions, resolveExcelMapping, validateRequiredColumns } = require('../utils/excel-import');
const { parseDxfFile } = require('../utils/dxf-import');
const { normalizeUnit } = require('../utils/unit-normalizer');
const { loadConfig, getConfig } = require('../config');
const { createRepository } = require('../db/repository');
const { createAuth } = require('./auth');
const { buildGenerationCsv } = require('../summary-report');

const MAX_JSON_BODY_BYTES = 5 * 1024 * 1024;
const MAX_EXCEL_UPLOAD_BYTES = 10 * 1024 * 1024;
const GENERATION_TIMEOUT_MS = 30 * 1000;

function parseProductsPayload(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.products)) return body.products;
  return null;
}

function mapTexture(textureStr) {
  if (!textureStr) return 'лощение';
  const s = String(textureStr).trim().toLowerCase();
  if (s.includes('бучард')) return 'бучардирование_лощение';
  if (s.includes('рельеф') || s.includes('матов')) return 'рельефная_матовая';
  if (s.includes('лощен')) return 'лощение';
  return s.replace(/[\s,+]+/g, '_');
}

function extractMaterial(nameText) {
  const text = String(nameText || '');
  const lc = text.toLowerCase();
  if (lc.includes('габбро')) return { type: 'габбро-диабаз', name: 'Габбро-диабаз Нинимяки' };
  if (lc.includes('жалгыз')) return { type: 'гранит', name: 'гранит м-ния Жалгыз' };

  const matMatch = text.match(/Материал\s*[—–\-:]\s*(.+?)(?:[;,]|\s+Обработка|$)/i);
  if (!matMatch) return { type: 'мрамор', name: 'unknown' };

  const materialName = matMatch[1].trim();
  const knownTypes = ['гранит', 'мрамор', 'известняк', 'мраморизированный', 'травертин', 'песчаник', 'оникс', 'габбро', 'кварцит'];
  const firstWord = materialName.split(/\s/)[0].toLowerCase();
  let materialType = knownTypes.find((t) => firstWord.startsWith(t)) || 'мрамор';
  if (materialType === 'мраморизированный') materialType = 'известняк';
  return { type: materialType, name: materialName };
}

function parseExcelProductsFromBuffer(buffer, mappingArg) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheet = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheet];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!rows.length) throw new Error('Excel-файл пустой.');

  const mapping = resolveExcelMapping(rows[0].map((v) => String(v || '').trim()), mappingArg || null);
  const required = validateRequiredColumns(mapping);
  if (!required.ok) throw new Error(`Не найдены обязательные колонки: ${required.missing.join(', ')}`);

  return rows.slice(1).map((row, index) => {
    const get = (key) => {
      const col = mapping[key];
      return col == null || col < 0 ? '' : row[col];
    };

    const dims = parseDimensions(get('dimensions'));
    if (!dims.value) return null;

    const unitParsed = normalizeUnit(get('unit'));
    const quantityRaw = Number(String(get('quantity')).replace(',', '.'));
    const quantity = Number.isFinite(quantityRaw) ? quantityRaw : null;
    const material = extractMaterial(get('name'));
    const tk = Number(get('position'));

    return {
      tk_number: Number.isFinite(tk) ? tk : index + 1,
      name: String(get('name') || '').trim(),
      dimensions: dims.value,
      material: { type: material.type, name: material.name, density: 2700 },
      texture: mapTexture(get('texture')),
      control_unit: unitParsed.unit,
      quantity_pieces: unitParsed.measurement_type === 'count' ? quantity : null,
      quantity: unitParsed.measurement_type === 'area' && quantity != null ? `${quantity} м²` : null,
      category: '1',
      gost_primary: 'ГОСТ 9480-2024',
      packaging: 'стандартная'
    };
  }).filter(Boolean);
}

function readBody(req, maxBytes = MAX_JSON_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > maxBytes) {
        const err = new Error('Payload too large');
        err.statusCode = 413;
        req.destroy(err);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function parseMultipartSingleFile(buffer, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buffer.indexOf(delimiter);
  while (start !== -1) {
    const next = buffer.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const chunk = buffer.slice(start + delimiter.length, next);
    parts.push(chunk);
    start = next;
  }

  for (const part of parts) {
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) continue;
    const headerText = part.slice(0, headerEnd).toString('utf8');
    if (!/filename=/i.test(headerText)) continue;
    const fileNameMatch = headerText.match(/filename=\"([^\"]+)\"/i);
    const fileName = fileNameMatch ? fileNameMatch[1] : 'upload.dxf';
    const body = part.slice(headerEnd + 4);
    const cleaned = body.slice(0, body.length - 2); // trim trailing CRLF
    return { fileName, buffer: cleaned };
  }
  return null;
}

function parseAnalyticsFilters(url) {
  const from = url.searchParams.get('from') || null;
  const to = url.searchParams.get('to') || null;
  const material = url.searchParams.get('material') || null;
  const texture = url.searchParams.get('texture') || null;
  const groupByRaw = String(url.searchParams.get('groupBy') || 'day').toLowerCase();
  return {
    from,
    to,
    material,
    texture,
    groupBy: groupByRaw === 'week' ? 'week' : 'day'
  };
}

function getPublicConfig(config) {
  return {
    company: { name: config.company && config.company.name },
    auth: { enabled: Boolean(config.auth && config.auth.enabled) },
    rkm: {
      logisticsDefaults: config.rkm && config.rkm.logisticsDefaults,
      skipTransportTkNumbers: config.rkm && config.rkm.skipTransportTkNumbers
    }
  };
}

function createOpenApiSpec() {
  return {
    openapi: '3.0.0',
    info: {
      title: 'TK Generator API',
      version: '1.0.0',
      description: 'API для генерации технологических карт, валидации и истории запусков.'
    },
    servers: [{ url: '/' }],
    paths: {
      '/api/health': {
        get: {
          summary: 'Проверка доступности API.',
          tags: ['System'],
          responses: {
            200: { description: 'Сервис доступен.' }
          }
        }
      },
      '/api/generate': {
        post: {
          summary: 'Генерация DOCX/PDF/XLSX и возврат ZIP архива.',
          tags: ['API'],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/BatchInput' } }
            }
          },
          responses: {
            200: {
              description: 'ZIP архив с файлами.',
              content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } }
            },
            400: { description: 'Ошибка валидации.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            500: { description: 'Внутренняя ошибка.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
          }
        }
      },
      '/api/validate': {
        post: {
          summary: 'Валидация входных данных без генерации файлов.',
          tags: ['API'],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/BatchInput' } }
            }
          },
          responses: {
            200: { description: 'Результат валидации.' },
            400: { description: 'Некорректный запрос.' }
          }
        }
      },
      '/api/import-dxf': {
        post: {
          summary: 'Загрузка DXF (multipart/form-data) и извлечение размеров без генерации файлов.',
          tags: ['API'],
          responses: {
            200: { description: 'Извлечённые параметры DXF.' },
            400: { description: 'Ошибка валидации входного файла.' }
          }
        }
      },
      '/api/history': {
        get: {
          summary: 'Список запусков генерации.',
          tags: ['API'],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20 } }
          ],
          responses: {
            200: { description: 'История запусков.' }
          }
        }
      },
      '/api/history/{id}': {
        get: {
          summary: 'Детали запуска по идентификатору.',
          tags: ['API'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            200: { description: 'Детали генерации.', content: { 'application/json': { schema: { $ref: '#/components/schemas/HistoryEntry' } } } },
            404: { description: 'Запись не найдена.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
          }
        }
      },
      '/api/export/csv': {
        get: {
          summary: 'Экспорт позиций запуска в CSV.',
          tags: ['API'],
          parameters: [{ name: 'generation_id', in: 'query', required: true, schema: { type: 'integer' } }],
          responses: {
            200: { description: 'CSV файл с позициями запуска.' },
            400: { description: 'Некорректный запрос.' },
            404: { description: 'Запуск не найден.' }
          }
        }
      },
      '/api/auth/login': {
        post: {
          summary: 'Аутентификация пользователя.',
          tags: ['Auth'],
          responses: {
            200: { description: 'Успешный вход.' },
            401: { description: 'Неверный логин или пароль.' }
          }
        }
      },
      '/api/auth/register': {
        post: {
          summary: 'Создание пользователя (только admin).',
          tags: ['Auth'],
          responses: {
            201: { description: 'Пользователь создан.' },
            403: { description: 'Недостаточно прав.' }
          }
        }
      },
      '/api/auth/me': {
        get: {
          summary: 'Профиль текущего пользователя.',
          tags: ['Auth'],
          responses: {
            200: { description: 'Данные пользователя.' },
            401: { description: 'Не аутентифицирован.' }
          }
        }
      },
      '/api/analytics/summary': {
        get: {
          summary: 'Сводная аналитика по себестоимости.',
          tags: ['Analytics'],
          responses: {
            200: { description: 'Сводная статистика.' }
          }
        }
      },
      '/api/analytics/cost-trends': {
        get: {
          summary: 'Тренд себестоимости по дням/неделям.',
          tags: ['Analytics'],
          responses: {
            200: { description: 'Ряд для графика тренда.' }
          }
        }
      },
      '/api/analytics/materials': {
        get: {
          summary: 'Топ материалов по количеству и стоимости.',
          tags: ['Analytics'],
          responses: {
            200: { description: 'Статистика по материалам.' }
          }
        }
      },
      '/api/analytics/textures': {
        get: {
          summary: 'Распределение по фактурам.',
          tags: ['Analytics'],
          responses: {
            200: { description: 'Статистика по фактурам.' }
          }
        }
      }
    },
    components: {
      schemas: {
        Product: {
          type: 'object',
          required: ['name', 'dimensions', 'material', 'texture'],
          properties: {
            tk_number: { type: 'integer' },
            name: { type: 'string' },
            short_name: { type: 'string' },
            dimensions: {
              type: 'object',
              required: ['length', 'width', 'thickness'],
              properties: {
                length: { type: 'number' },
                width: { type: 'number' },
                thickness: { type: 'number' }
              }
            },
            material: {
              type: 'object',
              required: ['type', 'name'],
              properties: {
                type: { type: 'string' },
                name: { type: 'string' },
                density: { type: 'number' }
              }
            },
            texture: { type: 'string' },
            quantity_pieces: { type: 'number', nullable: true },
            quantity: { type: 'string', nullable: true },
            control_unit: { type: 'string' },
            category: { type: 'string' }
          }
        },
        BatchInput: {
          type: 'object',
          required: ['products'],
          properties: {
            products: { type: 'array', items: { $ref: '#/components/schemas/Product' } },
            format: { type: 'string', example: 'docx,pdf', description: 'Формат ТК: docx, pdf или docx,pdf' }
          }
        },
        GenerationResult: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            filePath: { type: 'string', nullable: true },
            error: { type: 'string', nullable: true }
          }
        },
        HistoryEntry: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            timestamp: { type: 'string', format: 'date-time' },
            products_count: { type: 'integer' },
            success_count: { type: 'integer' },
            error_count: { type: 'integer' },
            duration_ms: { type: 'integer' }
          }
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        }
      }
    }
  };
}

function createSwaggerHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>TK Generator API Docs</title>
  <link rel="stylesheet" href="/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/api/docs/spec.json',
      dom_id: '#swagger-ui'
    });
  </script>
</body>
</html>`;
}

async function createHandler(req, res, deps = {}) {
  const url = new URL(req.url, 'http://localhost');
  const repository = deps.repository || createRepository();
  const auth = deps.auth;

  if (deps.bootstrapPromise) await deps.bootstrapPromise;

  const ipAddress = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : null;
  function enforceContentLengthLimit(maxBytes, action) {
    const contentLength = Number(req.headers['content-length'] || 0);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      repository.saveAuditLog({ action, user: (req.auth && req.auth.user && req.auth.user.username) || req.headers['x-user'] || 'api', details: { contentLength, maxBytes, path: req.url }, ip: ipAddress });
      sendJson(res, 413, { error: 'Payload too large' });
      return false;
    }
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/docs/spec.json') {
    return sendJson(res, 200, createOpenApiSpec());
  }

  if (req.method === 'GET' && url.pathname === '/api/docs') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(createSwaggerHtml());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/config') {
    return sendJson(res, 200, getPublicConfig(getConfig()));
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(res, 200, { status: 'ok', service: 'tk-generator-api' });
  }

  if (req.method === 'POST' && url.pathname === '/api/validate') {
    if (auth && !(await auth.requireRole(req, res, sendJson, 'operator'))) return;
    if (!enforceContentLengthLimit(MAX_JSON_BODY_BYTES, 'security.payload_too_large')) return;
    const body = JSON.parse((await readBody(req, MAX_JSON_BODY_BYTES)).toString('utf8') || '{}');
    const products = parseProductsPayload(body);
    if (!products) return sendJson(res, 400, { valid: false, errors: ['Ожидается массив products или объект { products: [] }'], warnings: [] });
    return sendJson(res, 200, validateBatchInput(products, { unknownUnitPolicy: 'warning' }));
  }

  if (req.method === 'POST' && url.pathname === '/api/upload-excel') {
    if (auth && !(await auth.requireRole(req, res, sendJson, 'operator'))) return;
    try {
      if (!enforceContentLengthLimit(MAX_EXCEL_UPLOAD_BYTES, 'security.payload_too_large')) return;
      const buffer = await readBody(req, MAX_EXCEL_UPLOAD_BYTES);
      const products = parseExcelProductsFromBuffer(buffer, null);
      return sendJson(res, 200, { products });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/import-dxf') {
    if (auth && !(await auth.requireRole(req, res, sendJson, 'operator'))) return;
    try {
      if (!enforceContentLengthLimit(MAX_EXCEL_UPLOAD_BYTES, 'security.payload_too_large')) return;
      const contentType = String(req.headers['content-type'] || '');
      // Поддержка boundary как с кавычками (boundary="abc"), так и без (boundary=abc)
      const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
      if (!contentType.includes('multipart/form-data') || !boundaryMatch) {
        return sendJson(res, 400, { ok: false, error: 'Ожидается multipart/form-data с файлом DXF.' });
      }
      const boundary = (boundaryMatch[1] || boundaryMatch[2] || '').trim();

      const formBuffer = await readBody(req, MAX_EXCEL_UPLOAD_BYTES);
      const filePart = parseMultipartSingleFile(formBuffer, boundary);
      if (!filePart || !filePart.buffer || !filePart.buffer.length) {
        return sendJson(res, 400, { ok: false, error: 'Файл не найден в multipart-запросе.' });
      }
      if (path.extname(filePart.fileName).toLowerCase() !== '.dxf') {
        return sendJson(res, 400, { ok: false, error: 'Неверное расширение файла, ожидается .dxf.' });
      }

      const tmpFile = path.join(os.tmpdir(), `tk-generator-upload-${Date.now()}-${path.basename(filePart.fileName)}`);
      fs.writeFileSync(tmpFile, filePart.buffer);
      try {
        const parsed = parseDxfFile(tmpFile, {
          thickness: url.searchParams.get('thickness')
        });
        return sendJson(res, 200, { ok: true, data: parsed });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: `DXF parsing failed: ${error.message}` });
      } finally {
        fs.rmSync(tmpFile, { force: true });
      }
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/generate') {
    if (auth && !(await auth.requireRole(req, res, sendJson, 'operator'))) return;
    try {
      if (!enforceContentLengthLimit(MAX_JSON_BODY_BYTES, 'security.payload_too_large')) return;
      const body = JSON.parse((await readBody(req, MAX_JSON_BODY_BYTES)).toString('utf8') || '{}');
      const products = parseProductsPayload(body);
      if (!products) return sendJson(res, 400, { error: 'Ожидается массив products или объект { products: [] }' });

      const report = validateBatchInput(products, { unknownUnitPolicy: 'warning' });
      const formats = normalizeFormats(body.format || 'docx');
      if (!report.valid) return sendJson(res, 400, { error: 'Валидация не пройдена', report });

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-generator-api-'));
      try {
        const normalizedProducts = products.map((p) => applyDefaults(p));
        const startedAt = Date.now();
        const generationPromise = (async () => {
          const tkResults = await generateBatch(normalizedProducts, tmpDir, { validation: { unknownUnitPolicy: 'warning' }, format: formats });
          for (const product of normalizedProducts) {
            await generateRKM(product, tmpDir, { optimize: false });
          }
          return tkResults;
        })();
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => {
          const err = new Error('Generation timeout exceeded');
          err.statusCode = 504;
          reject(err);
        }, GENERATION_TIMEOUT_MS));
        const tkResults = await Promise.race([generationPromise, timeoutPromise]);

        const failed = tkResults.filter((r) => !r.success).length;
        const generationId = repository.saveGeneration({
          timestamp: new Date().toISOString(),
          input_file: 'api:/api/generate',
          products_count: normalizedProducts.length,
          success_count: normalizedProducts.length - failed,
          error_count: failed,
          duration_ms: Date.now() - startedAt,
          output_dir: tmpDir
        });
        normalizedProducts.forEach((product, index) => {
          const tkResult = tkResults[index];
          let totalCost = 0;
          try {
            totalCost = Number(calculateTotalCost(product).total_cost || 0);
          } catch (_error) {
            totalCost = 0;
          }
          repository.saveGenerationItem({
            generation_id: generationId,
            position: Number(product.tk_number || index + 1),
            product_name: product.name || null,
            material: product.material && product.material.name ? product.material.name : null,
            texture: product.texture || null,
            total_cost: totalCost,
            status: tkResult && tkResult.success ? 'success' : 'error',
            error_message: tkResult && !tkResult.success ? tkResult.error : null,
            output_files: tkResult && tkResult.success && tkResult.filePath ? [tkResult.filePath] : []
          });
        });
        repository.saveAuditLog({
          action: 'api.generate',
          user: (req.auth && req.auth.user && req.auth.user.username) || req.headers['x-user'] || 'api',
          details: { generationId, method: req.method, path: req.url },
          ip: req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : null
        });

        const zip = new JSZip();
        for (const file of fs.readdirSync(tmpDir)) {
          const filePath = path.join(tmpDir, file);
          if (fs.statSync(filePath).isFile()) zip.file(file, fs.readFileSync(filePath));
        }
        zip.file('report.json', JSON.stringify({ valid: report.valid, errors: report.errors, warnings: report.warnings, generation: tkResults }, null, 2));

        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="tk-generator-result.zip"'
        });
        res.end(zipBuffer);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/history') {
    if (auth && !(await auth.requireRole(req, res, sendJson, 'viewer'))) return;
    const page = Number(url.searchParams.get('page') || 1);
    const pageSize = Number(url.searchParams.get('pageSize') || 20);
    const data = repository.getGenerations({ page, pageSize });
    repository.saveAuditLog({
      action: 'api.history.list',
      user: (req.auth && req.auth.user && req.auth.user.username) || req.headers['x-user'] || 'api',
      details: { page, pageSize },
      ip: req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : null
    });
    return sendJson(res, 200, data);
  }

  if (req.method === 'GET' && /^\/api\/history\/\d+$/.test(url.pathname)) {
    if (auth && !(await auth.requireRole(req, res, sendJson, 'viewer'))) return;
    const id = Number(url.pathname.split('/').pop());
    const data = repository.getGenerationById(id);
    if (!data) return sendJson(res, 404, { error: 'Not Found' });
    repository.saveAuditLog({
      action: 'api.history.detail',
      user: (req.auth && req.auth.user && req.auth.user.username) || req.headers['x-user'] || 'api',
      details: { id },
      ip: req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : null
    });
    return sendJson(res, 200, data);
  }

  if (req.method === 'GET' && url.pathname === '/api/export/csv') {
    if (auth && !(await auth.requireRole(req, res, sendJson, 'viewer'))) return;
    const generationId = Number(url.searchParams.get('generation_id'));
    if (!Number.isFinite(generationId) || generationId <= 0) return sendJson(res, 400, { error: 'generation_id is required' });
    const generation = repository.getGenerationById(generationId);
    if (!generation) return sendJson(res, 404, { error: 'Not Found' });
    const csv = buildGenerationCsv(generation);
    const fileName = `generation_${generationId}_export.csv`;
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`
    });
    res.end(csv);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    if (!auth || !auth.enabled) return sendJson(res, 404, { error: 'Auth disabled' });
    if (!enforceContentLengthLimit(MAX_JSON_BODY_BYTES, 'security.payload_too_large')) return;
    const body = JSON.parse((await readBody(req, MAX_JSON_BODY_BYTES)).toString('utf8') || '{}');
    const result = await auth.login(body.username, body.password, ipAddress);
    if (!result) {
      repository.saveAuditLog({ action: 'auth.login.failed', user: String(body.username || ''), details: { path: req.url }, ip: ipAddress });
      return sendJson(res, 401, { error: 'Invalid credentials' });
    }
    return sendJson(res, 200, result);
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/register') {
    if (!auth || !auth.enabled) return sendJson(res, 404, { error: 'Auth disabled' });
    if (!(await auth.requireRole(req, res, sendJson, 'admin'))) return;
    if (!enforceContentLengthLimit(MAX_JSON_BODY_BYTES, 'security.payload_too_large')) return;
    const body = JSON.parse((await readBody(req, MAX_JSON_BODY_BYTES)).toString('utf8') || '{}');
    try {
      const user = await auth.register(req.auth.user, body);
      return sendJson(res, 201, { user });
    } catch (error) {
      return sendJson(res, error.statusCode || 400, { error: error.message });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    if (!auth || !auth.enabled) return sendJson(res, 404, { error: 'Auth disabled' });
    if (!(await auth.requireRole(req, res, sendJson, 'viewer'))) return;
    return sendJson(res, 200, { user: req.auth.user });
  }

  if (req.method === 'GET' && url.pathname === '/api/analytics/summary') {
    if (auth && !(await auth.requireRole(req, res, sendJson, 'viewer'))) return;
    const filters = parseAnalyticsFilters(url);
    const summary = repository.getAnalyticsSummary(filters);
    return sendJson(res, 200, { filters, ...summary });
  }

  if (req.method === 'GET' && url.pathname === '/api/analytics/cost-trends') {
    if (auth && !(await auth.requireRole(req, res, sendJson, 'viewer'))) return;
    const filters = parseAnalyticsFilters(url);
    const items = repository.getAnalyticsCostTrends(filters);
    return sendJson(res, 200, { filters, items });
  }

  if (req.method === 'GET' && url.pathname === '/api/analytics/materials') {
    if (auth && !(await auth.requireRole(req, res, sendJson, 'viewer'))) return;
    const filters = parseAnalyticsFilters(url);
    const limit = Number(url.searchParams.get('limit') || 10);
    const items = repository.getAnalyticsMaterials({ ...filters, limit });
    return sendJson(res, 200, { filters: { ...filters, limit }, items });
  }

  if (req.method === 'GET' && url.pathname === '/api/analytics/textures') {
    if (auth && !(await auth.requireRole(req, res, sendJson, 'viewer'))) return;
    const filters = parseAnalyticsFilters(url);
    const items = repository.getAnalyticsTextures(filters);
    return sendJson(res, 200, { filters, items });
  }


  if (req.method === 'GET' && url.pathname === '/swagger-ui.css') {
    const file = path.resolve(process.cwd(), 'public', 'swagger-ui.css');
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
    res.end(fs.readFileSync(file));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/swagger-ui-bundle.js') {
    const file = path.resolve(process.cwd(), 'public', 'swagger-ui-bundle.js');
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end(fs.readFileSync(file));
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const file = path.resolve(process.cwd(), 'public', 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(file));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/analytics.html') {
    const file = path.resolve(process.cwd(), 'public', 'analytics.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(file));
    return;
  }

  sendJson(res, 404, { error: 'Not Found' });
}

function createApp() {
  const config = loadConfig();
  const repository = createRepository();
  const auth = createAuth(config, repository);
  const bootstrapPromise = auth.ensureBootstrapAdmin();
  return {
    listen(port, cb) {
      const server = http.createServer((req, res) => {
        createHandler(req, res, { repository, auth, bootstrapPromise }).catch((error) => sendJson(res, 500, { error: error.message }));
      });
      return server.listen(port, cb);
    }
  };
}

function startServer() {
  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  return app.listen(port, () => {
    console.log(`TK Generator API listening on http://localhost:${port}`);
  });
}

if (require.main === module) startServer();

module.exports = { createApp, startServer, parseExcelProductsFromBuffer, createOpenApiSpec };
