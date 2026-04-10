'use strict';

const fs = require('fs');
const path = require('path');
const { resolveRuntimeDir } = require('../runtime-paths');
const i18n = require('../i18n');

const DEFAULT_CONFIG_DIR = resolveRuntimeDir('config');

const DEFAULT_CONFIG = {
  locale: 'ru',
  company: {
    name: 'ООО «Название компании»',
    address: 'Юридический адрес',
    INN: '0000000000',
    KPP: '000000000',
    rs: '00000000000000000000',
    bank: 'Название банка',
    ks: '00000000000000000000',
    BIK: '000000000',
    tel: '+7 000 000 00 00',
    email: 'info@example.com'
  },
  rkm: {
    logisticsDefaults: {
      distance_km: 940,
      tariff_rub_km: 120,
      trips: 1,
      loading: 25000,
      unloading: 35000,
      insurance_pct: 0.005
    },
    skipTransportTkNumbers: [36, 28, 29, 27, 30, 9, 10],
    specialMaterialRules: {
      'габбро-диабаз': {
        detectKeywords: ['габбро'],
        k_reject: 1.08,
        block_price: 40000,
        skipOperations: [10, 13, 14, 15, 19, 22],
        material_prices: {
          diamond_discs: 2000,
          diamond_milling_heads: 1500,
          bush_hammer_heads_price: 2000,
          abrasives: 1,
          coolant_chemistry: 1,
          protective_materials: 1,
          packaging: 5,
          marking: 1,
          ppe: 1
        }
      }
    }
  },
  cost: {
    paths: {}
  }
};

let currentConfig = deepClone(DEFAULT_CONFIG);

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (!isObject(base) || !isObject(override)) return override;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (Array.isArray(value)) {
      out[key] = value.slice();
    } else if (isObject(value) && isObject(base[key])) {
      out[key] = deepMerge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function readConfigFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const ext = path.extname(filePath).toLowerCase();
  const raw = fs.readFileSync(filePath, 'utf8');
  if (ext === '.json') {
    return JSON.parse(raw);
  }
  if (ext === '.yaml' || ext === '.yml') {
    let yaml;
    try {
      yaml = require('yaml');
    } catch (err) {
      throw new Error(`YAML конфиг ${filePath} не поддерживается: установите пакет "yaml" или используйте JSON.`);
    }
    return yaml.parse(raw);
  }
  throw new Error(`Неподдерживаемый формат конфига: ${filePath}`);
}

function applyEnvOverrides(config, env = process.env) {
  let out = deepClone(config);

  const jsonOverride = env.TKG_CONFIG_JSON;
  if (jsonOverride) {
    out = deepMerge(out, JSON.parse(jsonOverride));
  }

  const companyFields = ['name', 'address', 'INN', 'KPP', 'rs', 'bank', 'ks', 'BIK', 'tel', 'email'];
  companyFields.forEach((field) => {
    const key = `TKG_COMPANY_${field.toUpperCase()}`;
    if (env[key]) out.company[field] = env[key];
  });

  const logistics = out.rkm.logisticsDefaults;
  if (env.TKG_LOGISTICS_DISTANCE_KM) logistics.distance_km = Number(env.TKG_LOGISTICS_DISTANCE_KM);
  if (env.TKG_LOGISTICS_TARIFF_RUB_KM) logistics.tariff_rub_km = Number(env.TKG_LOGISTICS_TARIFF_RUB_KM);
  if (env.TKG_LOGISTICS_TRIPS) logistics.trips = Number(env.TKG_LOGISTICS_TRIPS);
  if (env.TKG_LOGISTICS_LOADING) logistics.loading = Number(env.TKG_LOGISTICS_LOADING);
  if (env.TKG_LOGISTICS_UNLOADING) logistics.unloading = Number(env.TKG_LOGISTICS_UNLOADING);
  if (env.TKG_LOGISTICS_INSURANCE_PCT) logistics.insurance_pct = Number(env.TKG_LOGISTICS_INSURANCE_PCT);

  if (env.TKG_SKIP_TRANSPORT_TK_NUMBERS) {
    out.rkm.skipTransportTkNumbers = env.TKG_SKIP_TRANSPORT_TK_NUMBERS
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isFinite(v));
  }

  return out;
}

function validateConfig(config) {
  if (!isObject(config)) throw new Error('Конфиг должен быть объектом.');
  if (config.locale != null && typeof config.locale !== 'string') {
    throw new Error('config.locale должен быть строкой.');
  }
  if (!isObject(config.company)) throw new Error('config.company должен быть объектом.');
  if (!isObject(config.rkm)) throw new Error('config.rkm должен быть объектом.');
  if (!isObject(config.rkm.logisticsDefaults)) throw new Error('config.rkm.logisticsDefaults должен быть объектом.');
  const numFields = ['distance_km', 'tariff_rub_km', 'trips', 'loading', 'unloading', 'insurance_pct'];
  numFields.forEach((f) => {
    if (!Number.isFinite(Number(config.rkm.logisticsDefaults[f]))) {
      throw new Error(`config.rkm.logisticsDefaults.${f} должен быть числом.`);
    }
  });
  if (!Array.isArray(config.rkm.skipTransportTkNumbers)) {
    throw new Error('config.rkm.skipTransportTkNumbers должен быть массивом.');
  }
  if (!isObject(config.rkm.specialMaterialRules)) {
    throw new Error('config.rkm.specialMaterialRules должен быть объектом.');
  }
  if (config.cost != null && !isObject(config.cost)) {
    throw new Error('config.cost должен быть объектом.');
  }
  if (config.cost && config.cost.paths != null && !isObject(config.cost.paths)) {
    throw new Error('config.cost.paths должен быть объектом.');
  }
}

function loadConfig(options = {}) {
  const configDir = options.configDir ? path.resolve(options.configDir) : DEFAULT_CONFIG_DIR;
  const configPath = options.configPath ? path.resolve(options.configPath) : null;

  let merged = deepClone(DEFAULT_CONFIG);

  const defaultFile = path.join(configDir, 'default.json');
  const localFile = path.join(configDir, 'local.json');

  merged = deepMerge(merged, readConfigFile(defaultFile));
  merged = deepMerge(merged, readConfigFile(localFile));

  if (configPath) {
    if (!fs.existsSync(configPath)) {
      throw new Error(`Файл конфига не найден: ${configPath}`);
    }
    merged = deepMerge(merged, readConfigFile(configPath));
  }

  merged = applyEnvOverrides(merged, options.env || process.env);
  validateConfig(merged);
  i18n.setLocale(merged.locale || 'ru');
  currentConfig = merged;

  return currentConfig;
}

function getConfig() {
  return currentConfig;
}

module.exports = {
  loadConfig,
  getConfig,
  deepMerge,
  validateConfig
};
