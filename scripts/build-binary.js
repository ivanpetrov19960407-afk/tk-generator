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

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    copyDirRecursive(src, dest);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function includeNativeAddons() {
  const modulesDir = path.join(ROOT, 'node_modules');
  const distModulesDir = path.join(DIST_DIR, 'node_modules');
  const betterSqlite3Src = path.join(modulesDir, 'better-sqlite3');
  const betterSqlite3Dest = path.join(distModulesDir, 'better-sqlite3');

  if (!fs.existsSync(betterSqlite3Src)) {
    console.warn('better-sqlite3 is not installed in node_modules, skipping native addon copy');
    return;
  }

  fs.mkdirSync(betterSqlite3Dest, { recursive: true });

  for (const relativePath of ['package.json', 'LICENSE', 'README.md', 'binding.gyp']) {
    copyIfExists(path.join(betterSqlite3Src, relativePath), path.join(betterSqlite3Dest, relativePath));
  }

  copyIfExists(path.join(betterSqlite3Src, 'lib'), path.join(betterSqlite3Dest, 'lib'));
  copyIfExists(path.join(betterSqlite3Src, 'deps'), path.join(betterSqlite3Dest, 'deps'));
  copyIfExists(path.join(betterSqlite3Src, 'src'), path.join(betterSqlite3Dest, 'src'));
  copyIfExists(path.join(betterSqlite3Src, 'build'), path.join(betterSqlite3Dest, 'build'));
  copyIfExists(path.join(betterSqlite3Src, 'prebuilds'), path.join(betterSqlite3Dest, 'prebuilds'));

  // Bun standalone needs explicit JS entrypoint for externalized native package.
  const shimPath = path.join(distModulesDir, 'better-sqlite3.js');
  fs.writeFileSync(shimPath, "module.exports = require('./better-sqlite3');\n", 'utf8');
}

function main() {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  console.log('Building Windows standalone binary with Bun...');
  run('bun', [
    'build',
    './src/index.js',
    '--compile',
    '--target=bun-windows-x64',
    '--external',
    'better-sqlite3',
    '--outfile',
    OUTPUT_EXE
  ]);

  console.log('Copying runtime assets next to executable...');
  for (const dirName of ASSET_DIRS) {
    const src = path.join(ROOT, dirName);
    if (fs.existsSync(src)) {
      copyDirRecursive(src, path.join(DIST_DIR, dirName));
    }
  }

  console.log('Copying native addons...');
  includeNativeAddons();

  console.log(`Done: ${OUTPUT_EXE}`);
}

main();
