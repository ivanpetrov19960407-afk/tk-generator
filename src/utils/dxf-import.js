'use strict';

/**
 * dxf-import.js
 *
 * Парсер DXF-файлов для извлечения размеров изделий.
 *
 * Поддерживает два метода извлечения размеров:
 *   1. DIMENSION — из DXF-сущностей типа DIMENSION (приоритетный)
 *   2. bbox     — по bounding-box линий/полилиний (fallback)
 *
 * Формат DXF (AutoCAD): текстовый, содержит секции HEADER, ENTITIES, и т.д.
 * Каждая запись — пара строк: групповой код и значение.
 */

/**
 * Parse raw DXF text into structured sections/entities.
 * @param {string} content — raw DXF file content
 * @returns {{ entities: Array<{type: string, properties: Object}> }}
 */
function parseDxfContent(content) {
  if (!content || typeof content !== 'string') {
    return { entities: [] };
  }

  const lines = content.split(/\r?\n/);
  const entities = [];
  let inEntities = false;
  let current = null;

  for (let i = 0; i < lines.length - 1; i++) {
    const code = lines[i].trim();
    const value = lines[i + 1] ? lines[i + 1].trim() : '';

    if (code === '0' && value === 'SECTION') {
      // peek at section name
      if (i + 3 < lines.length && lines[i + 2].trim() === '2' && lines[i + 3].trim() === 'ENTITIES') {
        inEntities = true;
        i += 3;
        continue;
      }
    }

    if (code === '0' && value === 'ENDSEC') {
      if (inEntities) {
        if (current) entities.push(current);
        current = null;
        inEntities = false;
      }
      continue;
    }

    if (!inEntities) continue;

    if (code === '0') {
      if (current) entities.push(current);
      current = { type: value, properties: {} };
      i++;
      continue;
    }

    if (current) {
      const groupCode = parseInt(code, 10);
      if (!Number.isNaN(groupCode)) {
        // Store numeric values for coordinate group codes
        if (groupCode >= 10 && groupCode <= 39) {
          current.properties[groupCode] = parseFloat(value) || 0;
        } else if (groupCode === 1 || groupCode === 3) {
          // Text values
          current.properties[groupCode] = value;
        } else if (groupCode === 42) {
          current.properties[groupCode] = parseFloat(value) || 0;
        }
      }
      i++;
    }
  }

  if (current) entities.push(current);

  return { entities };
}

/**
 * Extract dimensions from DIMENSION entities.
 * DXF DIMENSION entities contain measurement values directly.
 *
 * Group codes for DIMENSION:
 *   13, 23 — first definition point
 *   14, 24 — second definition point
 *   42     — actual measurement value (if present)
 *   1      — text override
 *
 * @param {Array} entities
 * @returns {{ values: number[], method: string } | null}
 */
function extractFromDimensions(entities) {
  const dims = entities.filter((e) => e.type === 'DIMENSION');
  if (dims.length === 0) return null;

  const values = [];
  for (const dim of dims) {
    const p = dim.properties;
    // Prefer explicit measurement value (group code 42)
    if (p[42] != null && p[42] > 0) {
      values.push(p[42]);
      continue;
    }
    // Try text override (group code 1)
    if (p[1]) {
      const num = parseFloat(String(p[1]).replace(',', '.'));
      if (Number.isFinite(num) && num > 0) {
        values.push(num);
        continue;
      }
    }
    // Calculate from definition points
    const x1 = p[13] || 0;
    const y1 = p[23] || 0;
    const x2 = p[14] || 0;
    const y2 = p[24] || 0;
    const dist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    if (dist > 0) values.push(Math.round(dist * 100) / 100);
  }

  if (values.length === 0) return null;
  return { values, method: 'DIMENSION' };
}

/**
 * Extract dimensions from bounding box of LINE/POLYLINE entities.
 * Fallback when no DIMENSION entities are present.
 *
 * @param {Array} entities
 * @returns {{ values: number[], method: string } | null}
 */
function extractFromBbox(entities) {
  const geometricTypes = ['LINE', 'POLYLINE', 'LWPOLYLINE', 'CIRCLE', 'ARC'];
  const geom = entities.filter((e) => geometricTypes.includes(e.type));
  if (geom.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const ent of geom) {
    const p = ent.properties;
    // Start point (10, 20)
    if (p[10] != null) {
      if (p[10] < minX) minX = p[10];
      if (p[10] > maxX) maxX = p[10];
    }
    if (p[20] != null) {
      if (p[20] < minY) minY = p[20];
      if (p[20] > maxY) maxY = p[20];
    }
    // End point (11, 21) — for LINE entities
    if (p[11] != null) {
      if (p[11] < minX) minX = p[11];
      if (p[11] > maxX) maxX = p[11];
    }
    if (p[21] != null) {
      if (p[21] < minY) minY = p[21];
      if (p[21] > maxY) maxY = p[21];
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;

  const width = Math.round(Math.abs(maxX - minX) * 100) / 100;
  const height = Math.round(Math.abs(maxY - minY) * 100) / 100;
  const values = [width, height].filter((v) => v > 0);

  if (values.length === 0) return null;
  return { values, method: 'bbox' };
}

/**
 * Extract dimension values from DXF content.
 * Prefers DIMENSION entities over bounding-box calculation.
 *
 * @param {string} dxfContent — raw DXF file text
 * @returns {{ values: number[], method: string, error: string | null }}
 */
function extractDimensions(dxfContent) {
  const parsed = parseDxfContent(dxfContent);
  if (parsed.entities.length === 0) {
    return { values: [], method: null, error: 'DXF-файл не содержит сущностей' };
  }

  // Prefer DIMENSION entities (explicit measurements)
  const fromDimension = extractFromDimensions(parsed.entities);
  if (fromDimension) {
    return { ...fromDimension, error: null };
  }

  // Fallback to bounding box
  const fromBbox = extractFromBbox(parsed.entities);
  if (fromBbox) {
    return { ...fromBbox, error: null };
  }

  return { values: [], method: null, error: 'Не удалось извлечь размеры из DXF' };
}

/**
 * Convert extracted DXF dimensions to the standard product dimensions format.
 *
 * @param {{ values: number[], method: string }} extracted
 * @returns {{ value: {length: number, width: number, thickness: number} | null, error: string | null, method: string }}
 */
function toDimensions(extracted) {
  if (!extracted || !extracted.values || extracted.values.length === 0) {
    return { value: null, error: extracted ? extracted.error : 'нет данных', method: null };
  }

  const sorted = [...extracted.values].sort((a, b) => b - a);
  const length = sorted[0] || 0;
  const width = sorted[1] || 0;
  const thickness = sorted[2] || 0;

  return {
    value: { length, width, thickness },
    error: null,
    method: extracted.method
  };
}

/**
 * Parse DXF file content and return product dimensions.
 *
 * @param {string} dxfContent — raw DXF file content
 * @returns {{ value: {length: number, width: number, thickness: number} | null, error: string | null, method: string }}
 */
function parseDxfDimensions(dxfContent) {
  const extracted = extractDimensions(dxfContent);
  return toDimensions(extracted);
}

module.exports = {
  parseDxfContent,
  extractFromDimensions,
  extractFromBbox,
  extractDimensions,
  toDimensions,
  parseDxfDimensions
};
