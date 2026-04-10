'use strict';

const assert = require('assert');
const {
  compareVersions,
  normalizeVersion,
  resolvePlatformAssetName,
  parseIntervalToMs,
  shouldCheckAutoUpdate
} = require('../src/self-update');

(function run() {
  assert.strictEqual(normalizeVersion('v1.2.3'), '1.2.3');
  assert.strictEqual(compareVersions('1.0.1', '1.0.0'), 1);
  assert.strictEqual(compareVersions('1.0.0', '1.0.0'), 0);
  assert.strictEqual(compareVersions('1.0.0', '1.1.0'), -1);
  assert.strictEqual(resolvePlatformAssetName('win32', 'x64'), 'tk-generator-windows-x64.zip');
  assert.strictEqual(resolvePlatformAssetName('linux', 'x64'), null);
  assert.strictEqual(parseIntervalToMs('24h'), 24 * 60 * 60 * 1000);
  assert.strictEqual(parseIntervalToMs('15m'), 15 * 60 * 1000);
  assert.strictEqual(shouldCheckAutoUpdate({
    interval: '24h',
    now: 2000,
    stateFilePath: '/tmp/non-existing-tkg-auto-update-state.json'
  }), true);
  console.log('self-update.test.js passed');
})();
