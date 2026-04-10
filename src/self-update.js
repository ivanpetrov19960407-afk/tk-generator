'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { createHash } = require('crypto');

const RELEASES_API_URL = 'https://api.github.com/repos/ivanpetrov19960407-afk/tk-generator/releases/latest';
const AUTO_UPDATE_STATE_FILE = path.join(os.homedir(), '.tk-generator', 'update-state.json');

function normalizeVersion(version) {
  return String(version || '').trim().replace(/^v/i, '');
}

function parseVersion(version) {
  const normalized = normalizeVersion(version);
  const parts = normalized.split('.').map((part) => Number.parseInt(part, 10));
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 3).map((n) => (Number.isFinite(n) ? n : 0));
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

function resolvePlatformAssetName(platform = process.platform, arch = process.arch) {
  if (platform === 'win32' && arch === 'x64') return 'tk-generator-windows-x64.zip';
  return null;
}

function parseIntervalToMs(interval) {
  const raw = String(interval || '24h').trim().toLowerCase();
  const matched = raw.match(/^(\d+)\s*([smhd])$/);
  if (!matched) return 24 * 60 * 60 * 1000;
  const value = Number(matched[1]);
  const unit = matched[2];
  if (unit === 's') return value * 1000;
  if (unit === 'm') return value * 60 * 1000;
  if (unit === 'h') return value * 60 * 60 * 1000;
  return value * 24 * 60 * 60 * 1000;
}

function httpGetJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'tk-generator-self-update',
        Accept: 'application/vnd.github+json',
        ...headers
      }
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        res.resume();
        return;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(data);
        } catch (err) {
          reject(new Error(`Не удалось разобрать JSON из ${url}: ${err.message}`));
        }
      });
    });

    req.on('error', reject);
  });
}

function downloadFile(url, targetPath) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        'User-Agent': 'tk-generator-self-update'
      }
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location;
        response.resume();
        if (!location) {
          reject(new Error('Редирект без location заголовка.'));
          return;
        }
        downloadFile(location, targetPath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode} while downloading ${url}`));
        return;
      }

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      const file = fs.createWriteStream(targetPath);
      response.pipe(file);

      file.on('finish', () => {
        file.close(() => resolve(targetPath));
      });

      file.on('error', (error) => {
        fs.unlink(targetPath, () => reject(error));
      });
    });

    request.on('error', reject);
  });
}

function sha256File(filePath) {
  const hash = createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
}

function readAutoUpdateState(filePath = AUTO_UPDATE_STATE_FILE) {
  if (!fs.existsSync(filePath)) return {};
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : {};
  } catch (_error) {
    return {};
  }
}

function writeAutoUpdateState(state, filePath = AUTO_UPDATE_STATE_FILE) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
}

function shouldCheckAutoUpdate({ interval = '24h', now = Date.now(), stateFilePath = AUTO_UPDATE_STATE_FILE } = {}) {
  const state = readAutoUpdateState(stateFilePath);
  const lastCheckedAt = Number(state.lastCheckedAt || 0);
  if (!Number.isFinite(lastCheckedAt) || lastCheckedAt <= 0) return true;
  return (now - lastCheckedAt) >= parseIntervalToMs(interval);
}

function markAutoUpdateChecked({ now = Date.now(), stateFilePath = AUTO_UPDATE_STATE_FILE } = {}) {
  const state = readAutoUpdateState(stateFilePath);
  state.lastCheckedAt = now;
  writeAutoUpdateState(state, stateFilePath);
}

async function fetchLatestRelease() {
  const release = await httpGetJson(RELEASES_API_URL);
  const version = normalizeVersion(release.tag_name || release.name || '');
  const assets = Array.isArray(release.assets) ? release.assets : [];

  return {
    version,
    raw: release,
    assets
  };
}

function findStandaloneAsset(assets, platform = process.platform, arch = process.arch) {
  const expectedName = resolvePlatformAssetName(platform, arch);
  if (!expectedName) return null;
  return assets.find((asset) => asset && asset.name === expectedName) || null;
}

async function checkForStandaloneUpdate({ currentVersion, platform, arch }) {
  const latest = await fetchLatestRelease();
  const hasUpdate = compareVersions(latest.version, currentVersion) > 0;
  const asset = findStandaloneAsset(latest.assets, platform, arch);

  return {
    currentVersion: normalizeVersion(currentVersion),
    latestVersion: latest.version,
    hasUpdate,
    asset,
    release: latest.raw
  };
}

async function performStandaloneSelfUpdate({
  currentVersion,
  executablePath = process.execPath,
  platform,
  arch
}) {
  const info = await checkForStandaloneUpdate({ currentVersion, platform, arch });
  if (!info.hasUpdate) {
    return {
      ...info,
      updated: false,
      message: 'Установлена актуальная версия.'
    };
  }

  if (!info.asset || !info.asset.browser_download_url) {
    throw new Error('Не найден подходящий артефакт standalone в релизе.');
  }

  const downloadDir = path.join(os.tmpdir(), 'tk-generator-updates');
  const downloadedFile = path.join(downloadDir, `${info.asset.name}`);
  await downloadFile(info.asset.browser_download_url, downloadedFile);

  const checksum = sha256File(downloadedFile);

  const preparedPath = `${executablePath}.update-${info.latestVersion}.zip`;
  fs.copyFileSync(downloadedFile, preparedPath);

  return {
    ...info,
    updated: true,
    downloadedFile,
    preparedPath,
    checksum,
    message: `Обновление ${info.latestVersion} загружено в ${preparedPath}. Распакуйте архив и замените бинарник.`
  };
}

module.exports = {
  RELEASES_API_URL,
  AUTO_UPDATE_STATE_FILE,
  normalizeVersion,
  compareVersions,
  resolvePlatformAssetName,
  parseIntervalToMs,
  shouldCheckAutoUpdate,
  markAutoUpdateChecked,
  fetchLatestRelease,
  checkForStandaloneUpdate,
  performStandaloneSelfUpdate
};
