'use strict';

const assert = require('assert');
const {
  compareVersions,
  normalizeVersion,
  resolvePlatformAssetName
} = require('../src/self-update');

(function run() {
  assert.strictEqual(normalizeVersion('v1.2.3'), '1.2.3');
  assert.strictEqual(compareVersions('1.0.1', '1.0.0'), 1);
  assert.strictEqual(compareVersions('1.0.0', '1.0.0'), 0);
  assert.strictEqual(compareVersions('1.0.0', '1.1.0'), -1);
  assert.strictEqual(resolvePlatformAssetName('win32', 'x64'), 'tk-generator-windows-x64.zip');
  assert.strictEqual(resolvePlatformAssetName('linux', 'x64'), null);
  console.log('self-update.test.js passed');
})();
