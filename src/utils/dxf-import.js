'use strict';

const fs = require('fs');
const path = require('path');

const INCH_TO_MM = 25.4;

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function detectSourceUnit(parsed, warnings) {
  const hdr = parsed && parsed.header ? parsed.header : {};
  const raw = hdr.$INSUNITS != null ? hdr.$INSUNITS : hdr.insUnits != null ? hdr.insUnits : null;
  if (raw == null) {
    warnings.push('DXF: $INSUNITS не задан, предполагаются миллиметры.');
    return { sourceUnit: null, factor: 1, convertedFromInches: false };
  }

  const code = Number(raw);
  if (code === 1) return { sourceUnit: 'inches', factor: INCH_TO_MM, convertedFromInches: true };
  if (code === 4) return { sourceUnit: 'millimeters', factor: 1, convertedFromInches: false };

  warnings.push(`DXF: $INSUNITS=${raw} не поддержан явно, предполагаются миллиметры.`);
  return { sourceUnit: String(raw), factor: 1, convertedFromInches: false };
}

function toPointArray(entity) {
  if (!entity || typeof entity !== 'object') return [];
  if (Array.isArray(entity.vertices) && entity.vertices.length) {
    return entity.vertices
      .map((v) => ({ x: safeNumber(v.x), y: safeNumber(v.y) }))
      .filter((v) => v.x != null && v.y != null);
  }
  if (entity.start && entity.end) {
    const sx = safeNumber(entity.start.x);
    const sy = safeNumber(entity.start.y);
    const ex = safeNumber(entity.end.x);
    const ey = safeNumber(entity.end.y);
    const pts = [];
    if (sx != null && sy != null) pts.push({ x: sx, y: sy });
    if (ex != null && ey != null) pts.push({ x: ex, y: ey });
    return pts;
  }
  return [];
}

function bboxFromPoints(points) {
  if (!points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const dx = maxX - minX;
  const dy = maxY - minY;
  if (!(dx > 0 && dy > 0)) return null;
  return {
    length: Math.max(dx, dy),
    width: Math.min(dx, dy),
    area: dx * dy
  };
}

function parseDimensionEntityValue(entity) {
  const candidates = [entity.actualMeasurement, entity.text, entity.measurement, entity.value];
  for (const candidate of candidates) {
    if (candidate == null || candidate === '') continue;
    const matched = String(candidate).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
    if (!matched) continue;
    const value = Number(matched[0]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function collectDimensionSizes(entities) {
  return entities
    .filter((e) => e.type === 'DIMENSION')
    .map(parseDimensionEntityValue)
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => b - a);
}

function parseThicknessFromString(value) {
  if (!value) return null;
  const text = String(value);
  const patterns = [
    /толщин[^0-9]*[:=]?\s*(\d+(?:[.,]\d+)?)/i,
    /\bthk\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i,
    /\bt\s*[:=]\s*(\d+(?:[.,]\d+)?)/i,
    /(\d+(?:[.,]\d+)?)\s*(?:mm|мм)\b/i
  ];

  for (const re of patterns) {
    const hit = text.match(re);
    if (!hit) continue;
    const num = Number(hit[1].replace(',', '.'));
    if (Number.isFinite(num) && num > 0) return num;
  }
  return null;
}

function collectTextHints(entities) {
  return entities
    .filter((e) => e.type === 'TEXT' || e.type === 'MTEXT')
    .map((e) => String(e.text || e.string || e.value || ''))
    .filter(Boolean);
}

function parseThicknessFromLayer(value) {
  if (!value) return null;
  const s = String(value);
  const patterns = [
    /\bT\s*=\s*(\d+(?:[.,]\d+)?)/i,
    /\bTHK\s*=\s*(\d+(?:[.,]\d+)?)/i,
    /\bT\s*(\d+(?:[.,]\d+)?)/i,
    /\b(\d+(?:[.,]\d+)?)\s*(?:mm|мм)\b/i
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (!m) continue;
    const num = Number(m[1].replace(',', '.'));
    if (Number.isFinite(num) && num > 0) return num;
  }
  return null;
}

function detectMaterialHint(filePath, entities) {
  const corpus = [path.basename(filePath), ...entities.map((e) => String(e.layer || '')), ...collectTextHints(entities)]
    .join(' ')
    .toLowerCase();
  if (!corpus) return null;

  const hints = [
    { re: /габбро/i, value: 'габбро-диабаз' },
    { re: /granit|гранит|жалгыз/i, value: 'granite' },
    { re: /mramor|мрамор|delikato/i, value: 'marble' },
    { re: /известняк|fatima/i, value: 'limestone' },
    { re: /кварцит|quartzite/i, value: 'quartzite' }
  ];

  const found = hints.find((item) => item.re.test(corpus));
  return found ? found.value : null;
}

function parseDxfAsciiFallback(content) {
  const lines = content.split(/\r?\n/);
  const entities = [];
  const header = {};
  let section = '';
  let current = null;

  for (let i = 0; i < lines.length - 1; i += 2) {
    const code = String(lines[i] || '').trim();
    const value = String(lines[i + 1] || '').trim();
    if (code === '0' && value === 'SECTION') {
      section = '';
      continue;
    }
    if (code === '2' && section === '') {
      section = value;
      continue;
    }
    if (code === '0' && value === 'ENDSEC') {
      if (current) {
        entities.push(current);
        current = null;
      }
      section = '';
      continue;
    }

    if (section === 'HEADER') {
      if (code === '9' && value === '$INSUNITS') {
        const unitCode = lines[i + 3] != null ? String(lines[i + 3]).trim() : null;
        if (unitCode != null) header.$INSUNITS = unitCode;
      }
      continue;
    }

    if (section !== 'ENTITIES') continue;

    if (code === '0') {
      if (current) entities.push(current);
      current = { type: value, vertices: [] };
      continue;
    }
    if (!current) continue;

    if (code === '8') current.layer = value;
    if (current.type === 'LINE') {
      if (code === '10') {
        current.start = current.start || {};
        current.start.x = Number(value);
      }
      if (code === '20') {
        current.start = current.start || {};
        current.start.y = Number(value);
      }
      if (code === '11') {
        current.end = current.end || {};
        current.end.x = Number(value);
      }
      if (code === '21') {
        current.end = current.end || {};
        current.end.y = Number(value);
      }
    }
    if (current.type === 'LWPOLYLINE' || current.type === 'POLYLINE') {
      if (code === '10') {
        current.vertices.push({ x: Number(value), y: null });
      }
      if (code === '20' && current.vertices.length) {
        current.vertices[current.vertices.length - 1].y = Number(value);
      }
    }
    if (current.type === 'TEXT' || current.type === 'MTEXT') {
      if (code === '1') current.text = value;
    }
    if (current.type === 'DIMENSION') {
      if (code === '1') current.text = value;
      if (code === '42') current.actualMeasurement = Number(value);
    }
  }
  if (current) entities.push(current);
  return { header, entities };
}

function parseDxfContent(content) {
  let parsed;
  try {
    const dxf = require('dxf');
    parsed = dxf.parseString(content);
  } catch (_error) {
    parsed = null;
  }
  if (!parsed || !Array.isArray(parsed.entities)) {
    parsed = parseDxfAsciiFallback(content);
  }
  if (!parsed || !Array.isArray(parsed.entities)) {
    throw new Error('Не удалось распарсить DXF: некорректная структура файла.');
  }

  const hasDimValues = parsed.entities
    .filter((e) => e.type === 'DIMENSION')
    .some((e) => parseDimensionEntityValue(e) != null);

  if (!hasDimValues) {
    const fallback = parseDxfAsciiFallback(content);
    const fbDims = (fallback.entities || []).filter((e) => e.type === 'DIMENSION');
    if (fbDims.some((e) => parseDimensionEntityValue(e) != null)) {
      let idx = 0;
      for (const e of parsed.entities) {
        if (e.type === 'DIMENSION' && idx < fbDims.length) {
          const fb = fbDims[idx++];
          if (fb.text != null) e.text = fb.text;
          if (fb.actualMeasurement != null) e.actualMeasurement = fb.actualMeasurement;
        }
      }
    }
  }

  return parsed;
}

function parseDxfFile(filePath, options = {}) {
  const warnings = [];
  const content = fs.readFileSync(filePath, 'utf8');
  if (!/SECTION/i.test(content) || !/ENTITIES/i.test(content)) {
    throw new Error('Невалидный DXF: отсутствуют обязательные секции SECTION/ENTITIES.');
  }

  const parsed = parseDxfContent(content);
  const entities = parsed.entities || [];

  const unitInfo = detectSourceUnit(parsed, warnings);
  const factor = unitInfo.factor;

  const geomEntities = entities.filter((e) => ['LWPOLYLINE', 'LINE', 'POLYLINE'].includes(e.type));
  const layerBuckets = new Map();
  for (const entity of geomEntities) {
    const key = entity.layer || '__default__';
    const arr = layerBuckets.get(key) || [];
    arr.push(...toPointArray(entity));
    layerBuckets.set(key, arr);
  }
  const bboxes = [...layerBuckets.values()]
    .map((points) => bboxFromPoints(points))
    .filter(Boolean)
    .sort((a, b) => b.area - a.area);

  if (bboxes.length > 1 && bboxes[0].area === bboxes[1].area) {
    warnings.push('DXF: обнаружено несколько равных по размаху контуров, выбран первый.');
  }

  const primaryBox = bboxes[0] || bboxFromPoints(geomEntities.flatMap((entity) => toPointArray(entity)));
  const bboxDims = primaryBox
    ? { length: primaryBox.length * factor, width: primaryBox.width * factor }
    : { length: null, width: null };

  const dimensionCandidates = collectDimensionSizes(entities).map((v) => v * factor);
  let dimensionSource = 'bbox';
  let length = bboxDims.length;
  let width = bboxDims.width;

  if (dimensionCandidates.length >= 2) {
    const dLength = dimensionCandidates[0];
    const dWidth = dimensionCandidates[1];
    if (dLength > 0 && dWidth > 0) {
      length = Math.max(dLength, dWidth);
      width = Math.min(dLength, dWidth);
      dimensionSource = 'DIMENSION';
      if (bboxDims.length && bboxDims.width) {
        const delta = Math.abs(length - bboxDims.length) / bboxDims.length;
        if (delta > 0.2) warnings.push('DXF: DIMENSION существенно отличается от bbox, использованы DIMENSION.');
      }
    }
  }

  const sources = [];
  const rememberThickness = (value, source, priority) => {
    if (!(Number.isFinite(value) && value > 0)) return;
    sources.push({ value, source, priority });
  };

  rememberThickness(safeNumber(options.thickness), 'options.thickness', 1);
  rememberThickness(safeNumber(options.cliThickness), 'cli.--thickness', 2);
  rememberThickness(parseThicknessFromString(path.basename(filePath)), 'filename', 3);

  const textValues = collectTextHints(entities);
  for (const text of textValues) {
    rememberThickness(parseThicknessFromString(text), 'text', 4);
  }

  const layers = [...new Set(entities.map((e) => e.layer).filter(Boolean))];
  for (const layer of layers) {
    rememberThickness(parseThicknessFromLayer(layer), 'layer', 5);
  }

  sources.sort((a, b) => a.priority - b.priority);
  const selected = sources[0] || null;
  const uniqueThicknesses = [...new Set(sources.map((s) => String(s.value)))];
  if (uniqueThicknesses.length > 1) {
    warnings.push(`DXF: найдены разные толщины (${uniqueThicknesses.join(', ')}), выбран источник ${selected.source}.`);
  }

  return {
    dimensions: {
      length: Number.isFinite(length) ? Number(length.toFixed(3)) : null,
      width: Number.isFinite(width) ? Number(width.toFixed(3)) : null,
      thickness: selected ? Number(selected.value) : null,
      unit: 'mm'
    },
    material_hint: detectMaterialHint(filePath, entities),
    entities_count: entities.length,
    meta: {
      sourceUnit: unitInfo.sourceUnit,
      convertedFromInches: unitInfo.convertedFromInches,
      thicknessSource: selected ? selected.source : null,
      dimensionSource,
      warnings
    }
  };
}

module.exports = { parseDxfFile, parseDxfContent };
