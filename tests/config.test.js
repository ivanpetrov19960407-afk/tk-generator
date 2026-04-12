'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const { loadConfig, getConfig } = require('../src/config');
const { calcTransport } = require('../src/rkm/rkm-generator');

function createTmpConfig(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tkg-config-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(content, null, 2), 'utf8');
  }
  return dir;
}

(function run() {
  const dir = createTmpConfig({
    'default.json': {
      rkm: {
        logisticsDefaults: {
          distance_km: 100,
          tariff_rub_km: 10,
          trips: 1,
          loading: 0,
          unloading: 0,
          insurance_pct: 0
        },
        skipTransportTkNumbers: [],
        specialMaterialRules: {}
      },
      company: {}
    },
    'local.json': {
      rkm: {
        logisticsDefaults: {
          distance_km: 150
        }
      }
    }
  });

  loadConfig({ configDir: dir });
  const cfg = getConfig();
  assert.strictEqual(cfg.rkm.logisticsDefaults.distance_km, 150);
  assert.strictEqual(cfg.autoUpdate.enabled, true);
  assert.strictEqual(cfg.autoUpdate.checkInterval, '24h');

  const transport = calcTransport({ rkm: {} }, { itogo_production: 0 });
  assert.strictEqual(transport.total, 150 * 10);

  const badDir = createTmpConfig({
    'default.json': {
      company: {},
      rkm: {
        logisticsDefaults: { distance_km: 'oops' },
        skipTransportTkNumbers: [],
        specialMaterialRules: {}
      }
    }
  });

  let failed = false;
  try {
    loadConfig({ configDir: badDir });
  } catch (err) {
    failed = /distance_km/.test(err.message);
  }

  assert.ok(failed, 'Ожидалась ошибка валидации конфига');

  const prodDir = createTmpConfig({
    'default.json': {
      company: {},
      rkm: {
        logisticsDefaults: {
          distance_km: 100,
          tariff_rub_km: 10,
          trips: 1,
          loading: 0,
          unloading: 0,
          insurance_pct: 0
        },
        skipTransportTkNumbers: [],
        specialMaterialRules: {}
      },
      webhooks: [
        {
          url: 'http://example.com/hook',
          events: ['batch.complete'],
          enabled: true
        }
      ]
    }
  });
  const prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  let prodFailed = false;
  try {
    loadConfig({ configDir: prodDir });
  } catch (err) {
    prodFailed = /https/.test(err.message);
  } finally {
    process.env.NODE_ENV = prevEnv;
  }
  assert.ok(prodFailed, 'Ожидалась ошибка non-https webhook в production');
  console.log('config.test.js passed');
})();
