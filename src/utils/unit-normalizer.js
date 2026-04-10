'use strict';
const { logger } = require('../logger');

/**
 * unit-normalizer.js
 *
 * Нормализация единиц измерения и определение measurement_type.
 *
 * Канонические единицы:
 *   "м²"   — площадные (area)
 *   "м.п." — погонные  (length)
 *   "шт"   — штучные   (count)
 *
 * Если единица не распознана → measurement_type = "unknown", unit остаётся как есть.
 * Молчаливый fallback в "шт" ЗАПРЕЩЁН.
 */

// ---- Словарь нормализации (легко дополнять) ----

const UNIT_SYNONYMS = {
  // площадные → "м²"
  'м²': 'м²',
  'м2': 'м²',
  'кв.м.': 'м²',
  'кв.м': 'м²',
  'кв. м.': 'м²',
  'кв. м': 'м²',
  'м.кв.': 'м²',
  'м.кв': 'м²',
  'м кв': 'м²',
  'кв м': 'м²',
  'квм': 'м²',
  'sqm': 'м²',
  'sq.m': 'м²',
  'sq.m.': 'м²',

  // погонные → "м.п."
  'м.п.': 'м.п.',
  'м.п': 'м.п.',
  'мп': 'м.п.',
  'м п': 'м.п.',
  'пог.м.': 'м.п.',
  'пог.м': 'м.п.',
  'пог м': 'м.п.',
  'погм': 'м.п.',
  'м.пог.': 'м.п.',
  'м.пог': 'м.п.',
  'м пог': 'м.п.',
  'п.м.': 'м.п.',
  'п.м': 'м.п.',
  'пм': 'м.п.',
  'rm': 'м.п.',
  'r.m.': 'м.п.',

  // штучные → "шт"
  'шт': 'шт',
  'шт.': 'шт',
  'штук': 'шт',
  'штука': 'шт',
  'штуки': 'шт',
  'pcs': 'шт',
  'pc': 'шт',
};

// measurement_type по канонической единице
const UNIT_TO_TYPE = {
  'м²':   'area',
  'м.п.': 'length',
  'шт':   'count',
};

/**
 * Нормализует строку единицы измерения.
 *
 * @param {string} rawUnit — сырое значение из Excel/JSON
 * @returns {{ unit: string, measurement_type: string }}
 *   unit — каноническое значение ("м²" | "м.п." | "шт") или исходное если не распознано
 *   measurement_type — "area" | "length" | "count" | "unknown"
 */
function normalizeUnit(rawUnit) {
  if (rawUnit === null || rawUnit === undefined) {
    return { unit: null, measurement_type: 'unknown' };
  }

  const cleaned = String(rawUnit)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  // Точное совпадение по словарю
  if (UNIT_SYNONYMS[cleaned] !== undefined) {
    const canonical = UNIT_SYNONYMS[cleaned];
    return { unit: canonical, measurement_type: UNIT_TO_TYPE[canonical] };
  }

  // Эвристический поиск по подстрокам (fallback для нестандартных написаний)
  // Порядок важен: сначала более специфичные паттерны
  const s = cleaned.replace(/[.\s]/g, '');

  if (s.includes('кв') || s.includes('м²') || s === 'м2') {
    return { unit: 'м²', measurement_type: 'area' };
  }
  if (s.includes('пог') || s.includes('мп') || s.includes('пм')) {
    return { unit: 'м.п.', measurement_type: 'length' };
  }
  if (s === 'шт' || s === 'штук' || s === 'штука' || s === 'штуки') {
    return { unit: 'шт', measurement_type: 'count' };
  }

  // НЕ распознано — возвращаем "unknown", НЕ делаем fallback в "шт"
  return { unit: rawUnit.trim(), measurement_type: 'unknown' };
}

/**
 * Sanity-проверка: unit и measurement_type должны быть согласованы.
 * Бросает ошибку при несовместимости.
 *
 * @param {string} unit — каноническая единица
 * @param {string} measurementType — "area"/"length"/"count"/"unknown"
 * @param {string} [context] — контекст для сообщения об ошибке (напр. "Поз.5")
 */
function validateUnitConsistency(unit, measurementType, context) {
  const prefix = context ? `[${context}] ` : '';

  if (measurementType === 'unknown') {
    logger.warn({ context, unit }, `${prefix}ПРЕДУПРЕЖДЕНИЕ: нераспознанная единица измерения. Расчёт может быть некорректным.`);
    return;
  }

  const expectedType = UNIT_TO_TYPE[unit];
  if (expectedType && expectedType !== measurementType) {
    throw new Error(
      `${prefix}Несовместимость единицы и типа: unit="${unit}" (ожидается ${expectedType}), measurement_type="${measurementType}"`
    );
  }
}

/**
 * Проверка отклонения расчётной цены от контрольной.
 * Логирует предупреждение при отклонении > maxRatio.
 *
 * @param {number} calcPrice — расчётная цена
 * @param {number} controlPrice — контрольная цена
 * @param {string} unit — единица измерения
 * @param {string} [context] — контекст (напр. "Поз.5")
 * @param {number} [maxRatio=10] — порог отклонения
 * @returns {boolean} true если отклонение в норме
 */
function checkPriceDeviation(calcPrice, controlPrice, unit, context, maxRatio) {
  if (!controlPrice || controlPrice <= 0 || !calcPrice || calcPrice <= 0) return true;

  maxRatio = maxRatio || 10;
  const ratio = calcPrice / controlPrice;
  const prefix = context ? `[${context}] ` : '';

  if (ratio > maxRatio || ratio < (1 / maxRatio)) {
    logger.warn({
      context,
      calcPrice,
      controlPrice,
      unit,
      ratio
    }, `${prefix}ВНИМАНИЕ: расчётная цена отклоняется от контрольной. Возможна ошибка единицы измерения.`);
    return false;
  }
  return true;
}

module.exports = {
  normalizeUnit,
  validateUnitConsistency,
  checkPriceDeviation,
  UNIT_SYNONYMS,
  UNIT_TO_TYPE,
};
