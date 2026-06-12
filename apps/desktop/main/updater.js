/* eslint-disable */

import { app, BrowserWindow, dialog, Notification, ipcMain } from "electron";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;

// These are set by main/index.js after import
export let mainWindowForUpdater = null;
export let getLocalStoreForUpdater = null;
export let localStoreForUpdater = null;

export function setMainWindow(mw) {
  mainWindowForUpdater = mw;
}

export function setLocalStoreRefs(getStore, store) {
  getLocalStoreForUpdater = getStore;
  localStoreForUpdater = store;
}

const AUTO_UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;
const notifiedUpdateVersions = new Set();
let latestAvailableUpdateInfo = null;
let updateDownloadInProgress = false;
let updateCheckTimer = null;

function emitUpdaterStatus(payload) {
  if (!mainWindowForUpdater || mainWindowForUpdater.isDestroyed()) {
    return;
  }
  mainWindowForUpdater.webContents.send("app-updater-status", payload);
}

function normalizeUpdateVersionLabel(info) {
  const version = String(info?.version || "").trim();
  return version ? `v${version}` : "eine neue Version";
}

function bringMainWindowToFront() {
  if (!mainWindowForUpdater || mainWindowForUpdater.isDestroyed()) {
    return;
  }
  if (mainWindowForUpdater.isMinimized()) {
    mainWindowForUpdater.restore();
  }
  mainWindowForUpdater.show();
  mainWindowForUpdater.focus();
}

export async function startUpdateDownload(info = latestAvailableUpdateInfo) {
  if (!app.isPackaged) {
    return { ok: false, reason: "not-packaged" };
  }
  if (updateDownloadInProgress) {
    return { ok: true, alreadyDownloading: true };
  }

  const versionLabel = normalizeUpdateVersionLabel(info);
  updateDownloadInProgress = true;
  emitUpdaterStatus({ state: "downloading", percent: 0, version: info?.version || null, info });
  console.log("[updater] starting manual download:", versionLabel);

  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (error) {
    updateDownloadInProgress = false;
    const message = error?.message || String(error);
    console.warn("[updater] manual download failed:", message);
    emitUpdaterStatus({ state: "error", message });
    return { ok: false, error: message };
  }
}

export async function promptForUpdateDownload(info = latestAvailableUpdateInfo) {
  if (!info) {
    return { ok: false, reason: "no-update-info" };
  }
  if (updateDownloadInProgress) {
    return { ok: true, alreadyDownloading: true };
  }

  const versionLabel = normalizeUpdateVersionLabel(info);
  bringMainWindowToFront();

  const response = await dialog.showMessageBox(mainWindowForUpdater, {
    type: "question",
    buttons: ["Jetzt updaten", "Spaeter"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: "Update verfuegbar",
    message: `${versionLabel} ist verfuegbar.`,
    detail: "Moechtest du das Update jetzt herunterladen und nach dem Download installieren?",
  });

  if (response.response !== 0) {
    emitUpdaterStatus({ state: "available", version: info?.version || null, info, deferred: true });
    return { ok: true, deferred: true };
  }

  return await startUpdateDownload(info);
}

function showUpdateAvailableNotification(info) {
  if (!Notification.isSupported()) {
    return false;
  }

  const versionLabel = normalizeUpdateVersionLabel(info);
  try {
    const notification = new Notification({
      title: "Update verfuegbar",
      body: `${versionLabel} ist verfuegbar. Klick fuer "Jetzt updaten" oder "Spaeter".`,
      silent: false,
    });

    notification.on("click", () => {
      void promptForUpdateDownload(info);
    });
    notification.on("failed", (_event, error) => {
      console.warn("[updater] native notification failed:", error);
    });
    notification.show();
    return true;
  } catch (error) {
    console.warn("[updater] unable to show native notification:", error?.message || error);
    return false;
  }
}

function createSystemNotificationEntry({
  category = "app_update",
  title = "App Update",
  message = "",
  payload = {},
  dedupeWindowHours = 24,
} = {}) {
  try {
    const store = getLocalStoreForUpdater ? getLocalStoreForUpdater() : null;
    if (!store || typeof store.createNotification !== "function") {
      return;
    }

    store.createNotification({
      userId: 1,
      category,
      title,
      message,
      payload,
      dedupeWindowHours,
    });
  } catch (error) {
    console.warn("[updater] failed to persist system notification entry:", error?.message || error);
  }
}

export function setupAutoUpdater() {
  if (!app.isPackaged) {
    console.log("[updater] skipped in development mode");
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("checking-for-update", () => {
    console.log("[updater] checking for update");
    emitUpdaterStatus({ state: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    console.log("[updater] update available:", info?.version || "unknown");
    latestAvailableUpdateInfo = info || null;
    updateDownloadInProgress = false;
    emitUpdaterStatus({ state: "available", version: info?.version || null, info });
    createSystemNotificationEntry({
      category: "app_update",
      title: "Update verfuegbar",
      message: `${normalizeUpdateVersionLabel(info)} kann jetzt heruntergeladen werden.`,
      payload: {
        state: "available",
        version: info?.version || null,
      },
    });

    const versionKey = String(info?.version || "unknown");
    if (!notifiedUpdateVersions.has(versionKey)) {
      notifiedUpdateVersions.add(versionKey);
      const shown = showUpdateAvailableNotification(info);
      if (!shown) {
        bringMainWindowToFront();
      }
    }
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[updater] no update available");
    latestAvailableUpdateInfo = null;
    updateDownloadInProgress = false;
    emitUpdaterStatus({ state: "not-available" });
  });

  autoUpdater.on("download-progress", (progress) => {
    updateDownloadInProgress = true;
    emitUpdaterStatus({
      state: "downloading",
      percent: progress?.percent || 0,
      bytesPerSecond: progress?.bytesPerSecond || 0,
      transferred: progress?.transferred || 0,
      total: progress?.total || 0,
    });
  });

  autoUpdater.on("error", (error) => {
    console.error("[updater] error:", error?.message || error);
    updateDownloadInProgress = false;
    emitUpdaterStatus({ state: "error", message: error?.message || String(error) });
  });

  autoUpdater.on("update-downloaded", async (info) => {
    console.log("[updater] update downloaded:", info?.version || "unknown");
    latestAvailableUpdateInfo = info || latestAvailableUpdateInfo;
    updateDownloadInProgress = false;
    emitUpdaterStatus({ state: "downloaded", version: info?.version || null, info });
    createSystemNotificationEntry({
      category: "app_update",
      title: "Update bereit",
      message: `${normalizeUpdateVersionLabel(info)} wurde heruntergeladen und kann installiert werden.`,
      payload: {
        state: "downloaded",
        version: info?.version || null,
      },
    });
  });

  const checkForUpdates = async () => {
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      console.warn("[updater] check failed:", error?.message || error);
    }
  };

  setTimeout(checkForUpdates, 15000);
  updateCheckTimer = setInterval(checkForUpdates, AUTO_UPDATE_INTERVAL_MS);
}

export function clearUpdateCheckTimer() {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
}

export function getUpdaterLatestInfo() {
  return latestAvailableUpdateInfo;
}

export function isUpdateDownloadInProgress() {
  return updateDownloadInProgress;
}
