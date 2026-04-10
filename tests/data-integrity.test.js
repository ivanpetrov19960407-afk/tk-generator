#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const operationsLibraryPath = path.join(__dirname, '..', 'data', 'operations_library.json');
const rkmNormsPath = path.join(__dirname, '..', 'data', 'rkm_norms.json');

function readJsonOrThrow(filePath) {
  assert(fs.existsSync(filePath), `Required file is missing: ${filePath}`);
  const raw = fs.readFileSync(filePath, 'utf8');
  assert(raw.trim().length > 0, `Required file is empty: ${filePath}`);

  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${filePath}: ${err.message}`);
  }
}

function sortedUniqueNumbers(values) {
  return [...new Set(values.map(Number))].sort((a, b) => a - b);
}

(function run() {
  const operationsLibrary = readJsonOrThrow(operationsLibraryPath);
  const rkmNorms = readJsonOrThrow(rkmNormsPath);

  const textureKeys = Object.keys(operationsLibrary);
  assert(textureKeys.length > 0, 'operations_library.json should contain texture sections');

  const norms = rkmNorms.operations;
  assert(Array.isArray(norms), 'rkm_norms.json should contain operations array');
  assert(norms.length > 0, 'rkm_norms.json operations array should not be empty');

  const normsNumbers = sortedUniqueNumbers(norms.map((op) => op.no));
  assert.strictEqual(normsNumbers.length, norms.length, 'rkm_norms operations numbers should be unique');
  assert(normsNumbers.every((n) => Number.isInteger(n) && n > 0), 'rkm_norms operation numbers should be positive integers');

  for (const textureKey of textureKeys) {
    const operationMap = operationsLibrary[textureKey];
    assert(operationMap && typeof operationMap === 'object', `Texture section "${textureKey}" should be an object`);

    const libNumbers = sortedUniqueNumbers(Object.keys(operationMap));
    assert(libNumbers.length > 0, `Texture section "${textureKey}" should contain operations`);
    assert(libNumbers.every((n) => Number.isInteger(n) && n > 0), `Texture section "${textureKey}" operation keys should be positive integers`);

    for (const normNo of normsNumbers) {
      assert(
        libNumbers.includes(normNo),
        `operations_library texture "${textureKey}" is missing operation #${normNo} from rkm_norms`
      );
    }

    assert(
      libNumbers.length >= normsNumbers.length,
      `Texture section "${textureKey}" should contain at least as many operations as rkm_norms`
    );
  }

  console.log('data integrity tests passed');
})();
