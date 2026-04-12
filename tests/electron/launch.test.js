'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const path = require('path');
const repoRoot = path.resolve(__dirname, '../..');
const appPath = path.join(repoRoot, 'desktop', 'main.js');

let electronPath;
try {
  electronPath = require(path.join(repoRoot, 'desktop', 'node_modules', 'electron'));
} catch (_error) {
  console.log('SKIP: electron dependency is not installed in this environment.');
  process.exit(0);
}

const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-electron-smoke-'));
const markerPath = path.join(markerDir, 'ready.txt');

try {
  const result = spawnSync(
    electronPath,
    ['--tk-electron-smoke', `--tk-electron-smoke-marker=${markerPath}`, appPath],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        TK_ELECTRON_SMOKE: '1',
        TK_ELECTRON_SMOKE_MARKER: markerPath
      },
      encoding: 'utf8',
      timeout: 30000
    }
  );

  const failureDetails = [
    `Expected status 0, got ${result.status}.`,
    `signal: ${result.signal || 'none'}`,
    `error: ${result.error ? result.error.message : 'none'}`,
    `stdout: ${result.stdout || ''}`,
    `stderr: ${result.stderr || ''}`
  ].join('\n');
  assert.strictEqual(result.status, 0, failureDetails);

  const markerText = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf8') : '';
  assert.match(
    `${result.stdout}\n${markerText}`,
    /WINDOW_READY/,
    `Expected WINDOW_READY marker. stdout: ${result.stdout}`
  );

  console.log('OK: Electron window launch smoke test passed.');
} finally {
  fs.rmSync(markerDir, { recursive: true, force: true });
}
