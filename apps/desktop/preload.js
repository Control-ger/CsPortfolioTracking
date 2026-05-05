/* eslint-disable */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  close: () => ipcRenderer.send("window-control", "close"),
  minimize: () => ipcRenderer.send("window-control", "minimize"),
  maximize: () => ipcRenderer.send("window-control", "maximize"),
  localFileRead: (key) => ipcRenderer.invoke("local-cache-read", key),
  localFileWrite: (key, content) =>
    ipcRenderer.invoke("local-cache-write", key, content),
  localFileRemove: (key) => ipcRenderer.invoke("local-cache-remove", key),
  
  // Session management
  getSession: () => ipcRenderer.invoke("session-store", "get"),
  storeSession: (token, user) => ipcRenderer.invoke("session-store", "set", { token, user }),
  clearSession: () => ipcRenderer.invoke("session-store", "clear"),
  
  // External URL opening
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  
  // Debugging
  openDevTools: () => ipcRenderer.invoke("open-devtools"),
  backend: {
    getBaseUrl: () => ipcRenderer.invoke("backend-base-url"),
  },
  secrets: {
    getCsFloatApiKeyStatus: () => ipcRenderer.invoke("secret-csfloat-status"),
    setCsFloatApiKey: (apiKey) => ipcRenderer.invoke("secret-csfloat-set", apiKey),
    clearCsFloatApiKey: () => ipcRenderer.invoke("secret-csfloat-clear"),
  },
  
  // IPC event bridge
  once: (channel, handler) => ipcRenderer.once(channel, handler),
  on: (channel, handler) => ipcRenderer.on(channel, handler),
  
  localStore: {
    info: () => ipcRenderer.invoke("local-store-info"),
    listInvestments: (userId) =>
      ipcRenderer.invoke("local-store-list-investments", userId),
    importInvestments: (rows, userId) =>
      ipcRenderer.invoke("local-store-import-investments", rows, userId),
    syncSteamInventory: (rows, userId) =>
      ipcRenderer.invoke("local-store-sync-steam-inventory", rows, userId),
    upsertInvestment: (payload) =>
      ipcRenderer.invoke("local-store-upsert-investment", payload),
    deleteInvestment: (id) =>
      ipcRenderer.invoke("local-store-delete-investment", id),
    getInvestment: (id) =>
      ipcRenderer.invoke("local-store-get-investment", id),
    listWatchlist: (userId) =>
      ipcRenderer.invoke("local-store-list-watchlist", userId),
    importWatchlist: (rows, userId) =>
      ipcRenderer.invoke("local-store-import-watchlist", rows, userId),
    upsertWatchlistItem: (payload) =>
      ipcRenderer.invoke("local-store-upsert-watchlist-item", payload),
    deleteWatchlistItem: (id) =>
      ipcRenderer.invoke("local-store-delete-watchlist-item", id),
    listPortfolioSnapshots: (userId, limit) =>
      ipcRenderer.invoke("local-store-list-portfolio-snapshots", userId, limit),
    upsertPortfolioSnapshot: (payload) =>
      ipcRenderer.invoke("local-store-upsert-portfolio-snapshot", payload),
    upsertPrice: (payload) => ipcRenderer.invoke("local-store-upsert-price", payload),
    listPendingOperations: (limit) =>
      ipcRenderer.invoke("local-store-list-pending-operations", limit),
    listSteamCsfloatMatches: (userId, status, limit) =>
      ipcRenderer.invoke("local-store-list-steam-csfloat-matches", userId, status, limit),
    updateSteamCsfloatMatchStatus: (matchId, status) =>
      ipcRenderer.invoke("local-store-update-steam-csfloat-match-status", matchId, status),
    createNotification: (payload) =>
      ipcRenderer.invoke("local-store-create-notification", payload),
    listNotifications: (userId, options) =>
      ipcRenderer.invoke("local-store-list-notifications", userId, options),
    markNotificationRead: (id) =>
      ipcRenderer.invoke("local-store-mark-notification-read", id),
    markAllNotificationsRead: (userId, category) =>
      ipcRenderer.invoke("local-store-mark-all-notifications-read", userId, category),
    markOperationApplied: (id) =>
      ipcRenderer.invoke("local-store-mark-operation-applied", id),
  },
  nodeVersion: () => process.versions.node,
  chromeVersion: () => process.versions.chrome,
});
