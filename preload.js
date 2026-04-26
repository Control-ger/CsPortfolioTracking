/* eslint-disable */
const { contextBridge, ipcRenderer } = require('electron'); // ipcRenderer hier hinzufügen!

contextBridge.exposeInMainWorld('electronAPI', {
    close: () => ipcRenderer.send('window-control', 'close'),
    minimize: () => ipcRenderer.send('window-control', 'minimize'),
    maximize: () => ipcRenderer.send('window-control', 'maximize'),
    nodeVersion: () => process.versions.node,
    chromeVersion: () => process.versions.chrome
});