#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEST_DIR = path.join(ROOT, 'assets', 'fonts');
const DEST_REGULAR = path.join(DEST_DIR, 'DejaVuSans.ttf');
const DEST_BOLD = path.join(DEST_DIR, 'DejaVuSans-Bold.ttf');

const pickFirstExisting = (paths) => paths.find((p) => p && fs.existsSync(p));

const srcRegular = pickFirstExisting([
  process.env.TKG_FONT_REGULAR,
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
]);

const srcBold = pickFirstExisting([
  process.env.TKG_FONT_BOLD,
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
]);

fs.mkdirSync(DEST_DIR, { recursive: true });

if (!srcRegular || !srcBold) {
  console.error('❌ Не удалось найти исходные TTF-шрифты.');
  console.error('Укажите пути через TKG_FONT_REGULAR и TKG_FONT_BOLD или установите DejaVu в систему.');
  process.exit(1);
}

fs.copyFileSync(srcRegular, DEST_REGULAR);
fs.copyFileSync(srcBold, DEST_BOLD);

console.log('✅ Fonts prepared:');
console.log(`- ${DEST_REGULAR}`);
console.log(`- ${DEST_BOLD}`);
