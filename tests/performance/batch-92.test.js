#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function runCli(args) {
  const started = Date.now();
  execFileSync('node', ['src/index.js', ...args], { stdio: 'pipe' });
  return Date.now() - started;
}

(function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-perf-92-'));
  const input = 'examples/full_batch_90_fixed.json';
  try {
    const firstMs = runCli(['--input', input, '--output', tmpDir, '--rkm', '--profile']);
    const secondMs = runCli(['--input', input, '--output', tmpDir, '--rkm', '--profile']);

    assert(fs.existsSync(path.join(tmpDir, '.tk-cache.json')), 'TK cache manifest should be created');
    assert(fs.existsSync(path.join(tmpDir, '.rkm-cache.json')), 'RKM cache manifest should be created');
    assert(
      secondMs <= 30000,
      `Second batch run must be <= 30000ms for 92 positions, got ${secondMs}ms (first run ${firstMs}ms)`
    );

    console.log(`Performance test passed: first=${firstMs}ms, second=${secondMs}ms`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})()
