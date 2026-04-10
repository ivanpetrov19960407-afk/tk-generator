'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');

function createMinimalExcelFixture() {
  const fixtureJsonPath = path.resolve(__dirname, '../../fixtures/minimal-products.json');
  const fixture = JSON.parse(fs.readFileSync(fixtureJsonPath, 'utf8'));
  const products = Array.isArray(fixture.products) ? fixture.products : [];

  const header = ['№', 'Наименование', 'Фактура', 'Габаритные размеры', 'Ед. изм.', 'Кол-во', 'Контрольная цена'];
  const rows = products.map((p, index) => {
    const dims = p && p.dimensions
      ? `${p.dimensions.length}x${p.dimensions.width}x${p.dimensions.thickness}`
      : '0x0x0';

    return [
      Number(p.tk_number || index + 1),
      p.name || `Позиция ${index + 1}`,
      p.texture || 'лощение',
      dims,
      p.control_unit || 'шт',
      Number(p.quantity_pieces || 1),
      0
    ];
  });

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Products');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-e2e-fixture-'));
  const filePath = path.join(tempDir, 'minimal-input.xlsx');
  XLSX.writeFile(workbook, filePath);

  return {
    filePath,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

module.exports = {
  createMinimalExcelFixture
};
