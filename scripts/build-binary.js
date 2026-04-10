#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const OUTPUT_EXE = path.join(DIST_DIR, 'tk-generator.exe');
const ASSET_DIRS = ['data', 'config', 'schemas', 'templates'];

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function main() {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  console.log('Building Windows standalone binary with Bun...');
  run('bun', ['build', './src/index.js', '--compile', '--target=bun-windows-x64', '--outfile', OUTPUT_EXE]);

  console.log('Copying runtime assets next to executable...');
  for (const dirName of ASSET_DIRS) {
    const src = path.join(ROOT, dirName);
    if (fs.existsSync(src)) {
      copyDirRecursive(src, path.join(DIST_DIR, dirName));
    }
  }

  console.log(`Done: ${OUTPUT_EXE}`);
}

main();
