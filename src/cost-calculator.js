'use strict';

/**
 * cost-calculator.js — расчёт себестоимости по операциям.
 */

const fs = require('fs');
const path = require('path');
const { getConfig } = require('./config');

const COST_PREFIX = '[COST]';
const COSTS_DIR = path.join(__dirname, '..', 'data', 'costs');
const NORMS_PATH = path.join(__dirname, '..', 'data', 'rkm_norms.json');

const ROUND_PRECISION = 100;
const calculationCache = new Map();

function roundMoney(value) {
  return Math.round((Number(value) || 0) * ROUND_PRECISION) / ROUND_PRECISION;
}

function formatMoneyRu(value) {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(roundMoney(value));
}

function readJsonRequired(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Не найден файл данных: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadCostData(options = {}) {
  const cfg = getConfig();
  const cfgPaths = (cfg.cost && cfg.cost.paths) || {};
  const laborRatesPath = options.laborRatesPath || cfgPaths.laborRatesPath || path.join(COSTS_DIR, 'labor_rates.json');
  const equipmentCostsPath = options.equipmentCostsPath || cfgPaths.equipmentCostsPath || path.join(COSTS_DIR, 'equipment_costs.json');
  const materialPricesPath = options.materialPricesPath || cfgPaths.materialPricesPath || path.join(COSTS_DIR, 'material_prices.json');
  const overheadPath = options.overheadPath || cfgPaths.overheadPath || path.join(COSTS_DIR, 'overhead.json');

  const laborRates = readJsonRequired(laborRatesPath);
  const equipmentCosts = readJsonRequired(equipmentCostsPath);
  const materialPrices = readJsonRequired(materialPricesPath);
  const overhead = readJsonRequired(overheadPath);
  const norms = readJsonRequired(NORMS_PATH);

  return {
    laborRates,
    equipmentCosts,
    materialPrices,
    overhead,
    norms: norms.operations || []
  };
}

function resolveOperation(product, operationNumber, norms) {
  const operation = norms.find((item) => item.no === operationNumber);
  if (!operation) {
    throw new Error(`Операция №${operationNumber} не найдена в data/rkm_norms.json`);
  }

  const overrides = product.rkm && product.rkm.norms_override ? product.rkm.norms_override[String(operationNumber)] || product.rkm.norms_override[operationNumber] : null;

  const laborHours = Number(overrides && overrides.chel_ch != null ? overrides.chel_ch : operation.base_chel_ch);
  const machineHours = Number(overrides && overrides.mash_ch != null ? overrides.mash_ch : operation.base_mash_ch);

  if (!Number.isFinite(laborHours) || laborHours < 0) {
    throw new Error(`Некорректные трудозатраты в операции №${operationNumber}: ${laborHours}`);
  }
  if (!Number.isFinite(machineHours) || machineHours < 0) {
    throw new Error(`Некорректное машинное время в операции №${operationNumber}: ${machineHours}`);
  }

  return {
    operation,
    laborHours,
    machineHours
  };
}

function getMaterialCostForOperation(materialPrices, operationNumber) {
  const byOperation = materialPrices.by_operation || {};
  const fallback = materialPrices.default_per_operation || 0;
  const opCost = byOperation[String(operationNumber)];
  return roundMoney(opCost != null ? Number(opCost) : Number(fallback));
}

/**
 * Расчёт себестоимости операции.
 * @param {Object} product - Изделие.
 * @param {number} operationNumber - Номер операции.
 * @param {Object} [options] - Опции загрузки тарифов.
 * @returns {Object} Детализация стоимости операции.
 */
function calculateCostByOperation(product, operationNumber, options = {}) {
  const { laborRates, equipmentCosts, materialPrices, norms } = loadCostData(options);
  const { operation, laborHours, machineHours } = resolveOperation(product, operationNumber, norms);

  const laborRatePerHour = Number(laborRates[operation.role] || laborRates.default || 0);
  const equipmentRatePerHour = Number(equipmentCosts[operation.equipment] || equipmentCosts.default || 0);

  const laborCost = roundMoney(laborHours * laborRatePerHour);
  const machineCost = roundMoney(machineHours * equipmentRatePerHour);
  const materialCost = getMaterialCostForOperation(materialPrices, operationNumber);
  const totalOperationCost = roundMoney(laborCost + machineCost + materialCost);

  return {
    operation_number: operation.no,
    operation_name: operation.name,
    labor_hours: roundMoney(laborHours),
    labor_cost: laborCost,
    machine_hours: roundMoney(machineHours),
    machine_cost: machineCost,
    material_cost: materialCost,
    total_operation_cost: totalOperationCost
  };
}

function buildOperationsCacheKey(product, operationCosts) {
  return JSON.stringify({
    tk_number: product.tk_number,
    name: product.name,
    quantity_pieces: product.quantity_pieces,
    dimensions: product.dimensions,
    texture: product.texture,
    overrides: product.rkm && product.rkm.norms_override ? product.rkm.norms_override : null,
    opTotals: operationCosts.map((item) => item.total_operation_cost)
  });
}

/**
 * Расчёт наценки.
 * @param {number} baseCost - Базовая себестоимость.
 * @param {number} markupPercent - Процент наценки.
 * @returns {{markup_percent:number, markup_amount:number, selling_price:number}}
 */
function calculateMarkup(baseCost, markupPercent) {
  const safePercent = Number.isFinite(Number(markupPercent)) ? Number(markupPercent) : 0;
  const markupAmount = roundMoney(Number(baseCost) * (safePercent / 100));
  return {
    markup_percent: safePercent,
    markup_amount: markupAmount,
    selling_price: roundMoney(Number(baseCost) + markupAmount)
  };
}

/**
 * Расчёт контрольной цены по коэффициенту.
 * @param {number} baseCost - Базовая себестоимость.
 * @param {number} controlCoefficient - Коэффициент контроля.
 * @returns {number}
 */
function calculateControlPrice(baseCost, controlCoefficient) {
  if (!Number.isFinite(Number(controlCoefficient)) || Number(controlCoefficient) <= 0) {
    return roundMoney(baseCost);
  }
  return roundMoney(Number(baseCost) * Number(controlCoefficient));
}

/**
 * Полный расчёт себестоимости изделия.
 * @param {Object} product - Изделие.
 * @param {Object} [options] - Опции (override-файлы и параметры).
 * @returns {Object} Детализация себестоимости.
 */
function calculateTotalCost(product, options = {}) {
  const { overhead, norms } = loadCostData(options);

  const operationsCost = norms.map((operation) => calculateCostByOperation(product, operation.no, options));
  const cacheKey = buildOperationsCacheKey(product, operationsCost);
  const cached = calculationCache.get(cacheKey);

  const totalDirectCost = roundMoney(operationsCost.reduce((sum, item) => sum + item.total_operation_cost, 0));
  const overheadPercent = Number(overhead.percent || 0);
  const overheadCost = roundMoney(totalDirectCost * (overheadPercent / 100));
  const totalCost = roundMoney(totalDirectCost + overheadCost);

  const markupPercent = Number(product.markup_percent != null ? product.markup_percent : overhead.default_markup_percent || 0);
  const markup = calculateMarkup(totalCost, markupPercent);

  const controlCoefficient = Number(product.control_coefficient != null ? product.control_coefficient : overhead.default_control_coefficient || 1);
  const controlPrice = product.control_price != null
    ? roundMoney(product.control_price)
    : calculateControlPrice(totalCost, controlCoefficient);

  const marginDiff = roundMoney(markup.selling_price - controlPrice);
  const margin = Math.abs(marginDiff) <= roundMoney(totalCost * 0.05) ? 'WITHIN_CORRIDOR' : 'OUTSIDE_CORRIDOR';

  if (product.control_price != null && margin === 'OUTSIDE_CORRIDOR') {
    console.log(`${COST_PREFIX} Расхождение по контрольной цене (поз.${product.tk_number || 'n/a'}): расчётная ${formatMoneyRu(markup.selling_price)} ₽, контрольная ${formatMoneyRu(controlPrice)} ₽`);
  }

  const result = {
    product_id: product.tk_number || null,
    product_name: [product.name, product.dimensions ? `${product.dimensions.length}×${product.dimensions.width}×${product.dimensions.thickness}` : null].filter(Boolean).join(' '),
    created_at: new Date().toISOString(),
    operations_cost: cached ? cached.operations_cost : operationsCost,
    total_direct_cost: totalDirectCost,
    overhead_percent: overheadPercent,
    overhead_cost: overheadCost,
    total_cost: totalCost,
    markup_percent: markup.markup_percent,
    markup_amount: markup.markup_amount,
    selling_price: markup.selling_price,
    control_price: controlPrice,
    margin
  };

  calculationCache.set(cacheKey, {
    operations_cost: operationsCost
  });

  return result;
}

module.exports = {
  calculateCostByOperation,
  calculateTotalCost,
  calculateMarkup,
  calculateControlPrice,
  formatMoneyRu,
  roundMoney
};
