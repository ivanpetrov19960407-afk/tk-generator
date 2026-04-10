'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const XLSX = require('xlsx');
const JSZip = require('jszip');

const { generateBatch, applyDefaults } = require('../generator');
const { generateRKM } = require('../rkm/rkm-generator');
const { validateBatchInput } = require('../validation/validator');
const { parseDimensions, resolveExcelMapping, validateRequiredColumns } = require('../utils/excel-import');
const { normalizeUnit } = require('../utils/unit-normalizer');
const { loadConfig, getConfig } = require('../config');
const { createRepository } = require('../db/repository');

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

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function getPublicConfig(config) {
  return {
    company: { name: config.company && config.company.name },
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
      '/api/generate': {
        post: {
          summary: 'Генерация DOCX/XLSX и возврат ZIP архива.',
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
      '/api/auth/login': {
        post: {
          summary: 'Аутентификация (заглушка).',
          tags: ['Auth'],
          responses: {
            501: { description: 'Пока не реализовано.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
          }
        }
      },
      '/api/auth/logout': {
        post: {
          summary: 'Выход (заглушка).',
          tags: ['Auth'],
          responses: {
            501: { description: 'Пока не реализовано.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
          }
        }
      },
      '/api/auth/me': {
        get: {
          summary: 'Профиль пользователя (заглушка).',
          tags: ['Auth'],
          responses: {
            501: { description: 'Пока не реализовано.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
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
            products: { type: 'array', items: { $ref: '#/components/schemas/Product' } }
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
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/api/docs/spec.json',
      dom_id: '#swagger-ui'
    });
  </script>
</body>
</html>`;
}

async function createHandler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const repository = createRepository();

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

  if (req.method === 'POST' && url.pathname === '/api/validate') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const products = parseProductsPayload(body);
    if (!products) return sendJson(res, 400, { valid: false, errors: ['Ожидается массив products или объект { products: [] }'], warnings: [] });
    return sendJson(res, 200, validateBatchInput(products, { unknownUnitPolicy: 'warning' }));
  }

  if (req.method === 'POST' && url.pathname === '/api/upload-excel') {
    try {
      const buffer = await readBody(req);
      const products = parseExcelProductsFromBuffer(buffer, null);
      return sendJson(res, 200, { products });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/generate') {
    try {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const products = parseProductsPayload(body);
      if (!products) return sendJson(res, 400, { error: 'Ожидается массив products или объект { products: [] }' });

      const report = validateBatchInput(products, { unknownUnitPolicy: 'warning' });
      if (!report.valid) return sendJson(res, 400, { error: 'Валидация не пройдена', report });

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-generator-api-'));
      try {
        const normalizedProducts = products.map((p) => applyDefaults(p));
        const startedAt = Date.now();
        const tkResults = await generateBatch(normalizedProducts, tmpDir, { validation: { unknownUnitPolicy: 'warning' } });
        for (const product of normalizedProducts) {
          await generateRKM(product, tmpDir, { optimize: false });
        }

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
          repository.saveGenerationItem({
            generation_id: generationId,
            position: Number(product.tk_number || index + 1),
            product_name: product.name || null,
            material: product.material && product.material.name ? product.material.name : null,
            texture: product.texture || null,
            status: tkResult && tkResult.success ? 'success' : 'error',
            error_message: tkResult && !tkResult.success ? tkResult.error : null,
            output_files: tkResult && tkResult.success && tkResult.filePath ? [tkResult.filePath] : []
          });
        });
        repository.saveAuditLog({
          action: 'api.generate',
          user: req.headers['x-user'] || 'api',
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
    const page = Number(url.searchParams.get('page') || 1);
    const pageSize = Number(url.searchParams.get('pageSize') || 20);
    const data = repository.getGenerations({ page, pageSize });
    repository.saveAuditLog({
      action: 'api.history.list',
      user: req.headers['x-user'] || 'api',
      details: { page, pageSize },
      ip: req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : null
    });
    return sendJson(res, 200, data);
  }

  if (req.method === 'GET' && /^\/api\/history\/\d+$/.test(url.pathname)) {
    const id = Number(url.pathname.split('/').pop());
    const data = repository.getGenerationById(id);
    if (!data) return sendJson(res, 404, { error: 'Not Found' });
    repository.saveAuditLog({
      action: 'api.history.detail',
      user: req.headers['x-user'] || 'api',
      details: { id },
      ip: req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : null
    });
    return sendJson(res, 200, data);
  }

  if (req.method === 'POST' && (url.pathname === '/api/auth/login' || url.pathname === '/api/auth/logout')) {
    return sendJson(res, 501, { error: 'Auth is not implemented yet' });
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    return sendJson(res, 501, { error: 'Auth is not implemented yet' });
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const file = path.resolve(process.cwd(), 'public', 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(file));
    return;
  }

  sendJson(res, 404, { error: 'Not Found' });
}

function createApp() {
  loadConfig();
  return {
    listen(port, cb) {
      const server = http.createServer((req, res) => {
        createHandler(req, res).catch((error) => sendJson(res, 500, { error: error.message }));
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
