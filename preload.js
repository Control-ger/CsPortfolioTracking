/* eslint-disable */
const { contextBridge, ipcRenderer } = require('electron'); // ipcRenderer hier hinzufügen!

contextBridge.exposeInMainWorld('electronAPI', {
    close: () => ipcRenderer.send('window-control', 'close'),
    minimize: () => ipcRenderer.send('window-control', 'minimize'),
    maximize: () => ipcRenderer.send('window-control', 'maximize'),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    localFileRead: (key) => ipcRenderer.invoke('local-cache-read', key),
    localFileWrite: (key, content) => ipcRenderer.invoke('local-cache-write', key, content),
    localFileRemove: (key) => ipcRenderer.invoke('local-cache-remove', key),
    // Auth session management
    storeSession: (token, user) => ipcRenderer.invoke('store-session', token, user),
    getSession: () => ipcRenderer.invoke('get-session'),
    clearSession: () => ipcRenderer.invoke('clear-session'),
    // Steam auth callback listener
    once: (channel, callback) => ipcRenderer.once(channel, callback),
    localStore: {
        info: () => ipcRenderer.invoke('local-store-info'),
        listInvestments: (userId) => ipcRenderer.invoke('local-store-list-investments', userId),
        importInvestments: (rows, userId) => ipcRenderer.invoke('local-store-import-investments', rows, userId),
        upsertInvestment: (payload) => ipcRenderer.invoke('local-store-upsert-investment', payload),
        deleteInvestment: (id) => ipcRenderer.invoke('local-store-delete-investment', id),
        getInvestment: (id) => ipcRenderer.invoke('local-store-get-investment', id),
        listWatchlist: (userId) => ipcRenderer.invoke('local-store-list-watchlist', userId),
        importWatchlist: (rows, userId) => ipcRenderer.invoke('local-store-import-watchlist', rows, userId),
        upsertWatchlistItem: (payload) => ipcRenderer.invoke('local-store-upsert-watchlist-item', payload),
        deleteWatchlistItem: (id) => ipcRenderer.invoke('local-store-delete-watchlist-item', id),
        listPortfolioSnapshots: (userId, limit) => ipcRenderer.invoke('local-store-list-portfolio-snapshots', userId, limit),
        upsertPortfolioSnapshot: (payload) => ipcRenderer.invoke('local-store-upsert-portfolio-snapshot', payload),
        upsertPrice: (payload) => ipcRenderer.invoke('local-store-upsert-price', payload),
        listPendingOperations: (limit) => ipcRenderer.invoke('local-store-list-pending-operations', limit),
        markOperationApplied: (id) => ipcRenderer.invoke('local-store-mark-operation-applied', id),
    },
    nodeVersion: () => process.versions.node,
    chromeVersion: () => process.versions.chrome
});
