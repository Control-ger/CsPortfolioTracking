/* eslint-disable */

import { ipcMain, app, BrowserWindow, shell } from "electron";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;

import {
  getSecretVaultStatus,
  touchSecretVaultActivity,
  updateSecretVaultPreferences,
  configureSecretVaultPassword,
  unlockSecretVault,
  lockSecretVault,
  getCsFloatApiKeyStatus,
  writeCsFloatApiKey,
  clearCsFloatApiKey,
  getSkinBaronApiKeyStatus,
  writeSkinBaronApiKey,
  clearSkinBaronApiKey,
  writeSkinBaronSessionCookie,
  clearSkinBaronSessionCookie,
} from "./secret-vault.js";

import {
  restartPhpSidecar,
  ensurePhpSidecarForRenderer,
  getSidecarAuthHeaders,
  stopPhpSidecar,
} from "./sidecar.js";

import {
  mainWindowForUpdater,
  getUpdaterLatestInfo,
  isUpdateDownloadInProgress,
  setMainWindow,
} from "./updater.js";

// ── Shared references set by main/index.js ────────────────────────
export let backendBaseUrlRef = null;
export let getLocalStoreRef = null;
export let readCacheFileRef = null;
export let writeCacheFileRef = null;
export let readSessionFileRef = null;
export let writeSessionFileRef = null;
export let deleteSessionFileRef = null;
export let openCloudflareAccessLoginWindowRef = null;
export let getStoredServerConfigRef = null;
export let writeServerConfigRef = null;
export let testServerConnectionRef = null;

export function setBackendBaseUrl(url) {
  backendBaseUrlRef = url;
}

export function setIpcDeps(deps) {
  getLocalStoreRef = deps.getLocalStore;
  readCacheFileRef = deps.readCacheFile;
  writeCacheFileRef = deps.writeCacheFile;
  readSessionFileRef = deps.readSessionFile;
  writeSessionFileRef = deps.writeSessionFile;
  deleteSessionFileRef = deps.deleteSessionFile;
  openCloudflareAccessLoginWindowRef = deps.openCloudflareAccessLoginWindow;
  getStoredServerConfigRef = deps.getStoredServerConfig;
  writeServerConfigRef = deps.writeServerConfig;
  testServerConnectionRef = deps.testServerConnection;
}

// ── Helper: ensure vault is unlocked ──────────────────────────────
function ensureDesktopRuntimeUnlocked() {
  const vaultStatus = getSecretVaultStatus();
  if (!vaultStatus.configured) {
    const setupError = new Error("Secret Vault ist noch nicht eingerichtet.");
    setupError.code = "SECRET_VAULT_NOT_CONFIGURED";
    throw setupError;
  }
  if (!vaultStatus.unlocked) {
    const lockError = new Error("Secret Vault ist gesperrt.");
    lockError.code = "SECRET_VAULT_LOCKED";
    throw lockError;
  }
  touchSecretVaultActivity();
}

// ── Helper: safe local store handler ──────────────────────────────
function safeLocalStoreInvoke(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      ensureDesktopRuntimeUnlocked();
      const store = getLocalStoreRef ? getLocalStoreRef() : null;
      if (!store) {
        return { error: "Local store not available", channel };
      }
      return await handler(store, ...args);
    } catch (error) {
      console.error(`[localStore] Error in ${channel}:`, error);
      return { error: error.message || "Local store operation failed", channel };
    }
  });
}

// ═══════════════════════════════════════════════════════════════════
// Register all IPC handlers
// ═══════════════════════════════════════════════════════════════════

export function registerAllIpcHandlers() {

  // ── Window control ────────────────────────────────────────────
  ipcMain.on("window-control", (event, action) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return;
    if (action === "close") {
      win.close();
    } else if (action === "minimize") {
      win.minimize();
    } else if (action === "maximize") {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });

  // ── Local cache ───────────────────────────────────────────────
  ipcMain.handle("local-cache-read", async (event, key) => {
    const cacheData = await readCacheFileRef();
    return cacheData[key] || null;
  });

  ipcMain.handle("local-cache-write", async (event, key, content) => {
    try {
      const cacheData = await readCacheFileRef();
      cacheData[key] = content;
      await writeCacheFileRef(cacheData);
      return true;
    } catch (error) {
      console.warn("[desktop-cache] failed to write cache entry", error);
      return false;
    }
  });

  ipcMain.handle("local-cache-remove", async (event, key) => {
    try {
      const cacheData = await readCacheFileRef();
      delete cacheData[key];
      await writeCacheFileRef(cacheData);
      return true;
    } catch (error) {
      console.warn("[desktop-cache] failed to remove cache entry", error);
      return false;
    }
  });

  // ── Session management ────────────────────────────────────────
  ipcMain.handle("session-store", async (event, action, data) => {
    if (action === "get") {
      return await readSessionFileRef();
    }
    if (action === "set") {
      await writeSessionFileRef(data);
      return true;
    }
    if (action === "clear") {
      await deleteSessionFileRef();
      return true;
    }
    return false;
  });

  // ── External URL / DevTools ───────────────────────────────────
  ipcMain.handle("open-external", async (event, url) => {
    return await shell.openExternal(url);
  });

  ipcMain.handle("open-devtools", async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      win.webContents.openDevTools({ mode: "detach" });
      return true;
    }
    return false;
  });

  // ── App version ───────────────────────────────────────────────
  ipcMain.handle("app-get-version", () => app.getVersion());

  // ── Cloudflare Access login ───────────────────────────────────
  ipcMain.handle("cloudflare-access-login", async (event, serverUrl) => {
    try {
      const result = await openCloudflareAccessLoginWindowRef(serverUrl);
      await restartPhpSidecar().catch((error) => {
        console.warn("[sidecar] restart after cloudflare login failed", error);
      });
      return {
        ok: true,
        ...result,
      };
    } catch (error) {
      return {
        ok: false,
        error: error?.message || String(error),
      };
    }
  });

  // ── Backend / Auth headers ────────────────────────────────────
  ipcMain.handle("backend-base-url", async () => {
    ensureDesktopRuntimeUnlocked();
    const result = await ensurePhpSidecarForRenderer();
    return result?.url ?? result;
  });

  ipcMain.handle("backend-auth-headers", async () => {
    ensureDesktopRuntimeUnlocked();
    await ensurePhpSidecarForRenderer();
    return getSidecarAuthHeaders();
  });

  // ── App updater ───────────────────────────────────────────────
  ipcMain.handle("app-updater-check", async () => {
    if (!app.isPackaged) {
      return { ok: false, reason: "not-packaged" };
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      return {
        ok: true,
        updateInfo: result?.updateInfo || null,
      };
    } catch (error) {
      console.warn("[updater] manual check failed:", error?.message || error);
      return {
        ok: false,
        error: error?.message || String(error),
      };
    }
  });

  ipcMain.handle("app-updater-download", async () => {
    if (!app.isPackaged) {
      return { ok: false, reason: "not-packaged" };
    }
    if (isUpdateDownloadInProgress()) {
      return { ok: true, alreadyDownloading: true };
    }

    let info = getUpdaterLatestInfo();
    if (!info) {
      try {
        const result = await autoUpdater.checkForUpdates();
        info = result?.updateInfo || getUpdaterLatestInfo();
      } catch (error) {
        const message = error?.message || String(error);
        console.warn("[updater] download requested but check failed:", message);
        return { ok: false, error: message };
      }
    }

    if (!info) {
      return { ok: false, reason: "no-update-info" };
    }

    const { promptForUpdateDownload } = await import("./updater.js");
    return await promptForUpdateDownload(info);
  });

  ipcMain.handle("app-updater-install", async () => {
    if (!app.isPackaged) {
      return false;
    }
    autoUpdater.quitAndInstall();
    return true;
  });

  // ── Server config ─────────────────────────────────────────────
  ipcMain.handle("server-config-get", () => getStoredServerConfigRef());

  ipcMain.handle("server-config-set", async (event, payload) => {
    const config = await writeServerConfigRef(payload || {});
    await restartPhpSidecar();
    return config;
  });

  ipcMain.handle("server-config-test", async (event, serverUrl) => {
    return await testServerConnectionRef(serverUrl);
  });

  // ── Secret vault ──────────────────────────────────────────────
  ipcMain.handle("secret-vault-status", () => getSecretVaultStatus());

  ipcMain.handle("secret-vault-set-preferences", async (_event, patch) => {
    const status = await updateSecretVaultPreferences(patch || {});
    return { status };
  });

  ipcMain.handle("secret-vault-set-password", async (_event, password) => {
    const status = await configureSecretVaultPassword(password);
    return { status, backendBaseUrl: backendBaseUrlRef };
  });

  ipcMain.handle("secret-vault-unlock", async (_event, password) => {
    const status = await unlockSecretVault(password);
    return { status, backendBaseUrl: backendBaseUrlRef };
  });

  ipcMain.handle("secret-vault-lock", async () => {
    const status = await lockSecretVault("manual-lock");
    return { status, backendBaseUrl: backendBaseUrlRef };
  });

  ipcMain.handle("secret-vault-touch", () => {
    const status = touchSecretVaultActivity();
    return { status };
  });

  // ── CsFloat API key ───────────────────────────────────────────
  ipcMain.handle("secret-csfloat-status", () => getCsFloatApiKeyStatus());

  ipcMain.handle("secret-csfloat-set", async (event, apiKey) => {
    ensureDesktopRuntimeUnlocked();
    const status = await writeCsFloatApiKey(apiKey);
    return { status, backendBaseUrl: backendBaseUrlRef };
  });

  ipcMain.handle("secret-csfloat-clear", async () => {
    ensureDesktopRuntimeUnlocked();
    const status = await clearCsFloatApiKey();
    return { status, backendBaseUrl: backendBaseUrlRef };
  });

  // ── SkinBaron API key ─────────────────────────────────────────
  ipcMain.handle("secret-skinbaron-status", () => getSkinBaronApiKeyStatus());

  ipcMain.handle("secret-skinbaron-set", async (event, apiKey) => {
    ensureDesktopRuntimeUnlocked();
    const status = await writeSkinBaronApiKey(apiKey);
    return { status, backendBaseUrl: backendBaseUrlRef };
  });

  ipcMain.handle("secret-skinbaron-clear", async () => {
    ensureDesktopRuntimeUnlocked();
    const status = await clearSkinBaronApiKey();
    return { status, backendBaseUrl: backendBaseUrlRef };
  });

  // ── SkinBaron session cookie ──────────────────────────────────
  ipcMain.handle("secret-skinbaron-session-status", () => getSkinBaronApiKeyStatus());

  ipcMain.handle("secret-skinbaron-session-set", async (event, sessionCookie) => {
    ensureDesktopRuntimeUnlocked();
    const status = await writeSkinBaronSessionCookie(sessionCookie);
    return { status, backendBaseUrl: backendBaseUrlRef };
  });

  ipcMain.handle("secret-skinbaron-session-connect-browser", async () => {
    ensureDesktopRuntimeUnlocked();
    try {
      const { apiOpenSkinBaronSessionLoginWindow } = await import("./secret-vault.js");
      return await apiOpenSkinBaronSessionLoginWindow();
    } catch (error) {
      return {
        ok: false,
        error: error?.message || String(error),
      };
    }
  });

  ipcMain.handle("secret-skinbaron-session-clear", async () => {
    ensureDesktopRuntimeUnlocked();
    const status = await clearSkinBaronSessionCookie();
    return { status, backendBaseUrl: backendBaseUrlRef };
  });

  // ── Local store operations ────────────────────────────────────
  safeLocalStoreInvoke("local-store-info", (store) => store.getInfo());
  safeLocalStoreInvoke("local-store-list-investments", (store, userId) => store.listInvestments(userId));
  safeLocalStoreInvoke("local-store-import-investments", (store, rows, userId) => store.importInvestments(rows, userId));
  safeLocalStoreInvoke("local-store-sync-steam-inventory", (store, rows, userId) => store.syncSteamInventory(rows, userId));
  safeLocalStoreInvoke("local-store-upsert-investment", (store, payload) => store.upsertInvestment(payload));
  safeLocalStoreInvoke("local-store-delete-investment", (store, id) => store.deleteInvestment(id));
  safeLocalStoreInvoke("local-store-delete-investment-silent", (store, id) => store.deleteInvestmentSilent(id));
  safeLocalStoreInvoke("local-store-get-investment", (store, id) => store.getInvestment(id));
  safeLocalStoreInvoke("local-store-list-watchlist", (store, userId) => store.listWatchlistItems(userId));
  safeLocalStoreInvoke("local-store-import-watchlist", (store, rows, userId) => store.importWatchlistItems(rows, userId));
  safeLocalStoreInvoke("local-store-upsert-watchlist-item", (store, payload) => store.upsertWatchlistItem(payload));
  safeLocalStoreInvoke("local-store-delete-watchlist-item", (store, id) => store.deleteWatchlistItem(id));
  safeLocalStoreInvoke("local-store-delete-watchlist-item-silent", (store, id) => store.deleteWatchlistItemSilent(id));
  safeLocalStoreInvoke("local-store-list-portfolio-snapshots", (store, userId, limit) => store.listPortfolioSnapshots(userId, limit));
  safeLocalStoreInvoke("local-store-upsert-portfolio-snapshot", (store, payload) => store.upsertPortfolioSnapshot(payload));
  safeLocalStoreInvoke("local-store-upsert-price", (store, payload) => store.upsertPrice(payload));
  safeLocalStoreInvoke("local-store-list-price-history", (store, itemId, limitDays) => store.listPriceHistory(itemId, limitDays));
  safeLocalStoreInvoke("local-store-list-pending-operations", (store, limit) => store.listPendingOperations(limit));
  safeLocalStoreInvoke("local-store-list-steam-csfloat-matches", (store, userId, status, limit) => store.listSteamCsfloatMatches(userId, status, limit));
  safeLocalStoreInvoke("local-store-update-steam-csfloat-match-status", (store, matchId, status) => store.updateSteamCsfloatMatchStatus(matchId, status));
  safeLocalStoreInvoke("local-store-create-notification", (store, payload) => store.createNotification(payload));
  safeLocalStoreInvoke("local-store-list-notifications", (store, userId, options) => store.listNotifications(userId, options));
  safeLocalStoreInvoke("local-store-mark-notification-read", (store, id) => store.markNotificationRead(id));
  safeLocalStoreInvoke("local-store-mark-all-notifications-read", (store, userId, category) => store.markAllNotificationsRead(userId, category));
  safeLocalStoreInvoke("local-store-mark-operation-applied", (store, id) => store.markOperationApplied(id));
  safeLocalStoreInvoke("local-store-get-portfolio-preferences", (store, userId) => store.getPortfolioPreferences(userId));
  safeLocalStoreInvoke("local-store-update-portfolio-preferences", (store, userId, patch) => store.updatePortfolioPreferences(userId, patch));
}
