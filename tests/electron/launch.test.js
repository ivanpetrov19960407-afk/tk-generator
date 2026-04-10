'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');

let electronPath;
try {
  electronPath = require('electron');
} catch (_error) {
  console.log('SKIP: electron dependency is not installed in this environment.');
  process.exit(0);
}

const result = spawnSync(
  electronPath,
  ['desktop/main.js'],
  {
    env: {
      ...process.env,
      TK_ELECTRON_SMOKE: '1'
    },
    encoding: 'utf8',
    timeout: 30000
  }
);

assert.strictEqual(result.status, 0, `Expected status 0, got ${result.status}. stderr: ${result.stderr}`);
assert.match(result.stdout, /WINDOW_READY/, `Expected WINDOW_READY marker. stdout: ${result.stdout}`);

console.log('OK: Electron window launch smoke test passed.');
