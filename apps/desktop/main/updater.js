/* eslint-disable */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
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
let latestDownloadedFilePath = null;
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

// deb/rpm installs need root to replace themselves, so electron-updater shells
// out to pkexec. That can never succeed here: Chromium's namespace sandbox sets
// PR_SET_NO_NEW_PRIVS on the main process, every child inherits it, and a
// setuid binary launched under it drops its privileges — pkexec then aborts with
// "pkexec must be setuid root" (exit 127). Detect that up front so
// installDownloadedUpdate() can take the elevated-out-of-the-sandbox route
// instead of failing loudly.
function readLinuxPackageType() {
  try {
    return fs
      .readFileSync(path.join(process.resourcesPath, "package-type"), "utf8")
      .trim()
      .toLowerCase();
  } catch {
    return "";
  }
}

function hasNoNewPrivs() {
  try {
    const status = fs.readFileSync("/proc/self/status", "utf8");
    return /^NoNewPrivs:\s*1$/m.test(status);
  } catch {
    return false;
  }
}

export function resolveInstallHandoff() {
  if (process.platform !== "linux") {
    return { handoff: false, reason: null };
  }
  const packageType = readLinuxPackageType();
  if (packageType !== "deb" && packageType !== "rpm") {
    return { handoff: false, reason: null };
  }
  if (!hasNoNewPrivs()) {
    return { handoff: false, reason: null };
  }
  return { handoff: true, reason: "no-new-privs", packageType };
}

// Must match `updaterCacheDirName` in resources/app-update.yml, which
// electron-builder derives from the package name.
const UPDATER_CACHE_DIR_NAME = "cs-portfolio-tracking-monorepo-updater";

// The expected checksum is taken from the update metadata this session fetched
// from GitHub over TLS — never from the pending/update-info.json next to the
// package, which sits in the same user-writable directory an attacker would
// have to control to swap the package in the first place.
function resolveExpectedPackage() {
  const files = Array.isArray(latestAvailableUpdateInfo?.files)
    ? latestAvailableUpdateInfo.files
    : [];
  const entry = files.find((file) => String(file?.url || "").toLowerCase().endsWith(".deb"));
  if (!entry?.sha512) {
    return null;
  }
  try {
    return {
      fileName: path.basename(decodeURIComponent(String(entry.url))),
      // sha512sum prints hex; the feed carries base64.
      sha512Hex: Buffer.from(String(entry.sha512), "base64").toString("hex"),
    };
  } catch (error) {
    console.warn("[updater] could not read the expected checksum:", error?.message || error);
    return null;
  }
}

// The in-memory path is gone after a restart, so fall back to the package
// electron-updater left in its pending directory.
function resolveDownloadedPackagePath(fileName = "") {
  if (latestDownloadedFilePath && fs.existsSync(latestDownloadedFilePath)) {
    return latestDownloadedFilePath;
  }
  const pendingDir = path.join(app.getPath("cache"), UPDATER_CACHE_DIR_NAME, "pending");
  if (fileName) {
    const candidate = path.join(pendingDir, fileName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  try {
    const packages = fs
      .readdirSync(pendingDir)
      .filter((entry) => entry.toLowerCase().endsWith(".deb"))
      .map((entry) => path.join(pendingDir, entry));
    return packages.length === 1 ? packages[0] : null;
  } catch {
    return null;
  }
}

// `NO_NEW_PRIVS` is inherited, never dropped — but it is only inherited across
// fork/exec. Letting `systemd --user` (which does not carry the flag) spawn the
// installer therefore gets us a clean process in which pkexec works normally,
// so the update stays fully automatic behind a single Polkit prompt.
const ELEVATED_INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const EXIT_CHECKSUM_MISMATCH = 90;

function quoteForShell(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function runElevatedViaSystemdRun(script) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        "systemd-run",
        [
          "--user",
          "--collect",
          "--quiet",
          "--pipe",
          "--",
          "pkexec",
          // Without a Polkit agent we want a fast failure, not a prompt on a
          // tty nobody is looking at.
          "--disable-internal-agent",
          "/bin/bash",
          "-c",
          script,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      resolve({ ok: false, code: null, stderr: error?.message || String(error) });
      return;
    }

    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    // Killing our client does not stop the transient unit — systemd --user
    // cannot signal the root processes inside it — so a timeout means "outcome
    // unknown", not "did not happen".
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, ELEVATED_INSTALL_TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timer);
      // systemd-run missing entirely (non-systemd distro) lands here.
      resolve({ ok: false, code: null, timedOut, stderr: error?.message || String(error) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, code, timedOut, stderr: stderr.trim() });
    });
  });
}

// Copies the package somewhere only root can write, verifies it there, and only
// then installs it. Verifying the copy (rather than the original) closes the
// window in which the user-writable source could be swapped after the check.
//
// The install must end on a successful `dpkg -i`: plain
// `dpkg -i … || apt-get install -f -y` would exit 0 whenever apt finds nothing
// to repair, reporting success while the old version is still installed.
function buildElevatedInstallScript(filePath, sha512Hex) {
  return [
    "set -eu",
    `expected=${quoteForShell(sha512Hex)}`,
    'work=$(mktemp -d /var/tmp/csih-update-XXXXXX)',
    "trap 'rm -rf \"$work\"' EXIT",
    `cp ${quoteForShell(filePath)} "$work/package.deb"`,
    'actual=$(sha512sum "$work/package.deb" | cut -d" " -f1)',
    `[ "$actual" = "$expected" ] || exit ${EXIT_CHECKSUM_MISMATCH}`,
    'dpkg -i "$work/package.deb" || { apt-get install -f -y && dpkg -i "$work/package.deb"; }',
  ].join("\n");
}

// Returns "cancelled" when the user dismissed the Polkit dialog — that is a
// decision, not a failure, and must not trigger another prompt.
async function runElevatedDebInstall(filePath, sha512Hex) {
  const result = await runElevatedViaSystemdRun(buildElevatedInstallScript(filePath, sha512Hex));
  if (result.ok) {
    return "installed";
  }
  if (result.timedOut) {
    // The root-side dpkg is outside our reach and may still be running, so the
    // caller must not start a second package operation on top of it.
    console.warn("[updater] elevated install timed out; outcome unknown");
    return "timeout";
  }
  if (result.code === EXIT_CHECKSUM_MISMATCH) {
    console.error("[updater] downloaded package failed checksum verification — refusing to install");
    return "corrupt";
  }
  // pkexec: 126 = dialog dismissed, 127 = not authorized / could not elevate.
  if (result.code === 126) {
    console.log("[updater] elevated install cancelled by the user");
    return "cancelled";
  }
  console.warn(
    `[updater] elevated install failed (exit ${result.code}): ${result.stderr || "no stderr"}`,
  );
  return "failed";
}

// Opens the already-downloaded package with the desktop's package installer.
// Returns false when there is nothing to hand over, so callers can fall back.
async function handOffDownloadedPackage(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return false;
  }
  const error = await shell.openPath(filePath);
  if (error) {
    console.warn("[updater] handing the package to the system installer failed:", error);
    return false;
  }
  return true;
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
      // electron-updater omits the version here; carry it so the UI does not
      // fall back to a generic label mid-download.
      version: latestAvailableUpdateInfo?.version || null,
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
    latestDownloadedFilePath = info?.downloadedFile || null;
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

// Single entry point for "install the update now". Prefers the in-place
// electron-updater install and only steps aside where that path is provably
// dead (see resolveInstallHandoff).
export async function installDownloadedUpdate() {
  const { handoff, reason, packageType } = resolveInstallHandoff();
  if (handoff) {
    const version = latestAvailableUpdateInfo?.version || null;
    const expected = resolveExpectedPackage();
    const filePath = resolveDownloadedPackagePath(expected?.fileName);

    // Tier 1: elevate out of the sandbox and install in place. Requires a
    // checksum from the release feed — without it we will not run a package
    // from a user-writable directory as root.
    if (packageType === "deb" && filePath && expected) {
      emitUpdaterStatus({ state: "installing", version });
      const outcome = await runElevatedDebInstall(filePath, expected.sha512Hex);

      if (outcome === "installed") {
        console.log("[updater] elevated install succeeded, relaunching");
        app.relaunch();
        app.quit();
        return { ok: true, elevated: true };
      }
      if (outcome === "cancelled") {
        // Back to the state we came from; the package stays downloaded.
        emitUpdaterStatus({ state: "downloaded", version, info: latestAvailableUpdateInfo });
        return { ok: true, cancelled: true };
      }
      // Both of these must stop the cascade: after a timeout a root-side dpkg
      // may still be running, and a corrupt package must not be passed on to
      // another installer either.
      if (outcome === "timeout" || outcome === "corrupt") {
        const message =
          outcome === "timeout"
            ? "Die Installation hat zu lange gebraucht. Pruefe die installierte Version, bevor du es erneut versuchst."
            : "Das heruntergeladene Paket ist beschaedigt und wurde nicht installiert.";
        emitUpdaterStatus({ state: "error", version, message, url: RELEASES_PAGE_URL });
        return { ok: false, error: message, url: RELEASES_PAGE_URL };
      }
    }

    // Tier 2: let the desktop's package installer do it.
    const opened = await handOffDownloadedPackage(filePath);
    if (opened) {
      console.log(`[updater] handed the ${packageType} package to the system installer (${reason})`);
      emitUpdaterStatus({
        state: "handoff",
        version,
        path: filePath,
        reason,
        url: RELEASES_PAGE_URL,
      });
      return { ok: true, handoff: true, reason, path: filePath };
    }
    // Nothing downloaded (or no handler registered) — GitHub stays the way out.
    return { ok: false, handoff: true, reason, url: RELEASES_PAGE_URL };
  }

  autoUpdater.quitAndInstall();
  return { ok: true };
}

export function getUpdaterLatestInfo() {
  return latestAvailableUpdateInfo;
}

export function isUpdateDownloadInProgress() {
  return updateDownloadInProgress;
}
