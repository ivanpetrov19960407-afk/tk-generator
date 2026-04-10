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

async function createHandler(req, res) {
  const url = new URL(req.url, 'http://localhost');

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
        const tkResults = await generateBatch(normalizedProducts, tmpDir, { validation: { unknownUnitPolicy: 'warning' } });
        for (const product of normalizedProducts) {
          await generateRKM(product, tmpDir, { optimize: false });
        }

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

module.exports = { createApp, startServer, parseExcelProductsFromBuffer };
