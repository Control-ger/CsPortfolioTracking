/* eslint-disable */
import { app, BrowserWindow, dialog, ipcMain, Notification, shell, safeStorage, session } from "electron";
import { spawn } from "child_process";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import fs from "fs/promises";
import fsSync from "fs";
import net from "net";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;
const DESKTOP_APP_NAME = "CS Investor Hub";
const DESKTOP_APP_ID = "com.csportfolio";

app.setName(DESKTOP_APP_NAME);
if (typeof app.setAppUserModelId === "function") {
  app.setAppUserModelId(DESKTOP_APP_ID);
}

// ============================================================
// Debug / Logging Setup
// ============================================================

const LOG_FILE = path.join(app.getPath("userData"), "electron-debug.log");

// Redirect console output to a log file
function setupFileLogging() {
  const logStream = fsSync.createWriteStream(LOG_FILE, { flags: "a" });
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (...args) => {
    const msg = `[${new Date().toISOString()}] [LOG] ${args.map(String).join(" ")}`;
    logStream.write(msg + "\n");
    originalLog(...args);
  };
  console.warn = (...args) => {
    const msg = `[${new Date().toISOString()}] [WARN] ${args.map(String).join(" ")}`;
    logStream.write(msg + "\n");
    originalWarn(...args);
  };
  console.error = (...args) => {
    const msg = `[${new Date().toISOString()}] [ERROR] ${args.map(String).join(" ")}`;
    logStream.write(msg + "\n");
    originalError(...args);
  };

  // Catch unhandled rejections
  process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason);
  });

  // Catch uncaught exceptions
  process.on("uncaughtException", (error) => {
    console.error("[uncaughtException]", error);
  });

  console.log("[main] File logging initialized ->", LOG_FILE);
}

// Run setup before app is ready
setupFileLogging();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheFileName = "cache.json";
const sessionFileName = "session.json";
const serverConfigFileName = "server-config.json";
const secretsDirName = "secrets";
const csFloatApiKeyFileName = "csfloat-api-key.bin";
const skinBaronApiKeyFileName = "skinbaron-api-key.bin";
const skinBaronSessionCookieFileName = "skinbaron-session-cookie.bin";
const skinBaronCapabilitiesFileName = "skinbaron-capabilities.json";
const skinBaronSessionProbeFileName = "skinbaron-session-probe.json";
const encryptionKeyFileName = "encryption-key.bin";
const secretVaultFileName = "secret-vault.json";
const secretVaultPreferencesFileName = "secret-vault-preferences.json";
const csFloatApiKeyVaultFileName = "csfloat-api-key.vault.json";
const skinBaronApiKeyVaultFileName = "skinbaron-api-key.vault.json";
const skinBaronSessionCookieVaultFileName = "skinbaron-session-cookie.vault.json";
const SECRET_VAULT_VERSION = 1;
const SECRET_VAULT_PASSWORD_MIN_LENGTH = 16;
const SECRET_VAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const SECRET_VAULT_AUTO_LOCK_DEFAULT = false;
let createLocalStore = null;
let localStore = null;
let distIndexPath = null; // Will be set when app is ready
let phpSidecar = null;
let backendBaseUrl = null;
let sidecarSecret = null;
let updateCheckTimer = null;
let cloudflareAccessLoginPromise = null;
let skinBaronSessionLoginPromise = null;
let sidecarRequestHeaderBridgeInstalled = false;
let latestAvailableUpdateInfo = null;
let updateDownloadInProgress = false;
let secretVaultConfigCache = null;
let secretVaultPreferencesCache = null;
let unlockedSecretVaultMasterKey = null;
let secretVaultUnlockedAt = null;
let secretVaultLastActivityAt = 0;
let secretVaultAutoLockTimer = null;
let sidecarSecretsUnlockedForCurrentRun = false;
const notifiedUpdateVersions = new Set();
const AUTO_UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;
const shouldAutoOpenDevTools = !app.isPackaged || process.env.DEBUG === "1";

function emitUpdaterStatus(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("app-updater-status", payload);
}

function normalizeUpdateVersionLabel(info) {
  const version = String(info?.version || "").trim();
  return version ? `v${version}` : "eine neue Version";
}

function bringMainWindowToFront() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

async function startUpdateDownload(info = latestAvailableUpdateInfo) {
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

async function promptForUpdateDownload(info = latestAvailableUpdateInfo) {
  if (!info) {
    return { ok: false, reason: "no-update-info" };
  }
  if (updateDownloadInProgress) {
    return { ok: true, alreadyDownloading: true };
  }

  const versionLabel = normalizeUpdateVersionLabel(info);
  bringMainWindowToFront();

  const response = await dialog.showMessageBox(mainWindow, {
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
    const store = getLocalStore();
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

function setupAutoUpdater() {
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
        // Fallback when the native toast cannot be displayed.
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

function resolvePhpBinary() {
  const explicit = String(process.env.PHP_BINARY || "").trim();
  if (explicit && fsSync.existsSync(explicit)) {
    return explicit;
  }

  const candidates = [
    // Common local install path used in this project environment
    "C:\\tools\\php85\\php.exe",
    // Bundle-friendly locations (if we decide to ship php with the app)
    resolveRuntimePath("php", "php.exe"),
    path.join(process.resourcesPath || "", "php", "php.exe"),
    // Last fallback: rely on PATH
    "php",
  ];

  for (const candidate of candidates) {
    if (candidate === "php") {
      return candidate;
    }
    if (candidate && fsSync.existsSync(candidate)) {
      return candidate;
    }
  }

  return "php";
}

function getLocalStore() {
  if (!localStore) {
    localStore = createLocalStore(app.getPath("userData"));
  }
  return localStore;
}

function getCacheFilePath() {
  return path.join(app.getPath("userData"), cacheFileName);
}

function getSessionFilePath() {
  return path.join(app.getPath("userData"), sessionFileName);
}

function getServerConfigFilePath() {
  return path.join(app.getPath("userData"), serverConfigFileName);
}

function getSecretsDirPath() {
  return path.join(app.getPath("userData"), secretsDirName);
}

function getCsFloatApiKeyFilePath() {
  return path.join(getSecretsDirPath(), csFloatApiKeyFileName);
}

function getSkinBaronApiKeyFilePath() {
  return path.join(getSecretsDirPath(), skinBaronApiKeyFileName);
}

function getSkinBaronSessionCookieFilePath() {
  return path.join(getSecretsDirPath(), skinBaronSessionCookieFileName);
}

function getSkinBaronCapabilitiesFilePath() {
  return path.join(getSecretsDirPath(), skinBaronCapabilitiesFileName);
}

function getSkinBaronSessionProbeFilePath() {
  return path.join(getSecretsDirPath(), skinBaronSessionProbeFileName);
}

function getEncryptionKeyFilePath() {
  return path.join(getSecretsDirPath(), encryptionKeyFileName);
}

function getSecretVaultFilePath() {
  return path.join(getSecretsDirPath(), secretVaultFileName);
}

function getSecretVaultPreferencesFilePath() {
  return path.join(getSecretsDirPath(), secretVaultPreferencesFileName);
}

function getCsFloatApiKeyVaultFilePath() {
  return path.join(getSecretsDirPath(), csFloatApiKeyVaultFileName);
}

function getSkinBaronApiKeyVaultFilePath() {
  return path.join(getSecretsDirPath(), skinBaronApiKeyVaultFileName);
}

function getSkinBaronSessionCookieVaultFilePath() {
  return path.join(getSecretsDirPath(), skinBaronSessionCookieVaultFileName);
}

function getOrCreateEncryptionKey() {
  const filePath = getEncryptionKeyFilePath();

  // Try to read existing key
  if (fsSync.existsSync(filePath)) {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn("[desktop-secrets] safeStorage unavailable; cannot decrypt encryption key");
      return null;
    }
    try {
      const encrypted = fsSync.readFileSync(filePath);
      return safeStorage.decryptString(encrypted);
    } catch (error) {
      console.warn("[desktop-secrets] failed to decrypt encryption key, regenerating", error);
    }
  }

  // Generate new key if needed
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn("[desktop-secrets] safeStorage unavailable; cannot store encryption key");
    return null;
  }

  try {
    const newKey = randomBytes(32).toString("hex");
    const encrypted = safeStorage.encryptString(newKey);
    fsSync.mkdirSync(getSecretsDirPath(), { recursive: true });
    fsSync.writeFileSync(filePath, encrypted);
    console.log("[desktop-secrets] generated new encryption key for session tokens");
    return newKey;
  } catch (error) {
    console.error("[desktop-secrets] failed to create encryption key", error);
    return null;
  }
}

function toBase64(buffer) {
  return Buffer.from(buffer).toString("base64");
}

function fromBase64(value) {
  return Buffer.from(String(value || ""), "base64");
}

function loadSecretVaultConfig() {
  if (secretVaultConfigCache) {
    return secretVaultConfigCache;
  }

  const filePath = getSecretVaultFilePath();
  if (!fsSync.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fsSync.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (Number(parsed.version) !== SECRET_VAULT_VERSION) {
      console.warn("[desktop-secrets] unsupported secret vault version");
      return null;
    }

    secretVaultConfigCache = parsed;
    return parsed;
  } catch (error) {
    console.warn("[desktop-secrets] failed to read secret vault config", error);
    return null;
  }
}

function getDefaultSecretVaultPreferences() {
  return {
    autoLockEnabled: SECRET_VAULT_AUTO_LOCK_DEFAULT,
  };
}

function normalizeSecretVaultPreferences(input) {
  const normalized = getDefaultSecretVaultPreferences();
  if (input && typeof input === "object") {
    if (typeof input.autoLockEnabled === "boolean") {
      normalized.autoLockEnabled = input.autoLockEnabled;
    }
  }
  return normalized;
}

function loadSecretVaultPreferences() {
  if (secretVaultPreferencesCache) {
    return secretVaultPreferencesCache;
  }

  const filePath = getSecretVaultPreferencesFilePath();
  if (!fsSync.existsSync(filePath)) {
    secretVaultPreferencesCache = getDefaultSecretVaultPreferences();
    return secretVaultPreferencesCache;
  }

  try {
    const raw = fsSync.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    secretVaultPreferencesCache = normalizeSecretVaultPreferences(parsed);
    return secretVaultPreferencesCache;
  } catch (error) {
    console.warn("[desktop-secrets] failed to read secret vault preferences", error);
    secretVaultPreferencesCache = getDefaultSecretVaultPreferences();
    return secretVaultPreferencesCache;
  }
}

async function writeSecretVaultPreferences(prefs) {
  const normalized = normalizeSecretVaultPreferences(prefs);
  await fs.mkdir(getSecretsDirPath(), { recursive: true });
  await fs.writeFile(getSecretVaultPreferencesFilePath(), JSON.stringify(normalized, null, 2), "utf8");
  secretVaultPreferencesCache = normalized;
  return normalized;
}

async function writeSecretVaultConfig(config) {
  await fs.mkdir(getSecretsDirPath(), { recursive: true });
  await fs.writeFile(getSecretVaultFilePath(), JSON.stringify(config, null, 2), "utf8");
  secretVaultConfigCache = config;
}

function isSecretVaultConfigured() {
  return Boolean(loadSecretVaultConfig());
}

function deriveSecretVaultWrappingKey(password, saltBuffer) {
  return scryptSync(String(password || ""), saltBuffer, 32);
}

function encryptSecretVaultPayload(plaintextBuffer, keyBuffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBuffer, iv);
  const encrypted = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: toBase64(iv),
    ciphertext: toBase64(encrypted),
    tag: toBase64(tag),
  };
}

function decryptSecretVaultPayload(payload, keyBuffer) {
  const iv = fromBase64(payload?.iv);
  const ciphertext = fromBase64(payload?.ciphertext);
  const tag = fromBase64(payload?.tag);
  const decipher = createDecipheriv("aes-256-gcm", keyBuffer, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function getSecretVaultMasterKeyFromMemory() {
  return unlockedSecretVaultMasterKey ? Buffer.from(unlockedSecretVaultMasterKey) : null;
}

function clearSecretVaultMasterKeyFromMemory() {
  if (unlockedSecretVaultMasterKey) {
    unlockedSecretVaultMasterKey.fill(0);
    unlockedSecretVaultMasterKey = null;
  }
}

function getSafeStorageBackendLabel() {
  if (typeof safeStorage.getSelectedStorageBackend !== "function") {
    return "unknown";
  }
  try {
    return String(safeStorage.getSelectedStorageBackend() || "unknown");
  } catch {
    return "unknown";
  }
}

function getSecretVaultStatus() {
  const preferences = loadSecretVaultPreferences();
  const configured = isSecretVaultConfigured();
  const unlocked = configured && Boolean(unlockedSecretVaultMasterKey);
  const now = Date.now();
  const autoLockEnabled = preferences.autoLockEnabled === true;
  const remainingMs = unlocked && autoLockEnabled
    ? Math.max(0, SECRET_VAULT_IDLE_TIMEOUT_MS - Math.max(0, now - secretVaultLastActivityAt))
    : 0;

  return {
    configured,
    unlocked,
    idleTimeoutMinutes: Math.round(SECRET_VAULT_IDLE_TIMEOUT_MS / 60000),
    minPasswordLength: SECRET_VAULT_PASSWORD_MIN_LENGTH,
    lastUnlockedAt: secretVaultUnlockedAt,
    remainingSeconds: Math.ceil(remainingMs / 1000),
    safeStorageAvailable: safeStorage.isEncryptionAvailable(),
    safeStorageBackend: getSafeStorageBackendLabel(),
    platform: process.platform,
    policy: {
      requireUnlockAfterRestart: true,
      autoLockOnIdle: autoLockEnabled,
    },
  };
}

function scheduleSecretVaultAutoLock() {
  if (secretVaultAutoLockTimer) {
    clearTimeout(secretVaultAutoLockTimer);
    secretVaultAutoLockTimer = null;
  }

  if (!unlockedSecretVaultMasterKey) {
    return;
  }
  const preferences = loadSecretVaultPreferences();
  if (preferences.autoLockEnabled !== true) {
    return;
  }

  secretVaultAutoLockTimer = setTimeout(() => {
    void lockSecretVault("idle-timeout");
  }, SECRET_VAULT_IDLE_TIMEOUT_MS + 250);
}

function touchSecretVaultActivity() {
  if (!unlockedSecretVaultMasterKey) {
    return getSecretVaultStatus();
  }
  secretVaultLastActivityAt = Date.now();
  if (loadSecretVaultPreferences().autoLockEnabled === true) {
    scheduleSecretVaultAutoLock();
  }
  return getSecretVaultStatus();
}

async function lockSecretVault(reason = "manual-lock") {
  const wasUnlocked = Boolean(unlockedSecretVaultMasterKey);
  clearSecretVaultMasterKeyFromMemory();
  secretVaultLastActivityAt = 0;
  secretVaultUnlockedAt = null;
  if (secretVaultAutoLockTimer) {
    clearTimeout(secretVaultAutoLockTimer);
    secretVaultAutoLockTimer = null;
  }
  sidecarSecretsUnlockedForCurrentRun = false;
  if (wasUnlocked) {
    await restartPhpSidecar().catch((error) => {
      console.warn("[desktop-secrets] sidecar restart after lock failed", error);
    });
  }
  return getSecretVaultStatus();
}

async function ensureSecretVaultUnlocked() {
  if (!isSecretVaultConfigured()) {
    throw new Error("Secret Vault ist noch nicht eingerichtet.");
  }
  if (!unlockedSecretVaultMasterKey) {
    const error = new Error("Secret Vault ist gesperrt.");
    error.code = "SECRET_VAULT_LOCKED";
    throw error;
  }
}

function readEncryptedSecretFile(filePath, masterKey) {
  if (!fsSync.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fsSync.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const decrypted = decryptSecretVaultPayload(parsed.payload, masterKey);
    return decrypted.toString("utf8");
  } catch (error) {
    console.warn("[desktop-secrets] failed to read encrypted secret file", filePath, error);
    return null;
  }
}

async function writeEncryptedSecretFile(filePath, plaintext, masterKey, metadata = {}) {
  const payload = encryptSecretVaultPayload(Buffer.from(String(plaintext || ""), "utf8"), masterKey);
  await fs.mkdir(getSecretsDirPath(), { recursive: true });
  await fs.writeFile(
    filePath,
    JSON.stringify(
      {
        version: 1,
        updatedAt: new Date().toISOString(),
        metadata,
        payload,
      },
      null,
      2,
    ),
    "utf8",
  );
}

function readSecretMetadata(filePath) {
  if (!fsSync.existsSync(filePath)) {
    return {};
  }
  try {
    const raw = fsSync.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.metadata || typeof parsed.metadata !== "object") {
      return {};
    }
    return parsed.metadata;
  } catch {
    return {};
  }
}

async function migrateLegacySecretFileIfNeeded({ legacyFilePath, vaultFilePath, normalize = (value) => value }) {
  if (!safeStorage.isEncryptionAvailable()) {
    return;
  }
  if (!unlockedSecretVaultMasterKey) {
    return;
  }
  if (!fsSync.existsSync(legacyFilePath) || fsSync.existsSync(vaultFilePath)) {
    return;
  }

  try {
    const encrypted = fsSync.readFileSync(legacyFilePath);
    const decrypted = normalize(safeStorage.decryptString(encrypted));
    if (!decrypted) {
      return;
    }
    await writeEncryptedSecretFile(
      vaultFilePath,
      decrypted,
      unlockedSecretVaultMasterKey,
      { lastFour: String(decrypted).slice(-4) },
    );
    await fs.unlink(legacyFilePath).catch(() => {});
    console.log("[desktop-secrets] migrated legacy secret file:", path.basename(legacyFilePath));
  } catch (error) {
    console.warn("[desktop-secrets] failed to migrate legacy secret file", legacyFilePath, error);
  }
}

async function migrateLegacySecretsIfNeeded() {
  await migrateLegacySecretFileIfNeeded({
    legacyFilePath: getCsFloatApiKeyFilePath(),
    vaultFilePath: getCsFloatApiKeyVaultFilePath(),
  });
  await migrateLegacySecretFileIfNeeded({
    legacyFilePath: getSkinBaronApiKeyFilePath(),
    vaultFilePath: getSkinBaronApiKeyVaultFilePath(),
  });
  await migrateLegacySecretFileIfNeeded({
    legacyFilePath: getSkinBaronSessionCookieFilePath(),
    vaultFilePath: getSkinBaronSessionCookieVaultFilePath(),
    normalize: (value) => normalizeSkinBaronSessionCookieInput(value) || "",
  });
}

async function configureSecretVaultPassword(password) {
  const normalizedPassword = String(password || "");
  if (normalizedPassword.length < SECRET_VAULT_PASSWORD_MIN_LENGTH) {
    throw new Error(`App-Passwort muss mindestens ${SECRET_VAULT_PASSWORD_MIN_LENGTH} Zeichen haben.`);
  }
  if (isSecretVaultConfigured()) {
    throw new Error("Secret Vault ist bereits eingerichtet.");
  }

  const salt = randomBytes(16);
  const wrappingKey = deriveSecretVaultWrappingKey(normalizedPassword, salt);
  const masterKey = randomBytes(32);
  const wrappedMaster = encryptSecretVaultPayload(masterKey, wrappingKey);

  await writeSecretVaultConfig({
    version: SECRET_VAULT_VERSION,
    createdAt: new Date().toISOString(),
    wrap: {
      algorithm: "aes-256-gcm",
      kdf: "scrypt",
      salt: toBase64(salt),
      payload: wrappedMaster,
    },
  });

  unlockedSecretVaultMasterKey = Buffer.from(masterKey);
  secretVaultUnlockedAt = new Date().toISOString();
  secretVaultLastActivityAt = Date.now();
  scheduleSecretVaultAutoLock();

  wrappingKey.fill(0);
  masterKey.fill(0);

  await migrateLegacySecretsIfNeeded();
  sidecarSecretsUnlockedForCurrentRun = true;
  await restartPhpSidecar().catch((error) => {
    console.warn("[desktop-secrets] sidecar restart after vault setup failed", error);
  });

  return getSecretVaultStatus();
}

async function unlockSecretVault(password) {
  const config = loadSecretVaultConfig();
  if (!config) {
    throw new Error("Secret Vault ist noch nicht eingerichtet.");
  }
  const normalizedPassword = String(password || "");
  if (!normalizedPassword) {
    throw new Error("Bitte App-Passwort eingeben.");
  }

  try {
    const salt = fromBase64(config.wrap?.salt);
    const wrappingKey = deriveSecretVaultWrappingKey(normalizedPassword, salt);
    const masterKey = decryptSecretVaultPayload(config.wrap?.payload || {}, wrappingKey);
    wrappingKey.fill(0);

    clearSecretVaultMasterKeyFromMemory();
    unlockedSecretVaultMasterKey = Buffer.from(masterKey);
    masterKey.fill(0);
    secretVaultUnlockedAt = new Date().toISOString();
    secretVaultLastActivityAt = Date.now();
    scheduleSecretVaultAutoLock();

    await migrateLegacySecretsIfNeeded();
    sidecarSecretsUnlockedForCurrentRun = true;
    await restartPhpSidecar().catch((error) => {
      console.warn("[desktop-secrets] sidecar restart after unlock failed", error);
    });
    return getSecretVaultStatus();
  } catch (error) {
    const unlockError = new Error("App-Passwort ist ungueltig.");
    unlockError.code = "SECRET_VAULT_INVALID_PASSWORD";
    throw unlockError;
  }
}

async function updateSecretVaultPreferences(patch = {}) {
  const current = loadSecretVaultPreferences();
  const next = {
    ...current,
    ...patch,
  };
  await writeSecretVaultPreferences(next);

  if (unlockedSecretVaultMasterKey) {
    secretVaultLastActivityAt = Date.now();
    scheduleSecretVaultAutoLock();
  }

  return getSecretVaultStatus();
}

function resolveRuntimePath(...segments) {
  const appPath = app.getAppPath();
  const candidates = [
    path.join(process.resourcesPath, "app.asar.unpacked", ...segments),
    path.join(process.resourcesPath, ...segments),
    path.join(appPath, ...segments),
  ];

  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function isAsarVirtualPath(targetPath) {
  const normalized = String(targetPath || "").replace(/\//g, "\\").toLowerCase();
  return normalized.includes("\\app.asar\\");
}

function readDotEnvFile(filePath) {
  if (!fsSync.existsSync(filePath)) {
    return {};
  }

  const values = {};
  const lines = fsSync.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^["']|["']$/g, "");

    if (key) {
      values[key] = value;
    }
  }

  return values;
}

function buildSidecarEnv(extraEnv = {}) {
  const envFileValues = readDotEnvFile(resolveRuntimePath(".env"));
  const merged = {
    ...envFileValues,
    ...process.env,
  };
  const localCsFloatApiKey = getStoredCsFloatApiKey();
  const localSkinBaronApiKey = getStoredSkinBaronApiKey();
  const localSkinBaronSessionCookie = getStoredSkinBaronSessionCookie();
  const encryptionKey = getOrCreateEncryptionKey();

  merged.APP_ENV = merged.APP_ENV || "desktop";
  merged.DESKTOP_SIDECAR_SECRET = sidecarSecret;
  merged.DESKTOP_LOG_FILE = LOG_FILE;
  merged.DESKTOP_STATE_DIR = app.getPath("userData");
  delete merged.CSFLOAT_API_KEY;
  delete merged.SKINBARON_API_KEY;
  delete merged.SKINBARON_SESSION_COOKIE;
  if (localCsFloatApiKey && sidecarSecretsUnlockedForCurrentRun) {
    merged.CSFLOAT_API_KEY = localCsFloatApiKey;
  }
  if (localSkinBaronApiKey && sidecarSecretsUnlockedForCurrentRun) {
    merged.SKINBARON_API_KEY = localSkinBaronApiKey;
  }
  if (localSkinBaronSessionCookie && sidecarSecretsUnlockedForCurrentRun) {
    merged.SKINBARON_SESSION_COOKIE = localSkinBaronSessionCookie;
  }
  if (encryptionKey) {
    merged.ENCRYPTION_KEY = encryptionKey;
  }

  if (!merged.DESKTOP_DB_HOST && merged.DB_HOST === "db") {
    merged.DB_HOST = "127.0.0.1";
  } else if (merged.DESKTOP_DB_HOST) {
    merged.DB_HOST = merged.DESKTOP_DB_HOST;
  }

  const savedServerConfig = getStoredServerConfig();
  if (savedServerConfig?.serverUrl) {
    merged.UPSTREAM_API_BASE_URL = savedServerConfig.serverUrl;
  }

  return {
    ...merged,
    ...extraEnv,
  };
}

function normalizeServerConfigValue(value) {
  const normalized = String(value || "").trim().replace(/\/+$/, "");
  if (!normalized) {
    return "";
  }

  // Legacy compatibility: older configs may contain only a hostname.
  const hostOnly = normalizeServerHost(normalized);
  if (hostOnly) {
    return buildServerBaseUrl(hostOnly);
  }

  try {
    const parsed = new URL(normalized);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "";
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function normalizeServerHost(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  const hostPattern =
    /^(localhost|(\d{1,3}\.){3}\d{1,3}|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)(:\d{1,5})?$/i;

  const parseUrlHost = (candidateValue) => {
    const withScheme = candidateValue.startsWith("//")
      ? `https:${candidateValue}`
      : /^[a-z][a-z0-9+.-]*:\/\//i.test(candidateValue)
        ? candidateValue
        : "";
    if (!withScheme) {
      return "";
    }
    try {
      const parsed = new URL(withScheme);
      const host = parsed.hostname || "";
      const port = parsed.port ? `:${parsed.port}` : "";
      return `${host}${port}`;
    } catch {
      return "";
    }
  };

  const parsedHost = parseUrlHost(trimmed);
  let candidate = parsedHost || trimmed;
  candidate = candidate.replace(/\\/g, "/");

  if (!parsedHost) {
    candidate = candidate.split(/[/?#]/, 1)[0] || "";
    const atIndex = candidate.lastIndexOf("@");
    if (atIndex >= 0) {
      candidate = candidate.slice(atIndex + 1);
    }
  }

  candidate = candidate.trim().replace(/^\[|\]$/g, "");
  if (!candidate || !hostPattern.test(candidate)) {
    return "";
  }
  return candidate.toLowerCase();
}

function buildServerBaseUrl(hostname) {
  const trimmed = String(hostname || "").trim();
  if (!trimmed) {
    return "";
  }
  return `https://${trimmed}/api/index.php`;
}

function resolveAccessBaseUrl(serverBaseUrl) {
  const normalized = String(serverBaseUrl || "").trim().replace(/\/+$/, "");
  if (!normalized) {
    return "";
  }

  const lower = normalized.toLowerCase();
  if (lower.endsWith("/api/index.php")) {
    return normalized.slice(0, -"/api/index.php".length);
  }
  if (lower.endsWith("/api")) {
    return normalized.slice(0, -"/api".length);
  }
  return normalized;
}

async function getAccessCookieHeader(accessBaseUrl) {
  const baseUrl = String(accessBaseUrl || "").trim();
  if (!baseUrl) {
    return "";
  }

  try {
    const cookies = await session.defaultSession.cookies.get({ url: baseUrl });
    console.log("[cloudflare-access] cookies found:", cookies.length);
    cookies.forEach(c => {
      console.log(`[cloudflare-access] cookie: ${c.name}, domain: ${c.domain}, path: ${c.path}, httpOnly: ${c.httpOnly}, secure: ${c.secure}`);
    });
    
    if (!Array.isArray(cookies) || cookies.length === 0) {
      return "";
    }
    const cfCookie = cookies.find(c => c.name === "CF_Authorization");
    console.log("[cloudflare-access] CF_Authorization present:", !!cfCookie);
    if (cfCookie) {
      console.log("[cloudflare-access] CF_Authorization domain:", cfCookie.domain, "path:", cfCookie.path);
    }
    return cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
  } catch (error) {
    console.warn("[cloudflare-access] failed to read cookies", error);
    return "";
  }
}

async function hasCloudflareAccessIdentity(accessBaseUrl) {
  if (!accessBaseUrl) {
    return true;
  }

  const url = `${accessBaseUrl.replace(/\/+$/, "")}/cdn-cgi/access/get-identity`;
  const headers = { Accept: "application/json" };
  const cookieHeader = await getAccessCookieHeader(accessBaseUrl);
  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  try {
    const response = await fetch(url, { method: "GET", headers });
    console.log("[cloudflare-access] get-identity status:", response.status);
    
    if (response.status === 404) {
      // Access is not active for this host
      return true;
    }
    if (response.status === 400) {
      // Missing token - user needs to authenticate
      return false;
    }
    if (response.status === 401 || response.status === 403) {
      return false;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return false;
    }

    const payload = await response.json().catch(() => null);
    console.log("[cloudflare-access] get-identity response:", payload);
    
    // Check for error in body (e.g., {"err":"no app token set"})
    if (payload && payload.err) {
      console.log("[cloudflare-access] error in response:", payload.err);
      return false;
    }
    
    return Boolean(payload && typeof payload === "object" && !payload.err);
  } catch (error) {
    console.warn("[cloudflare-access] identity check failed", error);
    return false;
  }
}

async function openCloudflareAccessLoginWindow(accessBaseUrl) {
  const baseUrl = String(accessBaseUrl || "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("Cloudflare Access URL fehlt.");
  }

  if (cloudflareAccessLoginPromise) {
    return cloudflareAccessLoginPromise;
  }

  cloudflareAccessLoginPromise = new Promise((resolve, reject) => {
    let loginWindow = null;
    let finished = false;

    const finish = (handler) => {
      if (finished) {
        return;
      }
      finished = true;
      if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.close();
      }
      loginWindow = null;
      cloudflareAccessLoginPromise = null;
      handler();
    };

    const timeoutId = setTimeout(() => {
      finish(() => reject(new Error("Cloudflare Access Login Timeout.")));
    }, 120000);

    const start = async () => {
      loginWindow = new BrowserWindow({
        parent: mainWindow || undefined,
        modal: false,
        width: 520,
        height: 720,
        show: false,
        webPreferences: {
          contextIsolation: true,
        },
      });

      loginWindow.on("closed", () => {
        clearTimeout(timeoutId);
        finish(() => reject(new Error("Cloudflare Access Login wurde geschlossen.")));
      });

      await loginWindow.loadURL(baseUrl);

      // Wait for page to fully load and cookies to be set before first check
      await delay(1500);

      const pollIdentity = async () => {
        if (finished) {
          return;
        }
        console.log("[cloudflare-access] polling identity...");
        const hasIdentity = await hasCloudflareAccessIdentity(baseUrl);
        console.log("[cloudflare-access] identity check result:", hasIdentity);
        if (hasIdentity) {
          clearTimeout(timeoutId);
          finish(() => resolve({ ok: true }));
          return;
        }
        // User needs to authenticate - show the window now
        if (!loginWindow.isDestroyed()) {
          console.log("[cloudflare-access] showing login window");
          loginWindow.show();
        }
        setTimeout(pollIdentity, 1500);
      };

      pollIdentity();
    };

    start().catch((error) => {
      clearTimeout(timeoutId);
      finish(() => reject(error));
    });
  });

  return cloudflareAccessLoginPromise;
}

async function ensureCloudflareAccessSession(accessBaseUrl) {
  const hasIdentity = await hasCloudflareAccessIdentity(accessBaseUrl);
  if (hasIdentity) {
    return { ok: true };
  }

  try {
    await openCloudflareAccessLoginWindow(accessBaseUrl);
  } catch (error) {
    return {
      ok: false,
      message: error?.message || "Cloudflare Access Anmeldung fehlgeschlagen.",
    };
  }

  const hasIdentityAfter = await hasCloudflareAccessIdentity(accessBaseUrl);
  if (!hasIdentityAfter) {
    return { ok: false, message: "Cloudflare Access Session konnte nicht bestaetigt werden." };
  }

  return { ok: true };
}

function getStoredServerConfig() {
  const filePath = getServerConfigFilePath();
  if (!fsSync.existsSync(filePath)) {
    return { configured: false, serverUrl: "" };
  }

  try {
    const raw = fsSync.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const serverUrl = normalizeServerConfigValue(parsed?.serverUrl || "");
    return {
      configured: Boolean(serverUrl),
      serverUrl,
      updatedAt: parsed?.updatedAt || null,
    };
  } catch (error) {
    console.warn("[desktop-server-config] failed to read server config", error);
    return { configured: false, serverUrl: "" };
  }
}

async function writeServerConfig(serverConfig) {
  const hostOnly = normalizeServerHost(serverConfig?.serverUrl || "");
  if (!hostOnly) {
    throw new Error("Server URL darf nicht leer sein.");
  }

  const nextServerUrl = buildServerBaseUrl(hostOnly);

  try {
    const parsed = new URL(nextServerUrl);
    if (parsed.protocol !== "https:") {
      throw new Error("Server URL muss https verwenden.");
    }
  } catch {
    throw new Error("Server URL ist ungueltig.");
  }

  const payload = {
    configured: true,
    serverUrl: nextServerUrl,
    updatedAt: new Date().toISOString(),
  };

  await fs.mkdir(path.dirname(getServerConfigFilePath()), { recursive: true });
  await fs.writeFile(getServerConfigFilePath(), JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

async function testServerConnection(serverUrl) {
  const hostOnly = normalizeServerHost(serverUrl);
  if (!hostOnly) {
    return {
      ok: false,
      message: "Bitte gueltigen Hostnamen eingeben (z.B. cs2.clustercontrol.cc).",
    };
  }

  const baseUrl = buildServerBaseUrl(hostOnly);
  const accessBaseUrl = resolveAccessBaseUrl(baseUrl);

  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return { ok: false, message: "Server URL ist ungueltig." };
  }

  const accessCheck = await ensureCloudflareAccessSession(accessBaseUrl);
  if (!accessCheck.ok) {
    return { ok: false, message: accessCheck.message || "Cloudflare Access Anmeldung fehlgeschlagen." };
  }

  const candidateUrls = Array.from(
    new Set([
      `${baseUrl}/api/v1/portfolio/summary`,
      `${baseUrl}/api/index.php/api/v1/portfolio/summary`,
      `${baseUrl}/api/index.php?route=${encodeURIComponent("/api/v1/portfolio/summary")}`,
      `${baseUrl}/index.php/api/v1/portfolio/summary`,
      `${baseUrl}/index.php?route=${encodeURIComponent("/api/v1/portfolio/summary")}`,
    ]),
  );

  try {
    for (const testUrl of candidateUrls) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const cookieHeader = await getAccessCookieHeader(accessBaseUrl);
        const response = await fetch(testUrl, {
          method: "GET",
          headers: {
            Accept: "application/json",
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          },
          signal: controller.signal,
          cache: "no-store",
        });

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          continue;
        }

        return {
          ok: response.status >= 200 && response.status < 500,
          status: response.status,
          message: response.ok
            ? "Verbindung erfolgreich."
            : `Server erreichbar (HTTP ${response.status}).`,
        };
      } catch (error) {
        if (error?.name === "AbortError") {
          // try next candidate first, timeout only if all fail
          continue;
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    return { ok: false, message: "Server antwortet, aber nicht mit JSON." };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { ok: false, message: "Timeout beim Verbindungsaufbau." };
    }
    return { ok: false, message: "Server nicht erreichbar." };
  }
}

function getStoredCsFloatApiKey() {
  const masterKey = getSecretVaultMasterKeyFromMemory();
  if (!masterKey) {
    return null;
  }

  try {
    return readEncryptedSecretFile(getCsFloatApiKeyVaultFilePath(), masterKey);
  } finally {
    masterKey.fill(0);
  }
}

function getCsFloatApiKeyStatus() {
  const configured = fsSync.existsSync(getCsFloatApiKeyVaultFilePath())
    || fsSync.existsSync(getCsFloatApiKeyFilePath());
  const vaultStatus = getSecretVaultStatus();
  const storedKey = getStoredCsFloatApiKey();
  const metadata = readSecretMetadata(getCsFloatApiKeyVaultFilePath());
  const lastFour = storedKey
    ? storedKey.slice(-4)
    : (typeof metadata.lastFour === "string" ? metadata.lastFour : null);

  return {
    configured,
    hasKey: configured,
    lastFour,
    source: "electron-secret-vault",
    desktopLocal: true,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    vaultConfigured: vaultStatus.configured,
    vaultUnlocked: vaultStatus.unlocked,
    vaultLocked: vaultStatus.configured && !vaultStatus.unlocked,
  };
}

async function writeCsFloatApiKey(apiKey) {
  await ensureSecretVaultUnlocked();
  const trimmedKey = String(apiKey || "").trim();

  if (!trimmedKey) {
    throw new Error("CSFloat API Key darf nicht leer sein.");
  }

  await writeEncryptedSecretFile(
    getCsFloatApiKeyVaultFilePath(),
    trimmedKey,
    unlockedSecretVaultMasterKey,
    { lastFour: trimmedKey.slice(-4) },
  );
  sidecarSecretsUnlockedForCurrentRun = true;
  touchSecretVaultActivity();
  await fs.unlink(getCsFloatApiKeyFilePath()).catch(() => {});

  await restartPhpSidecar();
  return getCsFloatApiKeyStatus();
}

async function clearCsFloatApiKey() {
  await ensureSecretVaultUnlocked();
  try {
    await fs.unlink(getCsFloatApiKeyVaultFilePath());
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  await fs.unlink(getCsFloatApiKeyFilePath()).catch(() => {});
  touchSecretVaultActivity();

  await restartPhpSidecar();
  return getCsFloatApiKeyStatus();
}

function getStoredSkinBaronApiKey() {
  const masterKey = getSecretVaultMasterKeyFromMemory();
  if (!masterKey) {
    return null;
  }

  try {
    return readEncryptedSecretFile(getSkinBaronApiKeyVaultFilePath(), masterKey);
  } finally {
    masterKey.fill(0);
  }
}

function normalizeSkinBaronSessionCookieInput(rawValue) {
  const trimmedValue = String(rawValue || "").trim();
  if (!trimmedValue) {
    return "";
  }

  const withoutCookiePrefix = trimmedValue.replace(/^cookie:\s*/i, "").trim();
  if (/authid\s*=/i.test(withoutCookiePrefix)) {
    return withoutCookiePrefix;
  }

  if (!withoutCookiePrefix.includes("=")) {
    return `AUTHID=${withoutCookiePrefix}`;
  }

  return withoutCookiePrefix;
}

function getStoredSkinBaronSessionCookie() {
  const masterKey = getSecretVaultMasterKeyFromMemory();
  if (!masterKey) {
    return null;
  }

  try {
    const decrypted = readEncryptedSecretFile(getSkinBaronSessionCookieVaultFilePath(), masterKey);
    return normalizeSkinBaronSessionCookieInput(decrypted) || null;
  } finally {
    masterKey.fill(0);
  }
}

function extractSkinBaronAuthIdTail(cookieHeader) {
  const normalizedCookie = String(cookieHeader || "");
  const match = normalizedCookie.match(/authid\s*=\s*\"?([^\";]+)\"?/i);
  const authIdValue = match?.[1] ? String(match[1]).trim() : "";
  if (!authIdValue) {
    return null;
  }

  return authIdValue.slice(-4);
}

async function findSkinBaronAuthIdFromSession(targetSession) {
  const resolvedSession = targetSession?.cookies?.get
    ? targetSession
    : session.defaultSession;
  const candidates = [
    "https://skinbaron.de",
    "https://www.skinbaron.de",
  ];

  for (const targetUrl of candidates) {
    try {
      const cookies = await resolvedSession.cookies.get({ url: targetUrl });
      if (!Array.isArray(cookies) || cookies.length === 0) {
        continue;
      }
      const authCookie = cookies.find((cookie) => {
        const name = String(cookie?.name || "").trim().toLowerCase();
        const value = String(cookie?.value || "").trim();
        return name === "authid" && value !== "";
      });
      if (authCookie) {
        return String(authCookie.value || "").trim();
      }
    } catch (error) {
      console.warn(`[skinbaron-session] failed to read cookies for ${targetUrl}`, error);
    }
  }

  return "";
}

async function openSkinBaronSessionLoginWindow() {
  if (skinBaronSessionLoginPromise) {
    return skinBaronSessionLoginPromise;
  }

  skinBaronSessionLoginPromise = new Promise((resolve, reject) => {
    let loginWindow = null;
    let finished = false;
    let pollTimer = null;
    let savingAuthCookie = false;

    const cleanup = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const finish = (handler) => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.close();
      }
      loginWindow = null;
      skinBaronSessionLoginPromise = null;
      handler();
    };

    const timeoutId = setTimeout(() => {
      finish(() => reject(new Error("SkinBaron Login Timeout (kein AUTHID Cookie gefunden).")));
    }, 180000);

    const start = async () => {
      loginWindow = new BrowserWindow({
        parent: mainWindow || undefined,
        modal: false,
        width: 1180,
        height: 860,
        minWidth: 980,
        minHeight: 700,
        show: true,
        title: "SkinBaron Login",
        webPreferences: {
          contextIsolation: true,
          partition: "persist:skinbaron-auth",
        },
      });

      loginWindow.on("closed", () => {
        clearTimeout(timeoutId);
        finish(() => reject(new Error("SkinBaron Login wurde geschlossen, bevor AUTHID erkannt wurde.")));
      });

      const pollAuthCookie = async () => {
        if (finished || !loginWindow || loginWindow.isDestroyed()) {
          return;
        }
        if (savingAuthCookie) {
          return;
        }

        const authIdValue = await findSkinBaronAuthIdFromSession(loginWindow.webContents.session);
        if (!authIdValue) {
          return;
        }

        clearTimeout(timeoutId);
        try {
          savingAuthCookie = true;
          const status = await writeSkinBaronSessionCookie(`AUTHID=${authIdValue}`);
          finish(() => resolve({
            ok: true,
            status,
          }));
        } catch (error) {
          finish(() => reject(error));
        } finally {
          savingAuthCookie = false;
        }
      };

      await loginWindow.loadURL("https://skinbaron.de/de/profile/purchases");
      await delay(1000);

      await pollAuthCookie();
      pollTimer = setInterval(() => {
        void pollAuthCookie();
      }, 1200);
    };

    start().catch((error) => {
      clearTimeout(timeoutId);
      finish(() => reject(error));
    });
  });

  return skinBaronSessionLoginPromise;
}

function readSkinBaronCapabilitiesSnapshot() {
  const filePath = getSkinBaronCapabilitiesFilePath();
  if (!fsSync.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fsSync.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const capabilities = parsed.capabilities && typeof parsed.capabilities === "object"
      ? parsed.capabilities
      : {};
    return {
      capabilities,
      checkedAt: typeof parsed.checkedAt === "string" ? parsed.checkedAt : null,
    };
  } catch (error) {
    console.warn("[desktop-secrets] failed to read SkinBaron capability snapshot", error);
    return null;
  }
}

function readSkinBaronSessionProbeSnapshot() {
  const filePath = getSkinBaronSessionProbeFilePath();
  if (!fsSync.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fsSync.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn("[desktop-secrets] failed to read SkinBaron session probe snapshot", error);
    return null;
  }
}

async function writeSkinBaronCapabilitiesSnapshot(snapshot = {}) {
  const filePath = getSkinBaronCapabilitiesFilePath();
  await fs.mkdir(getSecretsDirPath(), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), "utf8");
}

async function writeSkinBaronSessionProbeSnapshot(snapshot = {}) {
  const filePath = getSkinBaronSessionProbeFilePath();
  await fs.mkdir(getSecretsDirPath(), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), "utf8");
}

async function clearSkinBaronCapabilitiesSnapshot() {
  try {
    await fs.unlink(getSkinBaronCapabilitiesFilePath());
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function clearSkinBaronSessionProbeSnapshot() {
  try {
    await fs.unlink(getSkinBaronSessionProbeFilePath());
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function probeSkinBaronPurchasesSession(cookieHeader) {
  const normalizedCookie = normalizeSkinBaronSessionCookieInput(cookieHeader);
  if (!normalizedCookie) {
    return {
      allowed: false,
      statusCode: null,
      message: "Kein Session-Cookie gesetzt.",
      checkedAt: new Date().toISOString(),
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch("https://skinbaron.de/api/v2/Purchases?searchString=", {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        "x-requested-with": "XMLHttpRequest",
        Referer: "https://skinbaron.de/de/profile/purchases",
        Cookie: normalizedCookie,
      },
      signal: controller.signal,
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const purchaseGroups = Array.isArray(payload?.purchaseGroups) ? payload.purchaseGroups : null;
    if (response.status >= 200 && response.status < 300 && purchaseGroups !== null) {
      return {
        allowed: true,
        statusCode: response.status,
        message: `ok (${purchaseGroups.length} purchase groups in sample)`,
        checkedAt: new Date().toISOString(),
      };
    }

    return {
      allowed: false,
      statusCode: response.status,
      message: typeof payload?.message === "string" && payload.message.trim()
        ? payload.message.trim()
        : `HTTP ${response.status}`,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      allowed: false,
      statusCode: null,
      message: error?.name === "AbortError"
        ? "Timeout"
        : (error?.message || "Netzwerkfehler"),
      checkedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

const SKINBARON_CAPABILITY_PROBES = [
  {
    id: "getBalance",
    label: "Guthaben abfragen",
    endpoint: "/GetBalance",
    body: () => ({}),
  },
  {
    id: "getSales",
    label: "Verkaeufe auflisten",
    endpoint: "/GetSales",
    body: () => ({
      appid: 730,
      items_per_page: 1,
      sort_order: 0,
    }),
  },
  {
    id: "search",
    label: "Angebote durchsuchen",
    endpoint: "/Search",
    body: () => ({
      appid: 730,
      items_per_page: 1,
    }),
  },
  {
    id: "getActiveTradeOffers",
    label: "Aktive Handelsanfragen",
    endpoint: "/GetActiveTradeOffers",
    body: () => ({}),
  },
  {
    id: "getPriceList",
    label: "Preisliste abrufen",
    endpoint: "/GetPriceList",
    body: () => ({
      appId: 730,
    }),
  },
];

function extractSkinBaronProbeMessage(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const candidates = [payload.error, payload.message, payload.msg, payload.reason];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  if (Array.isArray(payload.errors)) {
    const first = payload.errors.find((entry) => typeof entry === "string" && entry.trim());
    if (first) {
      return first.trim();
    }
  }

  return "";
}

function normalizeSkinBaronProbeResult({ httpCode, payload, networkError }) {
  if (networkError) {
    return {
      allowed: false,
      statusCode: null,
      message: networkError,
    };
  }

  const statusCode = Number.isFinite(Number(httpCode)) ? Number(httpCode) : null;
  const message = extractSkinBaronProbeMessage(payload);
  const hasPayloadError = Boolean(message) || Boolean(payload?.error) || payload?.success === false;

  if (statusCode !== null && statusCode >= 200 && statusCode < 300 && !hasPayloadError) {
    return {
      allowed: true,
      statusCode,
      message: "ok",
    };
  }

  return {
    allowed: false,
    statusCode,
    message:
      message ||
      (statusCode ? `HTTP ${statusCode}` : "Anfrage fehlgeschlagen"),
  };
}

async function probeSkinBaronCapabilities(apiKey) {
  const trimmedApiKey = String(apiKey || "").trim();
  if (!trimmedApiKey) {
    return { capabilities: {}, checkedAt: new Date().toISOString() };
  }

  const capabilities = {};

  for (const probe of SKINBARON_CAPABILITY_PROBES) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(`https://api.skinbaron.de${probe.endpoint}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-requested-with": "XMLHttpRequest",
        },
        body: JSON.stringify({
          apikey: trimmedApiKey,
          ...(typeof probe.body === "function" ? probe.body() : {}),
        }),
        signal: controller.signal,
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      capabilities[probe.id] = {
        label: probe.label,
        ...normalizeSkinBaronProbeResult({
          httpCode: response.status,
          payload,
          networkError: null,
        }),
      };
    } catch (error) {
      const message =
        error?.name === "AbortError"
          ? "Timeout"
          : (error?.message || "Netzwerkfehler");
      capabilities[probe.id] = {
        label: probe.label,
        allowed: false,
        statusCode: null,
        message,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    capabilities,
    checkedAt: new Date().toISOString(),
  };
}

function getSkinBaronApiKeyStatus() {
  const vaultStatus = getSecretVaultStatus();
  const storedKey = getStoredSkinBaronApiKey();
  const storedSessionCookie = getStoredSkinBaronSessionCookie();
  const keyConfigured = fsSync.existsSync(getSkinBaronApiKeyVaultFilePath())
    || fsSync.existsSync(getSkinBaronApiKeyFilePath());
  const sessionCookieConfigured = fsSync.existsSync(getSkinBaronSessionCookieVaultFilePath())
    || fsSync.existsSync(getSkinBaronSessionCookieFilePath());
  const keyMetadata = readSecretMetadata(getSkinBaronApiKeyVaultFilePath());
  const sessionMetadata = readSecretMetadata(getSkinBaronSessionCookieVaultFilePath());
  const snapshot = readSkinBaronCapabilitiesSnapshot();
  const sessionProbeSnapshot = readSkinBaronSessionProbeSnapshot();
  const sessionLastFour = storedSessionCookie
    ? extractSkinBaronAuthIdTail(storedSessionCookie)
    : (typeof sessionMetadata.lastFour === "string" ? sessionMetadata.lastFour : null);
  const sessionHasAuthId = /authid\s*=/i.test(String(storedSessionCookie || ""));
  const sessionAllowed = sessionProbeSnapshot?.allowed === true;

  return {
    configured: keyConfigured,
    hasKey: keyConfigured,
    lastFour: storedKey
      ? storedKey.slice(-4)
      : (typeof keyMetadata.lastFour === "string" ? keyMetadata.lastFour : null),
    source: "electron-secret-vault",
    desktopLocal: true,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    vaultConfigured: vaultStatus.configured,
    vaultUnlocked: vaultStatus.unlocked,
    vaultLocked: vaultStatus.configured && !vaultStatus.unlocked,
    capabilities: snapshot?.capabilities || {},
    checkedAt: snapshot?.checkedAt || null,
    sessionCookieConfigured,
    sessionCookieHasAuthId: sessionHasAuthId,
    sessionCookieLastFour: sessionLastFour,
    sessionCookieCheckedAt: typeof sessionProbeSnapshot?.checkedAt === "string"
      ? sessionProbeSnapshot.checkedAt
      : null,
    sessionCookieAccess: {
      allowed: sessionAllowed,
      statusCode: Number.isFinite(Number(sessionProbeSnapshot?.statusCode))
        ? Number(sessionProbeSnapshot.statusCode)
        : null,
      message: typeof sessionProbeSnapshot?.message === "string" && sessionProbeSnapshot.message.trim()
        ? sessionProbeSnapshot.message.trim()
        : null,
    },
    importReady: sessionAllowed,
  };
}

async function writeSkinBaronApiKey(apiKey) {
  await ensureSecretVaultUnlocked();
  const trimmedKey = String(apiKey || "").trim();

  if (!trimmedKey) {
    throw new Error("SkinBaron API Key darf nicht leer sein.");
  }

  const capabilitySnapshot = await probeSkinBaronCapabilities(trimmedKey);

  await writeEncryptedSecretFile(
    getSkinBaronApiKeyVaultFilePath(),
    trimmedKey,
    unlockedSecretVaultMasterKey,
    { lastFour: trimmedKey.slice(-4) },
  );
  await fs.unlink(getSkinBaronApiKeyFilePath()).catch(() => {});
  sidecarSecretsUnlockedForCurrentRun = true;
  touchSecretVaultActivity();
  await writeSkinBaronCapabilitiesSnapshot(capabilitySnapshot);

  await restartPhpSidecar();
  return getSkinBaronApiKeyStatus();
}

async function clearSkinBaronApiKey() {
  await ensureSecretVaultUnlocked();
  try {
    await fs.unlink(getSkinBaronApiKeyVaultFilePath());
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  await fs.unlink(getSkinBaronApiKeyFilePath()).catch(() => {});
  touchSecretVaultActivity();

  await clearSkinBaronCapabilitiesSnapshot();
  await restartPhpSidecar();
  return getSkinBaronApiKeyStatus();
}

async function writeSkinBaronSessionCookie(sessionCookie) {
  await ensureSecretVaultUnlocked();
  const normalizedCookie = normalizeSkinBaronSessionCookieInput(sessionCookie);
  if (!normalizedCookie) {
    throw new Error("SkinBaron Session-Cookie darf nicht leer sein.");
  }

  const probeSnapshot = await probeSkinBaronPurchasesSession(normalizedCookie);
  if (probeSnapshot.allowed !== true) {
    throw new Error(
      probeSnapshot?.message
        ? `SkinBaron Purchases Zugriff fehlgeschlagen: ${probeSnapshot.message}`
        : "SkinBaron Purchases Zugriff fehlgeschlagen.",
    );
  }

  await writeEncryptedSecretFile(
    getSkinBaronSessionCookieVaultFilePath(),
    normalizedCookie,
    unlockedSecretVaultMasterKey,
    { lastFour: extractSkinBaronAuthIdTail(normalizedCookie) },
  );
  await fs.unlink(getSkinBaronSessionCookieFilePath()).catch(() => {});
  sidecarSecretsUnlockedForCurrentRun = true;
  touchSecretVaultActivity();
  await writeSkinBaronSessionProbeSnapshot(probeSnapshot);

  await restartPhpSidecar();
  return getSkinBaronApiKeyStatus();
}

async function clearSkinBaronSessionCookie() {
  await ensureSecretVaultUnlocked();
  try {
    await fs.unlink(getSkinBaronSessionCookieVaultFilePath());
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  await fs.unlink(getSkinBaronSessionCookieFilePath()).catch(() => {});
  touchSecretVaultActivity();

  await clearSkinBaronSessionProbeSnapshot();
  await restartPhpSidecar();
  return getSkinBaronApiKeyStatus();
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => {
        if (port) {
          resolve(port);
        } else {
          reject(new Error("Failed to allocate local sidecar port"));
        }
      });
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSidecarAuthHeaders() {
  if (!sidecarSecret) {
    return {};
  }

  return {
    "X-Desktop-Sidecar-Secret": sidecarSecret,
  };
}

function installSidecarRequestHeaderBridge() {
  if (sidecarRequestHeaderBridgeInstalled) {
    return;
  }

  sidecarRequestHeaderBridgeInstalled = true;
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ["http://127.0.0.1:*/*", "http://localhost:*/*"] },
    (details, callback) => {
      const requestHeaders = { ...(details.requestHeaders || {}) };
      const targetBase = String(backendBaseUrl || "").trim().toLowerCase();
      const requestUrl = String(details.url || "").trim().toLowerCase();
      const isSidecarRequest = targetBase !== "" && requestUrl.startsWith(`${targetBase}/`);

      if (isSidecarRequest && sidecarSecret && !requestHeaders["X-Desktop-Sidecar-Secret"]) {
        requestHeaders["X-Desktop-Sidecar-Secret"] = sidecarSecret;
      }

      callback({ requestHeaders });
    },
  );
}

async function waitForSidecarReady(baseUrl) {
  if (typeof fetch !== "function" || !baseUrl) {
    return;
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/desktop/health`, {
        cache: "no-store",
        headers: getSidecarAuthHeaders(),
      });

      if (response.ok) {
        return;
      }
    } catch (error) {
      // The PHP development server needs a short moment to bind the port.
    }

    await delay(100);
  }

  console.warn("[sidecar] health check did not respond before timeout");
}

async function startPhpSidecar() {
  if (phpSidecar || backendBaseUrl) {
    return backendBaseUrl;
  }

  const backendRoot = resolveRuntimePath("backend");
  const publicRoot = path.join(backendRoot, "desktop");
  const routerScript = path.join(publicRoot, "index.php");

  if (isAsarVirtualPath(backendRoot) || isAsarVirtualPath(publicRoot) || isAsarVirtualPath(routerScript)) {
    console.warn("[sidecar] backend path resolves to app.asar virtual path; sidecar requires unpacked backend files", {
      backendRoot,
      publicRoot,
      routerScript,
    });
  }

  if (!fsSync.existsSync(routerScript)) {
    console.warn("[sidecar] backend desktop/index.php not found:", routerScript);
    return null;
  }

  const port = await findFreePort();
  sidecarSecret = randomBytes(32).toString("hex");
  backendBaseUrl = `http://127.0.0.1:${port}`;

  const phpBinary = resolvePhpBinary();
  const sidecarEnvExtras = {};
  const savedServerConfig = getStoredServerConfig();
  if (savedServerConfig?.serverUrl) {
    const accessBaseUrl = resolveAccessBaseUrl(savedServerConfig.serverUrl);
    const cookieHeader = await getAccessCookieHeader(accessBaseUrl);
    if (cookieHeader) {
      sidecarEnvExtras.UPSTREAM_COOKIE_HEADER = cookieHeader;
      console.log("[sidecar] upstream access cookies detected and forwarded to sidecar");
    } else {
      console.warn("[sidecar] no upstream access cookies found; protected upstream may return redirects");
    }
  }

  console.log("[sidecar] using php binary:", phpBinary);
  console.log("[sidecar] backend root:", backendRoot);
  console.log("[sidecar] sidecar public root:", publicRoot);
  console.log("[sidecar] sidecar router script:", routerScript);
  phpSidecar = spawn(
    phpBinary,
    [
      "-d",
      "extension=curl",
      "-d",
      "extension=openssl",
      "-S",
      `127.0.0.1:${port}`,
      "-t",
      publicRoot,
      routerScript,
    ],
    {
      cwd: backendRoot,
      windowsHide: true,
      env: buildSidecarEnv(sidecarEnvExtras),
    },
  );

  phpSidecar.stdout?.on("data", (chunk) => {
    console.log("[sidecar]", String(chunk).trim());
  });
  phpSidecar.stderr?.on("data", (chunk) => {
    console.warn("[sidecar]", String(chunk).trim());
  });
  const currentSidecar = phpSidecar;
  phpSidecar.on("exit", (code, signal) => {
    console.warn(`[sidecar] exited code=${code} signal=${signal}`);
    if (phpSidecar === currentSidecar) {
      phpSidecar = null;
      backendBaseUrl = null;
    }
  });
  phpSidecar.on("error", (error) => {
    console.error("[sidecar] spawn error:", error?.message || error);
  });

  console.log("[sidecar] PHP backend started:", backendBaseUrl);
  await waitForSidecarReady(backendBaseUrl);
  return backendBaseUrl;
}

function stopPhpSidecar() {
  if (phpSidecar && !phpSidecar.killed) {
    phpSidecar.kill();
  }
  phpSidecar = null;
  backendBaseUrl = null;
}

async function restartPhpSidecar() {
  stopPhpSidecar();
  return await startPhpSidecar();
}

async function ensurePhpSidecarForRenderer() {
  if (!backendBaseUrl || !phpSidecar || phpSidecar.killed) {
    await startPhpSidecar();
  }
  return backendBaseUrl;
}

async function readCacheFile() {
  try {
    const content = await fs.readFile(getCacheFilePath(), "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("[desktop-cache] failed to read cache file", error);
    }
    return {};
  }
}

async function writeCacheFile(cacheData) {
  await fs.mkdir(path.dirname(getCacheFilePath()), { recursive: true });
  await fs.writeFile(
    getCacheFilePath(),
    JSON.stringify(cacheData, null, 2),
    "utf8",
  );
}

async function readSessionFile() {
  try {
    const content = await fs.readFile(getSessionFilePath(), "utf8");
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    if (parsed.encrypted === true && typeof parsed.payload === "string") {
      if (!safeStorage.isEncryptionAvailable()) {
        console.warn("[desktop-session] safeStorage unavailable; cannot decrypt session");
        return null;
      }

      try {
        const decrypted = safeStorage.decryptString(Buffer.from(parsed.payload, "base64"));
        const session = JSON.parse(decrypted);
        return session && typeof session === "object" ? session : null;
      } catch (decryptError) {
        console.warn("[desktop-session] failed to decrypt session file", decryptError);
        return null;
      }
    }

    // Legacy fallback for plaintext sessions written by old builds.
    return parsed;
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("[desktop-session] failed to read session file", error);
    }
    return null;
  }
}

async function writeSessionFile(sessionData) {
  await fs.mkdir(path.dirname(getSessionFilePath()), { recursive: true });
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS encryption unavailable: session cannot be stored securely.");
  }

  const encryptedPayload = safeStorage
    .encryptString(JSON.stringify(sessionData))
    .toString("base64");

  await fs.writeFile(
    getSessionFilePath(),
    JSON.stringify(
      {
        encrypted: true,
        payload: encryptedPayload,
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function deleteSessionFile() {
  try {
    await fs.unlink(getSessionFilePath());
  } catch (error) {
    // Ignore if file doesn't exist
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: "CS Portfolio Tracking",
    width: 1280,
    height: 720,
    show: false, // Erst verstecken, um das Flackern beim Maximieren zu verhindern
    frame: false, // <--- Entfernt die hässliche Windows-Standardleiste
    titleBarStyle: "hidden", // Alternativ für macOS/Windows Integration
    webPreferences: {
      preload: path.join(app.getAppPath(), "apps", "desktop", "preload.js"),
      contextIsolation: true,
      devTools: true,
    },
    icon: path.join(__dirname, "icon.ico"),
  });

  mainWindow.setMenu(null);
  mainWindow.maximize(); // Startet das Fenster in "Fullscreen-Window" Modus
  mainWindow.show(); // Jetzt anzeigen

  if (shouldAutoOpenDevTools) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
    console.log("[main] DevTools opened in detach mode");
  }

  // Log renderer console messages to file
  mainWindow.webContents.on("console-message", (...args) => {
    let level;
    let message;
    let line;
    let sourceId;

    if (typeof args[1] === "number") {
      // Electron <= 21 signature: (event, level, message, line, sourceId)
      [, level, message, line, sourceId] = args;
    } else {
      // Electron >= 22 signature: (event)
      const event = args[0] || {};
      ({ level, message, line, sourceId } = event);
    }

    const levels = ["", "LOG", "WARNING", "ERROR", "DEBUG"];
    const levelName = levels[level] || "UNKNOWN";
    console.log(`[renderer:${levelName}] ${message} (${sourceId}:${line})`);
  });

  // Load the renderer HTML
  // Use pre-calculated distIndexPath for reliable ASAR support
  console.log("[main] Loading UI from:", distIndexPath);
  mainWindow.loadFile(distIndexPath);

  mainWindow.on("closed", () => {
    mainWindow = null;
    app.quit();
  });
}

// Register custom protocol for Steam auth callback
const PROTOCOL = "cs-portfolio";
let pendingProtocolUrl = process.argv.find((arg) => arg.startsWith(`${PROTOCOL}://`)) || null;

function registerProtocol() {
  if (process.defaultApp) {
    // In development, Windows must launch Electron with the app root, not the
    // built HTML file. The protocol URL is appended by Windows as another arg.
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [app.getAppPath()]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }
}

// Handle protocol URL on Windows (second-instance event)
const gotTheLock = app.requestSingleInstanceLock();
let mainWindow = null;

if (!gotTheLock) {
  console.warn("[main] Single instance lock not acquired; another app instance is already running.");
  app.quit();
} else {
  app.on("second-instance", (event, commandLine) => {
    // Someone tried to open a cs-portfolio:// URL
    const url = commandLine.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    console.log("[main] second-instance received", { hasProtocolUrl: Boolean(url) });
    if (url) {
      if (mainWindow) {
        handleProtocolUrl(url);
      } else {
        pendingProtocolUrl = url;
      }
      // Focus the existing window
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // App starten
  app.whenReady().then(async () => {
    console.log("[main] App ready");
    registerProtocol();
    installSidecarRequestHeaderBridge();
    await startPhpSidecar().catch((error) => {
      console.warn("[sidecar] failed to start PHP backend", error);
    });

    // Set the dist index path for the renderer
    distIndexPath = resolveRuntimePath('dist', 'index.html');
    console.log("[main] UI path prepared:", distIndexPath);

    // Load local store - resolve path from ASAR root
    const localStorePath = resolveRuntimePath('apps', 'desktop', 'src', 'localStore', 'index.js');
    console.log("[main] LocalStore path:", localStorePath);

    // pathToFileURL correctly produces file:///C:/... on Windows
    ({ createLocalStore } = await import(pathToFileURL(localStorePath).href));

    createWindow();
    setupAutoUpdater();
    if (pendingProtocolUrl) {
      handleProtocolUrl(pendingProtocolUrl);
      pendingProtocolUrl = null;
    }
  }).catch((error) => {
    console.error("[main] App startup failed", error);
    app.quit();
  });
}

// Handle protocol URL on macOS (open-url event)
app.on("open-url", (event, url) => {
  event.preventDefault();
  console.log("[main] open-url event received:", url);
  if (mainWindow && url.startsWith(`${PROTOCOL}://`)) {
    handleProtocolUrl(url);
  }
});

/**
 * Handle incoming protocol URL from Steam auth callback
 * Parses the URL and forwards the auth result to the renderer
 */
function handleProtocolUrl(url) {
  console.log("[main] Received protocol URL:", url);
  
  try {
    const urlObj = new URL(url);
    const params = urlObj.searchParams;
    const hashParams = new URLSearchParams((urlObj.hash || "").replace(/^#/, ""));
    const token = params.get("token") || hashParams.get("token");
    
    if (token) {
      // Store the session (token only - user data will be validated by renderer)
      writeSessionFile({ token, createdAt: new Date().toISOString() }).then(() => {
        console.log("[main] Session stored, notifying renderer");
        // Notify the renderer with token only
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("steam-auth-callback", {
            success: true,
            sessionToken: token,
          });
        }
      }).catch((err) => {
        console.error("[main] Failed to store session:", err);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("steam-auth-callback", {
            success: false,
            error: "Failed to store session",
          });
        }
      });
    } else {
      console.warn("[main] Missing token in callback URL");
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("steam-auth-callback", {
          success: false,
          error: "Missing token in callback",
        });
      }
    }
  } catch (err) {
    console.error("[main] Failed to parse protocol URL:", err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("steam-auth-callback", {
        success: false,
        error: "Invalid callback URL",
      });
    }
  }
}
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

ipcMain.handle("local-cache-read", async (event, key) => {
  const cacheData = await readCacheFile();
  return cacheData[key] || null;
});

ipcMain.handle("local-cache-write", async (event, key, content) => {
  try {
    const cacheData = await readCacheFile();
    cacheData[key] = content;
    await writeCacheFile(cacheData);
    return true;
  } catch (error) {
    console.warn("[desktop-cache] failed to write cache entry", error);
    return false;
  }
});

ipcMain.handle("local-cache-remove", async (event, key) => {
  try {
    const cacheData = await readCacheFile();
    delete cacheData[key];
    await writeCacheFile(cacheData);
    return true;
  } catch (error) {
    console.warn("[desktop-cache] failed to remove cache entry", error);
    return false;
  }
});

// Session management IPC handlers
ipcMain.handle("session-store", async (event, action, data) => {
  if (action === "get") {
    return await readSessionFile();
  }
  if (action === "set") {
    await writeSessionFile(data);
    return true;
  }
  if (action === "clear") {
    await deleteSessionFile();
    return true;
  }
  return false;
});

// Open external URL (for Steam login)
ipcMain.handle("open-external", async (event, url) => {
  return await shell.openExternal(url);
});

// Open DevTools (for debugging from renderer)
ipcMain.handle("open-devtools", async () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    win.webContents.openDevTools({ mode: "detach" });
    return true;
  }
  return false;
});
ipcMain.handle("app-get-version", () => app.getVersion());
ipcMain.handle("cloudflare-access-login", async (event, serverUrl) => {
  try {
    const result = await openCloudflareAccessLoginWindow(serverUrl);
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

ipcMain.handle("backend-base-url", async () => {
  ensureDesktopRuntimeUnlocked();
  return await ensurePhpSidecarForRenderer();
});
ipcMain.handle("backend-auth-headers", async () => {
  ensureDesktopRuntimeUnlocked();
  await ensurePhpSidecarForRenderer();
  return getSidecarAuthHeaders();
});
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
  if (updateDownloadInProgress) {
    return { ok: true, alreadyDownloading: true };
  }

  let info = latestAvailableUpdateInfo;
  if (!info) {
    try {
      const result = await autoUpdater.checkForUpdates();
      info = result?.updateInfo || latestAvailableUpdateInfo;
    } catch (error) {
      const message = error?.message || String(error);
      console.warn("[updater] download requested but check failed:", message);
      return { ok: false, error: message };
    }
  }

  if (!info) {
    return { ok: false, reason: "no-update-info" };
  }

  return await promptForUpdateDownload(info);
});
ipcMain.handle("app-updater-install", async () => {
  if (!app.isPackaged) {
    return false;
  }
  autoUpdater.quitAndInstall();
  return true;
});
ipcMain.handle("server-config-get", () => getStoredServerConfig());
ipcMain.handle("server-config-set", async (event, payload) => {
  const config = await writeServerConfig(payload || {});
  await restartPhpSidecar();
  return config;
});
ipcMain.handle("server-config-test", async (event, serverUrl) => {
  return await testServerConnection(serverUrl);
});
ipcMain.handle("secret-vault-status", () => getSecretVaultStatus());
ipcMain.handle("secret-vault-set-preferences", async (_event, patch) => {
  const status = await updateSecretVaultPreferences(patch || {});
  return {
    status,
  };
});
ipcMain.handle("secret-vault-set-password", async (_event, password) => {
  const status = await configureSecretVaultPassword(password);
  return {
    status,
    backendBaseUrl,
  };
});
ipcMain.handle("secret-vault-unlock", async (_event, password) => {
  const status = await unlockSecretVault(password);
  return {
    status,
    backendBaseUrl,
  };
});
ipcMain.handle("secret-vault-lock", async () => {
  const status = await lockSecretVault("manual-lock");
  return {
    status,
    backendBaseUrl,
  };
});
ipcMain.handle("secret-vault-touch", () => {
  const status = touchSecretVaultActivity();
  return {
    status,
  };
});
ipcMain.handle("secret-csfloat-status", () => getCsFloatApiKeyStatus());
ipcMain.handle("secret-csfloat-set", async (event, apiKey) => {
  ensureDesktopRuntimeUnlocked();
  const status = await writeCsFloatApiKey(apiKey);
  return {
    status,
    backendBaseUrl,
  };
});
ipcMain.handle("secret-csfloat-clear", async () => {
  ensureDesktopRuntimeUnlocked();
  const status = await clearCsFloatApiKey();
  return {
    status,
    backendBaseUrl,
  };
});
ipcMain.handle("secret-skinbaron-status", () => getSkinBaronApiKeyStatus());
ipcMain.handle("secret-skinbaron-set", async (event, apiKey) => {
  ensureDesktopRuntimeUnlocked();
  const status = await writeSkinBaronApiKey(apiKey);
  return {
    status,
    backendBaseUrl,
  };
});
ipcMain.handle("secret-skinbaron-clear", async () => {
  ensureDesktopRuntimeUnlocked();
  const status = await clearSkinBaronApiKey();
  return {
    status,
    backendBaseUrl,
  };
});
ipcMain.handle("secret-skinbaron-session-status", () => getSkinBaronApiKeyStatus());
ipcMain.handle("secret-skinbaron-session-set", async (event, sessionCookie) => {
  ensureDesktopRuntimeUnlocked();
  const status = await writeSkinBaronSessionCookie(sessionCookie);
  return {
    status,
    backendBaseUrl,
  };
});
ipcMain.handle("secret-skinbaron-session-connect-browser", async () => {
  ensureDesktopRuntimeUnlocked();
  try {
    return await openSkinBaronSessionLoginWindow();
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
  return {
    status,
    backendBaseUrl,
  };
});

function safeLocalStoreInvoke(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      ensureDesktopRuntimeUnlocked();
      const store = getLocalStore();
      return await handler(store, ...args);
    } catch (error) {
      console.error(`[localStore] Error in ${channel}:`, error);
      return { error: error.message || "Local store operation failed", channel };
    }
  });
}

safeLocalStoreInvoke("local-store-info", (store) => store.getInfo());
safeLocalStoreInvoke("local-store-list-investments", (store, userId) =>
  store.listInvestments(userId),
);
safeLocalStoreInvoke("local-store-import-investments", (store, rows, userId) =>
  store.importInvestments(rows, userId),
);
safeLocalStoreInvoke("local-store-sync-steam-inventory", (store, rows, userId) =>
  store.syncSteamInventory(rows, userId),
);
safeLocalStoreInvoke("local-store-upsert-investment", (store, payload) =>
  store.upsertInvestment(payload),
);
safeLocalStoreInvoke("local-store-delete-investment", (store, id) =>
  store.deleteInvestment(id),
);
safeLocalStoreInvoke("local-store-delete-investment-silent", (store, id) =>
  store.deleteInvestmentSilent(id),
);
safeLocalStoreInvoke("local-store-get-investment", (store, id) =>
  store.getInvestment(id),
);
safeLocalStoreInvoke("local-store-list-watchlist", (store, userId) =>
  store.listWatchlistItems(userId),
);
safeLocalStoreInvoke("local-store-import-watchlist", (store, rows, userId) =>
  store.importWatchlistItems(rows, userId),
);
safeLocalStoreInvoke("local-store-upsert-watchlist-item", (store, payload) =>
  store.upsertWatchlistItem(payload),
);
safeLocalStoreInvoke("local-store-delete-watchlist-item", (store, id) =>
  store.deleteWatchlistItem(id),
);
safeLocalStoreInvoke("local-store-delete-watchlist-item-silent", (store, id) =>
  store.deleteWatchlistItemSilent(id),
);
safeLocalStoreInvoke("local-store-list-portfolio-snapshots", (store, userId, limit) =>
  store.listPortfolioSnapshots(userId, limit),
);
safeLocalStoreInvoke("local-store-upsert-portfolio-snapshot", (store, payload) =>
  store.upsertPortfolioSnapshot(payload),
);
safeLocalStoreInvoke("local-store-upsert-price", (store, payload) =>
  store.upsertPrice(payload),
);
safeLocalStoreInvoke("local-store-list-price-history", (store, itemId, limitDays) =>
  store.listPriceHistory(itemId, limitDays),
);
safeLocalStoreInvoke("local-store-list-pending-operations", (store, limit) =>
  store.listPendingOperations(limit),
);
safeLocalStoreInvoke("local-store-list-steam-csfloat-matches", (store, userId, status, limit) =>
  store.listSteamCsfloatMatches(userId, status, limit),
);
safeLocalStoreInvoke("local-store-update-steam-csfloat-match-status", (store, matchId, status) =>
  store.updateSteamCsfloatMatchStatus(matchId, status),
);
safeLocalStoreInvoke("local-store-create-notification", (store, payload) =>
  store.createNotification(payload),
);
safeLocalStoreInvoke("local-store-list-notifications", (store, userId, options) =>
  store.listNotifications(userId, options),
);
safeLocalStoreInvoke("local-store-mark-notification-read", (store, id) =>
  store.markNotificationRead(id),
);
safeLocalStoreInvoke("local-store-mark-all-notifications-read", (store, userId, category) =>
  store.markAllNotificationsRead(userId, category),
);
safeLocalStoreInvoke("local-store-mark-operation-applied", (store, id) =>
  store.markOperationApplied(id),
);
safeLocalStoreInvoke("local-store-get-portfolio-preferences", (store, userId) =>
  store.getPortfolioPreferences(userId),
);
safeLocalStoreInvoke("local-store-update-portfolio-preferences", (store, userId, patch) =>
  store.updatePortfolioPreferences(userId, patch),
);

app.on("window-all-closed", () => {
  localStore?.close();
  stopPhpSidecar();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
  if (secretVaultAutoLockTimer) {
    clearTimeout(secretVaultAutoLockTimer);
    secretVaultAutoLockTimer = null;
  }
  clearSecretVaultMasterKeyFromMemory();
  stopPhpSidecar();
});
