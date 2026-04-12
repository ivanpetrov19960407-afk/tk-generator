'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, dialog, ipcMain, Menu, Tray, Notification, shell, nativeImage } = require('electron');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

const electronErrorLogPath = path.join(__dirname, 'electron-error.log');
process.on('uncaughtException', (error) => {
  const timestamp = new Date().toISOString();
  const details = error && error.stack ? error.stack : String(error);
  fs.appendFileSync(electronErrorLogPath, `[${timestamp}] ${details}\n`);
});

const { createApp } = require('../src/server');
const { loadConfig, getConfig } = require('../src/config');
const { setupAutoUpdates, checkForUpdatesNow } = require('./auto-update');
const { version: appVersion } = require('../package.json');

let win;
let tray;
let splash;
let apiServer;
let apiPort;
let selectedOutputDir = null;
let generationStatus = 'Готово';
let stopAutoUpdateTimer = null;
let isQuitting = false;
let trayHintShown = false;
const isElectronE2E = process.env.TK_ELECTRON_E2E === '1';
const appIconPath = path.join(__dirname, '../assets/icon.svg');

function hideToTrayWithToast() {
  if (!win) return;
  win.hide();

  if (!trayHintShown) {
    trayHintShown = true;
    win.webContents
      .executeJavaScript('typeof showToast === "function" && showToast("Приложение свернуто в трей", "info")', true)
      .catch(() => {});
  }
}

function triggerAutoUpdateCheck() {
  checkForUpdatesNow(console);
  dialog.showMessageBox(win, {
    type: 'info',
    title: 'Проверка обновлений',
    message: 'Проверка обновлений запущена.',
    buttons: ['OK']
  }).catch(() => {});
}

function createMenu() {
  const template = [
    {
      label: 'Файл',
      submenu: [
        {
          label: 'Открыть',
          accelerator: 'CmdOrCtrl+O',
          click: () => win && win.webContents.send('menu-action', 'open-file')
        },
        {
          label: 'Генерировать',
          accelerator: 'CmdOrCtrl+G',
          click: () => win && win.webContents.send('menu-action', 'generate')
        },
        {
          label: 'Настройки',
          accelerator: 'CmdOrCtrl+,',
          click: () => win && win.webContents.send('menu-action', 'settings')
        },
        { type: 'separator' },
        {
          label: 'Перезагрузить',
          accelerator: 'CmdOrCtrl+R',
          click: () => win && win.reload()
        },
        {
          label: 'Перезагрузить (F5)',
          accelerator: 'F5',
          click: () => win && win.reload()
        },
        {
          label: 'Свернуть в трей',
          accelerator: 'Esc',
          click: () => hideToTrayWithToast()
        },
        ...(process.env.NODE_ENV === 'development'
          ? [
              {
                label: 'Открыть DevTools',
                accelerator: 'CmdOrCtrl+Shift+I',
                click: () => win && win.webContents.openDevTools({ mode: 'detach' })
              }
            ]
          : []),
        { type: 'separator' },
        { role: process.platform === 'darwin' ? 'close' : 'quit' }
      ]
    },
    {
      label: 'Справка',
      submenu: [
        {
          label: 'О программе',
          click: () => {
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'О программе',
              message: `TK Generator v${appVersion}`,
              detail: 'GitHub: https://github.com/ivanpetrov19960407-afk/tk-generator',
              buttons: ['OK']
            });
          }
        },
        {
          label: 'Документация',
          click: () => shell.openExternal('https://ivanpetrov19960407-afk.github.io/tk-generator/')
        },
        {
          label: 'Проверить обновления',
          click: () => triggerAutoUpdateCheck()
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Статус: ${generationStatus}`, enabled: false },
      { type: 'separator' },
      {
        label: 'Показать окно',
        click: () => {
          if (win) {
            win.show();
            win.focus();
          }
        }
      },
      {
        label: 'Выход',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
}

function ensureTray() {
  if (isElectronE2E) return;
  if (tray || process.platform === 'darwin') return;
  const trayIcon = nativeImage.createFromPath(appIconPath);
  tray = new Tray(trayIcon);
  tray.setToolTip(`TK Generator: ${generationStatus}`);
  tray.on('double-click', () => {
    if (win) {
      win.show();
      win.focus();
    }
  });
  rebuildTrayMenu();
}

function updateStatus(status, progress) {
  generationStatus = progress != null ? `${status} (${progress}%)` : status;

  if (tray) {
    tray.setToolTip(`TK Generator: ${generationStatus}`);
    rebuildTrayMenu();
  }

  if (win) {
    win.setProgressBar(typeof progress === 'number' ? Math.max(0, Math.min(1, progress / 100)) : -1);
  }
}

const SERVER_START_TIMEOUT_MS = 30000;

async function startApiServer() {
  const expressApp = createApp();

  const serverPromise = new Promise((resolve, reject) => {
    const server = expressApp.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error('Не удалось запустить встроенный сервер за 30 секунд. Проверьте занятые порты и антивирус.'));
    }, SERVER_START_TIMEOUT_MS);
  });

  apiServer = await Promise.race([serverPromise, timeoutPromise]);
  apiPort = apiServer.address().port;
}

function createSplashWindow() {
  splash = new BrowserWindow({
    width: 400,
    height: 280,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    show: true,
    icon: appIconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  splash.loadFile(path.join(__dirname, '../public/splash.html'));
}

async function createMainWindow() {
  loadConfig();
  createSplashWindow();

  try {
    await startApiServer();
  } catch (error) {
    if (splash) {
      splash.close();
      splash = null;
    }
    dialog.showErrorBox('Ошибка запуска', error.message || 'Не удалось запустить встроенный сервер.');
    app.quit();
    return;
  }

  if (process.env.TK_ELECTRON_E2E_OUTPUT_DIR) {
    selectedOutputDir = process.env.TK_ELECTRON_E2E_OUTPUT_DIR;
  }

  win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 960,
    minHeight: 700,
    show: false,
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    hideToTrayWithToast();
  });

  await win.loadURL(`http://127.0.0.1:${apiPort}/`);

  if (splash) {
    splash.close();
    splash = null;
  }

  win.show();

  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools();
  }

  if (process.env.TK_ELECTRON_SMOKE === '1') {
    win.webContents.once('did-finish-load', () => {
      process.stdout.write('WINDOW_READY\n');
      setTimeout(() => app.quit(), 200);
    });
  }

  win.on('closed', () => {
    win = null;
  });

  ensureTray();
  createMenu();

  if (!stopAutoUpdateTimer && !isElectronE2E) {
    stopAutoUpdateTimer = setupAutoUpdates({
      app,
      window: win,
      config: getConfig(),
      logger: console
    });
  }
}

ipcMain.handle('open-file', async () => {
  const fs = require('fs');
  const result = await dialog.showOpenDialog(win, {
    title: 'Выберите входной файл',
    properties: ['openFile'],
    filters: [
      { name: 'Supported', extensions: ['xlsx', 'xls', 'json'] },
      { name: 'Excel', extensions: ['xlsx', 'xls'] },
      { name: 'JSON', extensions: ['json'] }
    ]
  });

  if (result.canceled || !result.filePaths.length) return null;
  const filePath = result.filePaths[0];
  const fileBuffer = fs.readFileSync(filePath);
  return {
    filePath,
    fileName: path.basename(filePath),
    data: Array.from(fileBuffer)
  };
});

ipcMain.handle('select-output-dir', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Выберите папку для результатов',
    properties: ['openDirectory', 'createDirectory']
  });

  if (result.canceled || !result.filePaths.length) return null;
  selectedOutputDir = result.filePaths[0];
  return selectedOutputDir;
});

ipcMain.on('generation-progress', (_event, payload) => {
  const status = payload && payload.status ? payload.status : 'Генерация';
  const progress = payload && typeof payload.progress === 'number' ? payload.progress : null;
  updateStatus(status, progress);

  if (payload && payload.completed) {
    if (payload.outputDir) {
      selectedOutputDir = payload.outputDir;
    }

    const generatedCount = payload.count || payload.generated || payload.items || null;
    const doneMessage = generatedCount
      ? `Готово: ${generatedCount} позиции сгенерированы`
      : (payload.message || 'Генерация завершена');

    const notification = new Notification({
      title: 'TK Generator',
      body: doneMessage,
      actions: [{ type: 'button', text: 'Открыть папку' }],
      closeButtonText: 'Закрыть'
    });

    const openFolder = () => {
      if (!selectedOutputDir) return;
      shell.openPath(selectedOutputDir);
    };

    notification.on('click', openFolder);
    notification.on('action', (_event, index) => {
      if (index === 0) openFolder();
    });
    notification.show();

    if (isElectronE2E) {
      process.stdout.write(`NOTIFICATION_SHOWN:${doneMessage}\n`);
    }
  }
});

ipcMain.handle('open-output-folder', async () => {
  if (!selectedOutputDir) return false;
  await shell.openPath(selectedOutputDir);
  return true;
});

ipcMain.handle('save-generated-file', async (_event, { data, suggestedName }) => {
  if (!selectedOutputDir) return null;

  const fs = require('fs');
  const outputPath = path.join(selectedOutputDir, suggestedName || 'tk-generator-result.zip');
  fs.writeFileSync(outputPath, Buffer.from(data));
  return outputPath;
});

app.whenReady().then(createMainWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;

  if (stopAutoUpdateTimer) {
    stopAutoUpdateTimer();
    stopAutoUpdateTimer = null;
  }

  if (apiServer) {
    apiServer.close();
    apiServer = null;
  }
});
