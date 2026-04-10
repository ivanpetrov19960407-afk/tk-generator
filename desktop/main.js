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
const { setupAutoUpdates } = require('./auto-update');

let win;
let tray;
let apiServer;
let apiPort;
let selectedOutputDir = null;
let generationStatus = 'Готово';
let stopAutoUpdateTimer = null;

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
        { role: process.platform === 'darwin' ? 'close' : 'quit' }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function ensureTray() {
  if (tray || process.platform === 'darwin') return;
  const trayIcon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAK0lEQVR4AWP4//8/Azbw////GQYGBgb+////jwEJw6kB0QwMDAwMDAwAANV+Ezh6+U5rAAAAAElFTkSuQmCC');
  tray = new Tray(trayIcon);
  tray.setToolTip(`TK Generator: ${generationStatus}`);
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
      { role: 'quit', label: 'Выход' }
    ])
  );
}

function updateStatus(status, progress) {
  generationStatus = progress != null ? `${status} (${progress}%)` : status;

  if (tray) {
    tray.setToolTip(`TK Generator: ${generationStatus}`);
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

async function createMainWindow() {
  loadConfig();
  await startApiServer();

  win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 960,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  await win.loadURL(`http://127.0.0.1:${apiPort}/`);

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

  if (!stopAutoUpdateTimer) {
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
    new Notification({
      title: 'TK Generator',
      body: payload.message || 'Генерация завершена'
    }).show();
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
  if (stopAutoUpdateTimer) {
    stopAutoUpdateTimer();
    stopAutoUpdateTimer = null;
  }

  if (apiServer) {
    apiServer.close();
    apiServer = null;
  }
});
