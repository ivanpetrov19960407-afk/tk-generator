'use strict';

const fs = require('fs');
const path = require('path');
const { resolveRuntimeDir } = require('./runtime-paths');

const DEFAULT_LOCALE = 'ru';
let currentLocale = DEFAULT_LOCALE;
const cache = new Map();

function loadLocale(locale) {
  if (cache.has(locale)) return cache.get(locale);

  const filePath = path.join(resolveRuntimeDir('data'), 'locales', `${locale}.json`);
  if (!fs.existsSync(filePath)) {
    cache.set(locale, {});
    return {};
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  cache.set(locale, parsed);
  return parsed;
}

function lookup(obj, key) {
  return key.split('.').reduce((acc, part) => {
    if (acc == null || typeof acc !== 'object') return undefined;
    return acc[part];
  }, obj);
}

function t(key, fallbackValue = key) {
  const localeData = loadLocale(currentLocale);
  const value = lookup(localeData, key);
  if (value !== undefined) return value;

  if (currentLocale !== DEFAULT_LOCALE) {
    const fallback = lookup(loadLocale(DEFAULT_LOCALE), key);
    if (fallback !== undefined) return fallback;
  }

  return fallbackValue;
}

function setLocale(locale) {
  if (!locale || typeof locale !== 'string') {
    currentLocale = DEFAULT_LOCALE;
    return currentLocale;
  }

  const normalized = locale.toLowerCase();
  currentLocale = normalized;
  return currentLocale;
}

function getLocale() {
  return currentLocale;
}

module.exports = {
  t,
  setLocale,
  getLocale,
  DEFAULT_LOCALE
};
