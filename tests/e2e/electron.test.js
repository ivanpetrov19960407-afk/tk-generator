#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createMinimalExcelFixture } = require('./support/fixture-excel');

let electron;
let playwright;
try {
  electron = require(path.resolve(__dirname, '../../desktop/node_modules/electron'));
  ({ _electron: playwright } = require('playwright'));
} catch (_error) {
  console.log('SKIP: electron/playwright не установлены в окружении.');
  process.exit(0);
}

(async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-electron-e2e-'));
  const fixture = createMinimalExcelFixture();
  const fixtureBytes = fs.readFileSync(fixture.filePath);

  const app = await playwright.launch({
    executablePath: electron,
    args: [path.resolve(__dirname, '../../desktop/main.js')],
    env: {
      ...process.env,
      TK_ELECTRON_E2E: '1',
      TK_ELECTRON_E2E_OUTPUT_DIR: outputDir
    }
  });

  try {
    const page = await app.firstWindow();
    await page.waitForSelector('#dropZone');

    const uint8 = Array.from(fixtureBytes);
    await page.evaluate(async ({ bytes }) => {
      const buffer = new Uint8Array(bytes);
      const file = new File([buffer], 'minimal-input.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const dropZone = document.getElementById('dropZone');
      dropZone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
      await new Promise((resolve) => setTimeout(resolve, 300));
    }, { bytes: uint8 });

    await page.click('#generateBtn');
    await page.waitForSelector('.ok', { timeout: 120000 });
    const messages = await page.locator('#messages').innerText();

    assert.match(messages, /(ZIP сохранён|Excel распознан)/, `Ожидалось уведомление об успешной генерации, получено: ${messages}`);

    console.log('electron.e2e test passed');
  } finally {
    await app.close();
    fixture.cleanup();
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
