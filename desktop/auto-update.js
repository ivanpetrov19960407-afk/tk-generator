'use strict';

const { dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

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

function checkForUpdatesNow(logger = console) {
  return autoUpdater.checkForUpdates().catch((error) => {
    logger.error({ error: error.message }, 'Не удалось проверить обновления Electron');
  });
}

function setupAutoUpdates({ app, window, config, logger = console }) {
  const options = (config && config.autoUpdate) || { enabled: true, checkInterval: '24h' };
  if (!options.enabled) {
    logger.info('Auto-update выключен в конфиге.');
    return () => {};
  }

  const intervalMs = parseIntervalToMs(options.checkInterval);

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (error) => {
    logger.error({ error: error.message }, 'Ошибка автообновления Electron');
  });

  autoUpdater.on('update-available', async (info) => {
    const version = info && info.version ? info.version : 'unknown';
    const result = await dialog.showMessageBox(window, {
      type: 'question',
      buttons: ['Обновить', 'Позже'],
      defaultId: 0,
      cancelId: 1,
      title: 'Доступно обновление',
      message: `Доступна версия ${version}. Обновить сейчас?`,
      normalizeAccessKeys: true
    });

    if (result.response === 0) {
      autoUpdater.downloadUpdate();
    }
  });

  autoUpdater.on('update-not-available', () => {
    logger.info('Обновления Electron не найдены.');
  });

  autoUpdater.on('update-downloaded', async (info) => {
    const version = info && info.version ? info.version : 'unknown';
    const result = await dialog.showMessageBox(window, {
      type: 'info',
      buttons: ['Перезапустить сейчас', 'Позже'],
      defaultId: 0,
      cancelId: 1,
      title: 'Обновление загружено',
      message: `Версия ${version} загружена. Перезапустить приложение для установки?`,
      normalizeAccessKeys: true
    });

    if (result.response === 0) {
      setImmediate(() => autoUpdater.quitAndInstall());
    }
  });

  const runCheck = () => checkForUpdatesNow(logger);

  app.once('ready', runCheck);
  const timer = setInterval(runCheck, intervalMs);

  return () => clearInterval(timer);
}

module.exports = {
  setupAutoUpdates,
  parseIntervalToMs,
  checkForUpdatesNow
};
