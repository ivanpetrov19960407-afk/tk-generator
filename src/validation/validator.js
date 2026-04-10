'use strict';

const { normalizeUnit } = require('../utils/unit-normalizer');
const { getSupportedTextures, formatSupportedTextures } = require('../textures');

function isPositiveNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function validateProduct(product, options = {}) {
  const unknownUnitPolicy = options.unknownUnitPolicy || 'warning';
  const errors = [];
  const warnings = [];

  if (!product || typeof product !== 'object' || Array.isArray(product)) {
    return { valid: false, errors: ['[product] /: должен быть объектом'], warnings };
  }

  if (!product.name || typeof product.name !== 'string') {
    errors.push('[product] /name: обязательное строковое поле');
  }

  if (!product.dimensions || typeof product.dimensions !== 'object') {
    errors.push('[product] /dimensions: обязательный объект');
  } else {
    if (!isPositiveNumber(product.dimensions.length)) {
      errors.push('[product] /dimensions/length: должно быть числом > 0');
    }
    if (!isPositiveNumber(product.dimensions.width)) {
      errors.push('[product] /dimensions/width: должно быть числом > 0');
    }
    if (!isPositiveNumber(product.dimensions.thickness)) {
      errors.push('[product] /dimensions/thickness: должно быть числом > 0');
    }
  }

  if (!product.material || typeof product.material !== 'object') {
    errors.push('[product] /material: обязательный объект');
  } else {
    if (!product.material.type || typeof product.material.type !== 'string') {
      errors.push('[product] /material/type: обязательное строковое поле');
    }
    if (!product.material.name || typeof product.material.name !== 'string') {
      errors.push('[product] /material/name: обязательное строковое поле');
    }
    if (product.material.density != null && !isPositiveNumber(product.material.density)) {
      errors.push('[product] /material/density: если задано, должно быть числом > 0');
    }
  }

  if (!product.texture || typeof product.texture !== 'string') {
    errors.push('[product] /texture: обязательное строковое поле');
  } else if (!getSupportedTextures().includes(product.texture)) {
    errors.push(`Неизвестная фактура: "${product.texture}". Допустимые: ${formatSupportedTextures()}`);
  }

  if (product.quantity_pieces != null && !isPositiveNumber(product.quantity_pieces)) {
    errors.push('[product] /quantity_pieces: если задано, должно быть числом > 0');
  }

  if (product.control_unit != null) {
    const normalized = normalizeUnit(product.control_unit);
    if (normalized.measurement_type === 'unknown') {
      const msg = `Нераспознанная единица измерения control_unit="${product.control_unit}"`;
      if (unknownUnitPolicy === 'error') errors.push(msg);
      else warnings.push(msg);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateProducts(products, options = {}) {
  if (!Array.isArray(products)) {
    return { valid: false, errors: ['Ожидается массив products[].'], warnings: [] };
  }

  const report = { valid: true, errors: [], warnings: [] };
  products.forEach((product, idx) => {
    const res = validateProduct(product, options);
    if (!res.valid) report.valid = false;
    res.errors.forEach((e) => report.errors.push(`[product ${idx + 1}] ${e}`));
    res.warnings.forEach((w) => report.warnings.push(`[product ${idx + 1}] ${w}`));
  });

  return report;
}

function validateBatchInput(data, options = {}) {
  if (Array.isArray(data)) return validateProducts(data, options);

  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, errors: ['[batch] /: должен быть объектом'], warnings: [] };
  }
  if (!Array.isArray(data.products)) {
    errors.push('[batch] /products: обязательный массив');
    return { valid: false, errors, warnings: [] };
  }

  const productsReport = validateProducts(data.products, options);
  return {
    valid: errors.length === 0 && productsReport.valid,
    errors: [...errors, ...productsReport.errors],
    warnings: productsReport.warnings
  };
}

function validateProductOrThrow(product, options = {}) {
  const result = validateProduct(product, options);
  if (!result.valid) {
    throw new Error(`Ошибки валидации продукта:\n  - ${result.errors.join('\n  - ')}`);
  }
  return result;
}

module.exports = {
  validateProduct,
  validateProducts,
  validateBatchInput,
  validateProductOrThrow
};
