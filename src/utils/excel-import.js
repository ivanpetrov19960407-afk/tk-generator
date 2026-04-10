'use strict';

const DEFAULT_COLUMN_HINTS = {
  position: ['№', 'No', 'N', 'Номер', 'Позиция', 'Поз.', 'Поз'],
  name: ['Наименование', 'Наименование изделия', 'Название'],
  texture: ['Фактура', 'Поверхность', 'Обработка'],
  dimensions: ['Габаритные размеры', 'Размеры', 'Габариты'],
  unit: ['Ед. изм.', 'Единица измерения', 'Ед изм', 'Ед.изм.'],
  quantity: ['Кол-во', 'Количество', 'Объём'],
  controlPrice: ['Контрольная цена', 'Цена за ед.изм. с НДС', 'Контрольная цена за ед.изм. с НДС']
};

const REQUIRED_COLUMNS = ['position', 'name', 'texture', 'dimensions', 'unit', 'quantity'];

function normalizeHeaderName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[ё]/g, 'е')
    .replace(/\s+/g, ' ')
    .replace(/[.:]/g, '');
}

function parseDimensions(dimStr) {
  if (!dimStr) return { value: null, error: 'пустое значение' };

  let s = String(dimStr).replace(/мм|mm/gi, '').trim();
  s = s.replace(/[HhНн]/g, '');

  const splitByDelimiter = s.split(/[хxX×]/);
  if (splitByDelimiter.length < 3) {
    if (/^\d{6,}$/.test(s.replace(/\s/g, ''))) {
      return {
        value: null,
        error: `строка "${dimStr}" не содержит разделителей (ожидается формат 700x700x30)`
      };
    }
    return { value: null, error: `ожидается 3 размера через "x/х/×", получено: "${dimStr}"` };
  }

  const nums = splitByDelimiter
    .map((p) => parseFloat(String(p).trim().replace(',', '.')))
    .filter((n) => !Number.isNaN(n));

  if (nums.length < 3) {
    return { value: null, error: `не удалось выделить 3 числа из "${dimStr}"` };
  }

  nums.sort((a, b) => b - a);
  return {
    value: { length: nums[0], width: nums[1], thickness: nums[2] },
    error: null
  };
}

function resolveExcelMapping(headerRow, mapping) {
  const normalizedHeaders = headerRow.map(normalizeHeaderName);

  function resolveByHints(key) {
    const hints = DEFAULT_COLUMN_HINTS[key] || [];
    for (const hint of hints) {
      const idx = normalizedHeaders.indexOf(normalizeHeaderName(hint));
      if (idx !== -1) return idx;
    }
    return -1;
  }

  const resolved = {};
  for (const key of Object.keys(DEFAULT_COLUMN_HINTS)) {
    const explicit = mapping ? mapping[key] : undefined;
    if (typeof explicit === 'number') {
      resolved[key] = explicit;
      continue;
    }

    if (typeof explicit === 'string') {
      const byName = normalizedHeaders.indexOf(normalizeHeaderName(explicit));
      resolved[key] = byName;
      continue;
    }

    resolved[key] = resolveByHints(key);
  }

  return resolved;
}

function validateRequiredColumns(mapping) {
  const missing = REQUIRED_COLUMNS.filter((key) => mapping[key] === -1 || mapping[key] === undefined);
  return {
    ok: missing.length === 0,
    missing
  };
}

function loadMappingArg(mappingArg) {
  if (!mappingArg) return null;
  try {
    return JSON.parse(mappingArg);
  } catch (_) {
    return null;
  }
}

module.exports = {
  DEFAULT_COLUMN_HINTS,
  REQUIRED_COLUMNS,
  normalizeHeaderName,
  parseDimensions,
  resolveExcelMapping,
  validateRequiredColumns,
  loadMappingArg
};
