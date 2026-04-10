#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const outputPath = path.resolve(process.argv[2] || 'templates/input_template.xlsx');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });

const headers = [
  '№',
  'Наименование изделия',
  'Фактура',
  'Габаритные размеры',
  'Ед. изм.',
  'Кол-во',
  'Контрольная цена за ед.изм. с НДС'
];

const exampleRows = [
  headers,
  [1, 'Плита напольная Delikato', 'лощение', '700x700x30 мм', 'м2 ', 25.5, 12500],
  [2, 'Проступь Габбро', 'бучардирование+лощение', '1500x300x30', 'шт', 12, 8400]
];

const worksheet = XLSX.utils.aoa_to_sheet(exampleRows);
worksheet['!cols'] = [
  { wch: 6 },
  { wch: 40 },
  { wch: 26 },
  { wch: 24 },
  { wch: 12 },
  { wch: 10 },
  { wch: 30 }
];

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, worksheet, 'Шаблон');
XLSX.writeFile(workbook, outputPath);

console.log(`✓ XLSX-шаблон создан: ${outputPath}`);
