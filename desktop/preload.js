'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  openFile: () => ipcRenderer.invoke('open-file'),
  selectOutputDir: () => ipcRenderer.invoke('select-output-dir'),
  emitGenerationProgress: (payload) => ipcRenderer.send('generation-progress', payload),
  openOutputFolder: () => ipcRenderer.invoke('open-output-folder'),
  saveGeneratedFile: (payload) => ipcRenderer.invoke('save-generated-file', payload),
  onMenuAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('menu-action', listener);
    return () => ipcRenderer.removeListener('menu-action', listener);
  }
});
