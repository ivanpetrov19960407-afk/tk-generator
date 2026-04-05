#!/usr/bin/env node
/**
 * build_batch_from_excel.js
 * 
 * Reads the stone list Excel and generates a batch JSON for TK+MK+RKM generation.
 * 
 * Usage:
 *   node scripts/build_batch_from_excel.js <input.xlsx> [output.json]
 * 
 * Example:
 *   node scripts/build_batch_from_excel.js ../Spisok-kamnei-itogovyi_updated.xlsx examples/full_album_batch.json
 */

'use strict';

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const inputFile = process.argv[2];
const outputFile = process.argv[3] || 'examples/full_album_batch.json';

if (!inputFile) {
  console.error('Usage: node scripts/build_batch_from_excel.js <input.xlsx> [output.json]');
  process.exit(1);
}

// Material detection from full product name
function detectMaterial(name) {
  const lower = name.toLowerCase();
  
  if (lower.includes('жалгыз') || lower.includes('zhalgyiz')) {
    return { type: 'гранит', name: 'Жалгыз', density: 2700 };
  }
  if (lower.includes('delikato') || lower.includes('деликато')) {
    return { type: 'мрамор', name: 'Delikato_light', density: 2700 };
  }
  if (lower.includes('fatima') || lower.includes('фатима')) {
    return { type: 'известняк', name: 'Fatima', density: 2400 };
  }
  if (lower.includes('габбро') || lower.includes('нинимяки') || lower.includes('gabbro')) {
    return { type: 'габбро-диабаз', name: 'Габбро-диабаз_Нинимяки', density: 2900 };
  }
  
  // Fallback by rock type keywords
  if (lower.includes('гранит')) return { type: 'гранит', name: 'Жалгыз', density: 2700 };
  if (lower.includes('мрамор')) return { type: 'мрамор', name: 'Delikato_light', density: 2700 };
  if (lower.includes('известняк')) return { type: 'известняк', name: 'Fatima', density: 2400 };
  
  return { type: 'гранит', name: 'Жалгыз', density: 2700 };
}

// Parse dimensions string like "2500х410х150мм" or "207х207хH650мм"
function parseDimensions(dimStr) {
  if (!dimStr) return null;
  // Remove мм, mm, spaces
  let s = dimStr.replace(/мм|mm/gi, '').trim();
  // Handle "H" prefix for height (e.g., "207х207хH650")
  s = s.replace(/[HhНн]/g, '');
  // Split by х, x, X, ×
  const parts = s.split(/[хxX×]/);
  if (parts.length < 3) return null;
  
  const nums = parts.map(p => parseFloat(p.trim())).filter(n => !isNaN(n));
  if (nums.length < 3) return null;
  
  // Sort to get length >= width >= thickness
  nums.sort((a, b) => b - a);
  return { length: nums[0], width: nums[1], thickness: nums[2] };
}

// Normalize texture string to generator format
function normalizeTexture(textureStr) {
  if (!textureStr) return 'лощение';
  const lower = textureStr.toLowerCase().trim();
  
  if (lower.includes('рельефная') || lower.includes('матовая')) {
    return 'рельефная_матовая';
  }
  if ((lower.includes('бучард') && lower.includes('лощ')) ||
      (lower.includes('лощ') && lower.includes('бучард'))) {
    return 'бучардирование_лощение';
  }
  if (lower.includes('бучард')) {
    return 'бучардирование_лощение'; // Бучардирование alone → treated as бучардирование+лощение
  }
  if (lower.includes('лощ')) {
    return 'лощение';
  }
  if (lower.includes('полировка') || lower.includes('полир')) {
    return 'лощение'; // Fallback
  }
  
  return 'лощение';
}

// Determine k_reject based on dimensions and complexity
function determineKReject(dims, name) {
  if (!dims) return 1.4;
  const lower = name.toLowerCase();
  
  // Длинномер > 5м
  if (dims.length >= 5000) return 1.8;
  
  // Сложные профили
  if (lower.includes('сегмент') || lower.includes('радиус') || 
      lower.includes('объёмн') || lower.includes('объемн') ||
      lower.includes('п-образ') || lower.includes('профил')) {
    return 2.0;
  }
  
  return 1.4;
}

// Determine geometry_type
function determineGeometry(name) {
  const lower = name.toLowerCase();
  if (lower.includes('сегмент') || lower.includes('радиус')) return 'segmented';
  if (lower.includes('объёмн') || lower.includes('объемн') || lower.includes('п-образ')) return 'volume';
  if (lower.includes('профил') || lower.includes('капельник') || lower.includes('кант')) return 'profiled';
  return 'simple';
}

// Calculate quantity_pieces from area-based quantities
function calcPieces(qty, unit, dims) {
  if (!qty || !dims) return Math.max(1, Math.round(qty || 1));
  const unitLower = (unit || '').toLowerCase().replace(/[.]/g, '');
  
  if (unitLower.includes('кв') || unitLower.includes('м2') || unitLower.includes('м²')) {
    // Convert m² to pieces
    const pieceArea = (dims.length / 1000) * (dims.width / 1000);
    if (pieceArea > 0) return Math.ceil(qty / pieceArea);
  }
  if (unitLower.includes('пог') || unitLower.includes('м.п') || unitLower.includes('мп')) {
    // Convert m.p. to pieces
    const pieceLength = dims.length / 1000;
    if (pieceLength > 0) return Math.ceil(qty / pieceLength);
  }
  
  // шт, шт. — direct
  return Math.max(1, Math.round(qty));
}

// Generate short_name from position number and dimensions
function shortName(no, dims) {
  if (!dims) return `pos_${String(no).padStart(2, '0')}`;
  return `pos_${String(no).padStart(2, '0')}_${dims.length}x${dims.width}x${dims.thickness}`;
}

// ===== MAIN =====
const workbook = XLSX.readFile(path.resolve(inputFile));
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

// Skip header row
const products = [];
let skipped = 0;

for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  if (!row || !row[0]) continue;
  
  const no = row[0];
  const fullName = (row[1] || '').toString();
  const textureRaw = (row[2] || '').toString();
  const dimsRaw = (row[3] || '').toString();
  const unit = (row[4] || '').toString();
  const qtyRaw = row[5];
  
  const dims = parseDimensions(dimsRaw);
  if (!dims) {
    console.warn(`  ПРОПУСК поз.${no}: не удалось разобрать размеры "${dimsRaw}"`);
    skipped++;
    continue;
  }
  
  const material = detectMaterial(fullName);
  const texture = normalizeTexture(textureRaw);
  const k_reject = determineKReject(dims, fullName);
  const qty_pieces = calcPieces(qtyRaw, unit, dims);
  
  products.push({
    tk_number: no,
    name: fullName.substring(0, 200),
    short_name: shortName(no, dims),
    dimensions: dims,
    material: material,
    texture: texture,
    quantity: `${qtyRaw} ${unit}`,
    quantity_pieces: qty_pieces,
    edges: 'калибровка по всем сторонам, фаски 5мм',
    geometry_type: determineGeometry(fullName),
    category: '1',
    packaging: dims.length >= 1500 ? 'усиленная' : 'стандартная',
    rkm: {
      k_reject: k_reject,
      transport: {
        distance_km: 940,
        tariff_rub_km: 120,
        trips: 1,
        loading: 25000,
        unloading: 35000,
        insurance_pct: 0.005
      },
      material_prices: {
        diamond_discs: 10000,
        diamond_milling_heads: 8000,
        bush_hammer_heads_price: 8500,
        abrasives: 6500,
        coolant_chemistry: 1200,
        protective_materials: 800,
        packaging: dims.length >= 1500 ? 18000 : 5000,
        marking: 1500,
        ppe: 600
      }
    }
  });
}

const output = { products };
const outputPath = path.resolve(outputFile);
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');

console.log(`\n✓ Сформировано ${products.length} позиций (пропущено: ${skipped})`);
console.log(`✓ Сохранено: ${outputPath}`);

// Summary by material
const byMat = {};
products.forEach(p => {
  const key = p.material.name;
  byMat[key] = (byMat[key] || 0) + 1;
});
console.log('\nПо материалам:');
Object.entries(byMat).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => console.log(`  ${k}: ${v}`));

// Summary by texture
const byTex = {};
products.forEach(p => {
  byTex[p.texture] = (byTex[p.texture] || 0) + 1;
});
console.log('\nПо фактуре:');
Object.entries(byTex).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => console.log(`  ${k}: ${v}`));
