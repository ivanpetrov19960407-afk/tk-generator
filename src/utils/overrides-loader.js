'use strict';

const fs = require('fs');
const path = require('path');

function readJsonFileStrict(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Файл overrides не найден: ${filePath}`);
    }
    if (err instanceof SyntaxError) {
      throw new Error(`Некорректный JSON в overrides-файле: ${filePath} (${err.message})`);
    }
    throw new Error(`Не удалось прочитать overrides-файл: ${filePath} (${err.message})`);
  }
}

function normalizeOperationNumber(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function normalizePatch(patch) {
  if (!patch || typeof patch !== 'object') return { drop_operations: [], replace_fields: {} };

  const drop_operations = Array.isArray(patch.drop_operations)
    ? patch.drop_operations.map(normalizeOperationNumber).filter((n) => n != null)
    : [];

  const replace_fields = {};
  if (patch.replace_fields && typeof patch.replace_fields === 'object') {
    for (const [opNoRaw, fields] of Object.entries(patch.replace_fields)) {
      const opNo = normalizeOperationNumber(opNoRaw);
      if (opNo == null || !fields || typeof fields !== 'object') continue;
      replace_fields[opNo] = fields;
    }
  }

  return { drop_operations, replace_fields };
}

function matchRule(product, rule) {
  if (!rule || typeof rule !== 'object') return false;
  const match = rule.match || {};

  if (match.texture && product.texture !== match.texture) return false;
  if (match.material_type && (product.material && product.material.type) !== match.material_type) return false;
  if (match.material_name && (product.material && product.material.name) !== match.material_name) return false;
  if (match.geometry_type && product.geometry_type !== match.geometry_type) return false;

  if (match.name_regex) {
    const re = new RegExp(match.name_regex, 'i');
    if (!re.test(String(product.name || ''))) return false;
  }

  return true;
}

function loadOverridesFile(filePath) {
  if (!filePath) return null;

  const resolved = path.resolve(filePath);
  const data = readJsonFileStrict(resolved);

  if (!data || typeof data !== 'object') {
    throw new Error(`Некорректный формат overrides-файла: ${resolved}`);
  }
  if (data.version !== 1) {
    throw new Error(`Неподдерживаемая версия overrides: ${data.version}. Ожидается version=1 (файл: ${resolved})`);
  }
  if (!Array.isArray(data.rules)) {
    throw new Error(`Поле "rules" должно быть массивом (файл: ${resolved})`);
  }

  return {
    sourcePath: resolved,
    version: data.version,
    rules: data.rules
  };
}

function resolveOverridesPath(product, cliOverridesPath) {
  if (cliOverridesPath) return cliOverridesPath;
  if (product && product.overrides_path) return product.overrides_path;
  if (product && product.overrides && typeof product.overrides === 'object' && product.overrides.path) {
    return product.overrides.path;
  }
  return null;
}

function applyPatch(operations, patch, warnings, sourceLabel) {
  const normalized = normalizePatch(patch);
  let result = operations.slice();

  for (const opNo of normalized.drop_operations) {
    const exists = result.some((op) => op.number === opNo);
    if (!exists) {
      warnings.push(`[overrides] ${sourceLabel}: операция №${opNo} не найдена для удаления, действие пропущено`);
      continue;
    }
    result = result.filter((op) => op.number !== opNo);
  }

  for (const [opNoRaw, fields] of Object.entries(normalized.replace_fields)) {
    const opNo = Number(opNoRaw);
    const idx = result.findIndex((op) => op.number === opNo);
    if (idx === -1) {
      warnings.push(`[overrides] ${sourceLabel}: операция №${opNo} не найдена для замены полей, действие пропущено`);
      continue;
    }

    const patchFields = { ...fields };
    if (patchFields.name != null && patchFields.title == null) patchFields.title = patchFields.name;
    if (patchFields.comment != null && patchFields.text == null) patchFields.text = patchFields.comment;

    result[idx] = {
      ...result[idx],
      ...patchFields
    };
  }

  return result;
}

function applyOverridesToOperations(operations, product, loadedOverrides) {
  if (!loadedOverrides) return { operations: operations.slice(), warnings: [] };

  const warnings = [];
  let result = operations.slice();

  loadedOverrides.rules.forEach((rule, i) => {
    if (!matchRule(product, rule)) return;
    result = applyPatch(result, rule.patch, warnings, `${path.basename(loadedOverrides.sourcePath)}:rule#${i + 1}`);
  });

  return { operations: result, warnings };
}

function applyManualProductOverrides(operations, product) {
  const warnings = [];
  if (!product || !product.operation_overrides) {
    return { operations: operations.slice(), warnings };
  }

  const result = applyPatch(operations, product.operation_overrides, warnings, 'product.operation_overrides');
  return { operations: result, warnings };
}

module.exports = {
  resolveOverridesPath,
  loadOverridesFile,
  applyOverridesToOperations,
  applyManualProductOverrides
};
