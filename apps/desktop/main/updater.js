/* eslint-disable */

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;

// Kept in sync with build.publish in package.json.
const GITHUB_OWNER = "Control-ger";
const GITHUB_REPO = "CsPortfolioTracking";
export const RELEASES_PAGE_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

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

// The renderer reads notifications under the Steam-derived scope
// (`steam-<steamId>`), so background writes from here must target the same
// scope or they stay invisible in the bell. The renderer reports it on every
// notification poll; until then we fall back to the local database.
let activeNotificationUserId = null;

export function setActiveNotificationUserId(userId) {
  const normalized = String(userId ?? "").trim();
  if (normalized) {
    activeNotificationUserId = normalized;
  }
}

function resolveNotificationUserId(store) {
  if (activeNotificationUserId) {
    return activeNotificationUserId;
  }
  if (store && typeof store.resolveActiveLocalUserId === "function") {
    try {
      return store.resolveActiveLocalUserId();
    } catch (error) {
      console.warn("[updater] failed to resolve active user scope:", error?.message || error);
    }
  }
  return 1;
}

const AUTO_UPDATE_INTERVAL_MS = 10 * 60 * 1000;
let latestAvailableUpdateInfo = null;
let updateDownloadInProgress = false;
let updateCheckTimer = null;
let lastUpdaterStatus = null;

// Not every install can replace itself: an AppImage started without the
// APPIMAGE env var, a Snap, or an unpacked build. electron-updater answers
// that via isUpdaterActive() and then silently does nothing — so we ask first
// and fall back to "download it yourself from GitHub" instead of going quiet.
export function resolveSelfUpdateSupport() {
  if (!app.isPackaged) {
    return { supported: false, reason: "not-packaged" };
  }
  try {
    if (typeof autoUpdater.isUpdaterActive === "function" && !autoUpdater.isUpdaterActive()) {
      return { supported: false, reason: process.env.SNAP ? "snap" : "unsupported-install" };
    }
  } catch (error) {
    console.warn("[updater] isUpdaterActive check failed:", error?.message || error);
  }
  return { supported: true, reason: null };
}

export function describeSelfUpdateReason(reason) {
  if (reason === "snap") {
    return "Snap-Installation, Updates laufen ueber den Snap Store";
  }
  if (reason === "not-packaged") {
    return "Entwicklungsmodus";
  }
  return "z. B. AppImage ohne APPIMAGE-Umgebungsvariable oder entpackter Build";
}

export async function openReleasesPage() {
  await shell.openExternal(RELEASES_PAGE_URL);
  return true;
}

function compareVersions(left, right) {
  const parse = (value) =>
    String(value || "")
      .trim()
      .replace(/^v/i, "")
      .split("-")[0]
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }
  return 0;
}

// Version probe for installs that cannot self-update. electron-updater refuses
// to even fetch the feed in that case, so we read the GitHub release directly.
async function fetchLatestPublishedVersion() {
  const response = await fetch(RELEASES_API_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `${GITHUB_REPO}-desktop`,
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub Release-Feed antwortete mit ${response.status}`);
  }
  const data = await response.json();
  const version = String(data?.tag_name || "").trim().replace(/^v/i, "");
  if (!version) {
    throw new Error("GitHub Release-Feed enthielt keine Version.");
  }
  return version;
}

// Emits the same "available" shape as the self-update path, but flagged
// manual: the UI must send the user to GitHub instead of offering a download.
export async function checkForManualUpdate(reason = "unsupported-install") {
  try {
    const latestVersion = await fetchLatestPublishedVersion();
    if (compareVersions(latestVersion, app.getVersion()) <= 0) {
      emitUpdaterStatus({ state: "not-available", manual: true, reason });
      return { ok: true, updateAvailable: false };
    }

    const info = { version: latestVersion };
    latestAvailableUpdateInfo = info;
    emitUpdaterStatus({
      state: "manual",
      version: latestVersion,
      info,
      reason,
      url: RELEASES_PAGE_URL,
    });
    createSystemNotificationEntry({
      category: "app_update",
      title: "Update verfuegbar (manuell)",
      message: `${normalizeUpdateVersionLabel(info)} steht bereit. Diese Installation kann sich nicht selbst aktualisieren — auf GitHub herunterladen.`,
      payload: {
        state: "manual",
        version: latestVersion,
        reason,
        url: RELEASES_PAGE_URL,
      },
    });
    return { ok: true, updateAvailable: true, version: latestVersion, url: RELEASES_PAGE_URL };
  } catch (error) {
    const message = error?.message || String(error);
    console.warn("[updater] manual update check failed:", message);
    emitUpdaterStatus({ state: "error", message, manual: true, url: RELEASES_PAGE_URL });
    return { ok: false, error: message, url: RELEASES_PAGE_URL };
  }
}

function emitUpdaterStatus(payload) {
  // The startup check fires on a timer, so it can land while the renderer is
  // still booting or sitting on a screen that has no listener mounted yet —
  // an IPC push has no replay. Keep the last status so the UI can pull it.
  lastUpdaterStatus = payload || null;

  if (!mainWindowForUpdater || mainWindowForUpdater.isDestroyed()) {
    return;
  }
  mainWindowForUpdater.webContents.send("app-updater-status", payload);
}

export function getLastUpdaterStatus() {
  return lastUpdaterStatus;
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
  const support = resolveSelfUpdateSupport();
  if (!support.supported) {
    return { ok: false, reason: support.reason, url: RELEASES_PAGE_URL };
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
    // A failed download is a dead end for the user unless we point somewhere:
    // always carry the releases page along.
    emitUpdaterStatus({ state: "error", message, url: RELEASES_PAGE_URL });
    return { ok: false, error: message, url: RELEASES_PAGE_URL };
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

  const support = resolveSelfUpdateSupport();
  if (!support.supported) {
    const manualResponse = await dialog.showMessageBox(mainWindowForUpdater, {
      type: "info",
      buttons: ["Auf GitHub oeffnen", "Spaeter"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: "Update verfuegbar",
      message: `${versionLabel} ist verfuegbar.`,
      detail:
        "Diese Installation kann sich nicht selbst aktualisieren "
        + `(${describeSelfUpdateReason(support.reason)}). `
        + "Du kannst die neue Version direkt von GitHub herunterladen.",
    });
    if (manualResponse.response === 0) {
      await openReleasesPage();
      return { ok: true, manual: true, opened: true, url: RELEASES_PAGE_URL };
    }
    return { ok: true, manual: true, deferred: true, url: RELEASES_PAGE_URL };
  }

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

// Accepts either the injected getter or the directly injected instance, and
// rejects anything that is not an actual store (a Promise from an async getter,
// a factory function) instead of dropping the notification without a trace.
function resolveNotificationStore() {
  const candidates = [];
  if (typeof getLocalStoreForUpdater === "function") {
    try {
      candidates.push(getLocalStoreForUpdater());
    } catch (error) {
      console.warn("[updater] local store getter threw:", error?.message || error);
    }
  }
  candidates.push(localStoreForUpdater);

  for (const candidate of candidates) {
    if (candidate && typeof candidate.createNotification === "function") {
      return candidate;
    }
  }
  return null;
}

function createSystemNotificationEntry({
  category = "app_update",
  title = "App Update",
  message = "",
  payload = {},
  dedupeWindowHours = 24,
} = {}) {
  try {
    const store = resolveNotificationStore();
    if (!store) {
      console.warn(
        `[updater] no local store available — dropping "${title}" notification`,
      );
      return;
    }

    store.createNotification({
      userId: resolveNotificationUserId(store),
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

  // Installs that cannot replace themselves never reach the electron-updater
  // events below (checkForUpdates() returns null without touching the network),
  // so they get their own GitHub-backed check + "download it manually" path.
  const selfUpdateSupport = resolveSelfUpdateSupport();
  if (!selfUpdateSupport.supported) {
    console.log(
      `[updater] self-update unavailable (${selfUpdateSupport.reason}); falling back to manual GitHub check`,
    );
    const runManualCheck = () => void checkForManualUpdate(selfUpdateSupport.reason);
    setTimeout(runManualCheck, 15000);
    updateCheckTimer = setInterval(runManualCheck, AUTO_UPDATE_INTERVAL_MS);
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

    // Updates surface exclusively in the in-app system-notification bell
    // (persisted above). We intentionally no longer raise a native OS toast.
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
    const errorMessage = error?.message || String(error);
    console.error("[updater] error:", errorMessage);
    updateDownloadInProgress = false;
    emitUpdaterStatus({ state: "error", message: errorMessage, url: RELEASES_PAGE_URL });
    createSystemNotificationEntry({
      category: "app_update",
      title: "Update-Fehler",
      message: `${errorMessage || "Beim Update ist ein Fehler aufgetreten."} Die neue Version laesst sich auf GitHub manuell herunterladen.`,
      payload: {
        state: "error",
        error: errorMessage,
        url: RELEASES_PAGE_URL,
      },
      // Avoid spamming identical transient errors (e.g. offline) on every retry.
      dedupeWindowHours: 6,
    });
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
