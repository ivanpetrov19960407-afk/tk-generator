'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function hashInput(payload) {
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function createManifest(outputDir, fileName) {
  const filePath = path.join(outputDir, fileName);
  let state = {};
  if (fs.existsSync(filePath)) {
    try {
      state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
      state = {};
    }
  }

  function hasFresh(key, hash, outputFilePath) {
    return Boolean(outputFilePath && fs.existsSync(outputFilePath) && state[key] && state[key].hash === hash);
  }

  function update(key, hash, outputFilePath) {
    state[key] = { hash, outputFilePath, updatedAt: new Date().toISOString() };
  }

  function flush() {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
  }

  return { hasFresh, update, flush, filePath };
}

module.exports = {
  hashInput,
  createManifest
};
