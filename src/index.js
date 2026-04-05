#!/usr/bin/env node

/**
 * index.js — CLI entry point for TK Generator
 * 
 * Usage:
 *   node src/index.js --input examples/sample_product.json --output output/
 *   node src/index.js --input examples/batch_input.json --output output/
 *   node src/index.js --input examples/sample_input.xlsx --output output/
 */

const fs = require('fs');
const path = require('path');
const minimist = require('minimist');
const { generateBatch } = require('./generator');
const { generateRKM } = require('./rkm/rkm-generator');

const args = minimist(process.argv.slice(2), {
  alias: {
    i: 'input',
    o: 'output',
    h: 'help'
  },
  boolean: ['rkm'],
  default: {
    output: 'output/',
    rkm: false
  }
});

function printHelp() {
  console.log(`
╔════════════════════════════════════════════════╗
║  Генератор ТК+МК для натурального камня v1.0  ║
╚════════════════════════════════════════════════╝

Использование:
  node src/index.js --input <файл> [--output <папка>] [--rkm]

Параметры:
  -i, --input   Входной файл (JSON или XLSX)     [обязательный]
  -o, --output  Папка для сгенерированных файлов  [по умолчанию: output/]
      --rkm     Генерировать РКМ (расчётно-калькуляционную ведомость)
  -h, --help    Показать справку

Примеры:
  # Один продукт (JSON)
  node src/index.js --input examples/sample_product.json --output output/

  # Пакетная генерация (JSON)
  node src/index.js --input examples/batch_input.json --output output/

  # Из Excel файла
  node src/index.js --input examples/sample_input.xlsx --output output/

Поддерживаемые фактуры:
  - лощение
  - рельефная_матовая
  - бучардирование_лощение
`);
}

/**
 * Parse Excel input file
 */
function parseExcelInput(filePath) {
  const XLSX = require('xlsx');
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet);
  
  return rows.map((row, i) => {
    // Map Excel columns to product spec
    return {
      tk_number: row['tk_number'] || row['№'] || (i + 1),
      name: row['name'] || row['Название'] || row['Изделие'],
      short_name: row['short_name'] || row['Код'] || null,
      dimensions: {
        length: Number(row['length'] || row['Длина'] || row['длина']),
        width: Number(row['width'] || row['Ширина'] || row['ширина']),
        thickness: Number(row['thickness'] || row['Толщина'] || row['толщина'])
      },
      material: {
        type: row['material_type'] || row['Порода'] || 'мрамор',
        name: row['material_name'] || row['Камень'] || row['Материал'],
        density: Number(row['density'] || row['Плотность'] || 2700)
      },
      texture: row['texture'] || row['Фактура'] || 'лощение',
      quantity: row['quantity'] || row['Объём'] || null,
      quantity_pieces: row['quantity_pieces'] || row['Штук'] ? Number(row['quantity_pieces'] || row['Штук']) : null,
      edges: row['edges'] || row['Кромки'] || null,
      geometry_type: row['geometry_type'] || row['Геометрия'] || 'simple',
      object: row['object_name'] ? {
        name: row['object_name'] || row['Объект'],
        years: row['object_years'] || null,
        address: row['object_address'] || null,
        project: row['object_project'] || null
      } : null,
      category: row['category'] || row['Категория'] || '1',
      gost_primary: row['gost_primary'] || row['ГОСТ'] || 'ГОСТ 9480-2024',
      packaging: row['packaging'] || row['Упаковка'] || 'стандартная',
      date: row['date'] || row['Дата'] || null
    };
  });
}

/**
 * Parse JSON input file
 */
function parseJsonInput(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  
  // Support both { products: [...] } and single product or array
  if (data.products && Array.isArray(data.products)) {
    return data.products;
  }
  if (Array.isArray(data)) {
    return data;
  }
  // Single product
  return [data];
}

/**
 * Main entry point
 */
async function main() {
  if (args.help || !args.input) {
    printHelp();
    if (!args.input && !args.help) {
      console.error('ОШИБКА: не указан входной файл (--input)');
      process.exit(1);
    }
    return;
  }
  
  const inputPath = path.resolve(args.input);
  const outputDir = path.resolve(args.output);
  
  if (!fs.existsSync(inputPath)) {
    console.error(`ОШИБКА: файл не найден: ${inputPath}`);
    process.exit(1);
  }
  
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║  Генератор ТК+МК для натурального камня v1.0  ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log(`\nВход: ${inputPath}`);
  console.log(`Выход: ${outputDir}`);
  
  let products;
  const ext = path.extname(inputPath).toLowerCase();
  
  if (ext === '.xlsx' || ext === '.xls') {
    console.log('Формат: Excel');
    products = parseExcelInput(inputPath);
  } else if (ext === '.json') {
    console.log('Формат: JSON');
    products = parseJsonInput(inputPath);
  } else {
    console.error(`ОШИБКА: неподдерживаемый формат файла: ${ext}. Используйте .json или .xlsx`);
    process.exit(1);
  }
  
  console.log(`Найдено изделий: ${products.length}`);

  // === Генерация ТК+МК (всегда) ===
  console.log('\n=== Генерация ТК+МК ===');
  const results = await generateBatch(products, outputDir);
  const failed = results.filter(r => !r.success);
  if (failed.length > 0) {
    console.warn(`\n⚠ ${failed.length} ТК не сгенерированы (см. ошибки выше)`);
  }
  const successTK = results.filter(r => r.success).length;
  console.log(`\n✓ ТК+МК: ${successTK} из ${products.length} файлов`);

  // === Генерация РКМ (если --rkm) ===
  if (args.rkm) {
    console.log('\n=== Генерация РКМ ===');
    let rkmOk = 0;
    let rkmFail = 0;
    for (const product of products) {
      try {
        const result = await generateRKM(product, outputDir);
        rkmOk++;
      } catch (err) {
        rkmFail++;
        console.error(`[RKM] Ошибка для поз.${product.tk_number}: ${err.message}`);
      }
    }
    console.log(`\n✓ РКМ: ${rkmOk} из ${products.length} файлов` + (rkmFail ? ` (ошибки: ${rkmFail})` : ''));
  }

  console.log('\n========== ГОТОВО ==========');
}

main().catch(err => {
  console.error(`Критическая ошибка: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
