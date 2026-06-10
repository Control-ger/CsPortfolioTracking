/* eslint-disable */

import { app, safeStorage, BrowserWindow, session } from "electron";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── File name constants ──────────────────────────────────────────
const secretsDirName = "secrets";
const encryptionKeyFileName = "encryption-key.bin";
const secretVaultFileName = "secret-vault.json";
const secretVaultPreferencesFileName = "secret-vault-preferences.json";
const csFloatApiKeyVaultFileName = "csfloat-api-key.vault.json";
const skinBaronApiKeyVaultFileName = "skinbaron-api-key.vault.json";
const skinBaronSessionCookieVaultFileName = "skinbaron-session-cookie.vault.json";
const skinBaronCapabilitiesFileName = "skinbaron-capabilities.json";
const skinBaronSessionProbeFileName = "skinbaron-session-probe.json";
const csFloatApiKeyFileName = "csfloat-api-key.bin";
const skinBaronApiKeyFileName = "skinbaron-api-key.bin";
const skinBaronSessionCookieFileName = "skinbaron-session-cookie.bin";

const SECRET_VAULT_VERSION = 1;
const SECRET_VAULT_PASSWORD_MIN_LENGTH = 16;
const SECRET_VAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const SECRET_VAULT_AUTO_LOCK_DEFAULT = false;

// ── Mutable state ─────────────────────────────────────────────────
let secretVaultConfigCache = null;
let secretVaultPreferencesCache = null;
let unlockedSecretVaultMasterKey = null;
let secretVaultUnlockedAt = null;
let secretVaultLastActivityAt = 0;
let secretVaultAutoLockTimer = null;
let sidecarSecretsUnlockedForCurrentRun = false;

// ═══════════════════════════════════════════════════════════════════
// File path helpers
// ═══════════════════════════════════════════════════════════════════

function getSecretsDirPath() {
  return path.join(app.getPath("userData"), secretsDirName);
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

function getSkinBaronCapabilitiesFilePath() {
  return path.join(getSecretsDirPath(), skinBaronCapabilitiesFileName);
}

function getSkinBaronSessionProbeFilePath() {
  return path.join(getSecretsDirPath(), skinBaronSessionProbeFileName);
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

// ═══════════════════════════════════════════════════════════════════
// Encryption key
// ═══════════════════════════════════════════════════════════════════

export function getOrCreateEncryptionKey() {
  const filePath = getEncryptionKeyFilePath();

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

// ═══════════════════════════════════════════════════════════════════
// Crypto helpers
// ═══════════════════════════════════════════════════════════════════

function toBase64(buffer) {
  return Buffer.from(buffer).toString("base64");
}

function fromBase64(value) {
  return Buffer.from(String(value || ""), "base64");
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

// ═══════════════════════════════════════════════════════════════════
// Vault config / preferences
// ═══════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════
// Vault status / lock / unlock
// ═══════════════════════════════════════════════════════════════════

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

export function getSecretVaultStatus() {
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
    const { restartPhpSidecar } = await import("./sidecar.js");
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

// ═══════════════════════════════════════════════════════════════════
// Encrypted file I/O
// ═══════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════
// Legacy migration
// ═══════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════
// Vault lifecycle
// ═══════════════════════════════════════════════════════════════════

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
  const { restartPhpSidecar } = await import("./sidecar.js");
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
    const { restartPhpSidecar } = await import("./sidecar.js");
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

// ═══════════════════════════════════════════════════════════════════
// CsFloat API key
// ═══════════════════════════════════════════════════════════════════

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

export function getCsFloatApiKeyStatus() {
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

export async function writeCsFloatApiKey(apiKey) {
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

  const { restartPhpSidecar } = await import("./sidecar.js");
  await restartPhpSidecar();
  return getCsFloatApiKeyStatus();
}

export async function clearCsFloatApiKey() {
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

  const { restartPhpSidecar } = await import("./sidecar.js");
  await restartPhpSidecar();
  return getCsFloatApiKeyStatus();
}

// ═══════════════════════════════════════════════════════════════════
// SkinBaron API key + session cookie
// ═══════════════════════════════════════════════════════════════════

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

// ── SkinBaron capabilities probing ────────────────────────────────

const SKINBARON_CAPABILITY_PROBES = [
  { id: "getBalance", label: "Guthaben abfragen", endpoint: "/GetBalance", body: () => ({}) },
  {
    id: "getSales", label: "Verkaeufe auflisten", endpoint: "/GetSales",
    body: () => ({ appid: 730, items_per_page: 1, sort_order: 0 }),
  },
  {
    id: "search", label: "Angebote durchsuchen", endpoint: "/Search",
    body: () => ({ appid: 730, items_per_page: 1 }),
  },
  { id: "getActiveTradeOffers", label: "Aktive Handelsanfragen", endpoint: "/GetActiveTradeOffers", body: () => ({}) },
  { id: "getPriceList", label: "Preisliste abrufen", endpoint: "/GetPriceList", body: () => ({ appId: 730 }) },
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
    return { allowed: false, statusCode: null, message: networkError };
  }

  const statusCode = Number.isFinite(Number(httpCode)) ? Number(httpCode) : null;
  const message = extractSkinBaronProbeMessage(payload);
  const hasPayloadError = Boolean(message) || Boolean(payload?.error) || payload?.success === false;

  if (statusCode !== null && statusCode >= 200 && statusCode < 300 && !hasPayloadError) {
    return { allowed: true, statusCode, message: "ok" };
  }

  return {
    allowed: false,
    statusCode,
    message: message || (statusCode ? `HTTP ${statusCode}` : "Anfrage fehlgeschlagen"),
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
        ...normalizeSkinBaronProbeResult({ httpCode: response.status, payload, networkError: null }),
      };
    } catch (error) {
      const message = error?.name === "AbortError" ? "Timeout" : (error?.message || "Netzwerkfehler");
      capabilities[probe.id] = { label: probe.label, allowed: false, statusCode: null, message };
    } finally {
      clearTimeout(timeout);
    }
  }

  return { capabilities, checkedAt: new Date().toISOString() };
}

// ── SkinBaron session probing (purchases) ─────────────────────────

async function probeSkinBaronPurchasesSession(cookieHeader) {
  const normalizedCookie = normalizeSkinBaronSessionCookieInput(cookieHeader);
  if (!normalizedCookie) {
    return { allowed: false, statusCode: null, message: "Kein Session-Cookie gesetzt.", checkedAt: new Date().toISOString() };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch("https://skinbaron.de/api/v2/Purchases?searchString=", {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        "x-requested-with": "XMLHttpRequest",
        Referer: "https://skinbaron.de/en/profile/purchases",
        "Accept-Language": "en-US,en;q=0.9",
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
      return { allowed: true, statusCode: response.status, message: `ok (${purchaseGroups.length} purchase groups in sample)`, checkedAt: new Date().toISOString() };
    }

    return {
      allowed: false,
      statusCode: response.status,
      message: typeof payload?.message === "string" && payload.message.trim() ? payload.message.trim() : `HTTP ${response.status}`,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      allowed: false,
      statusCode: null,
      message: error?.name === "AbortError" ? "Timeout" : (error?.message || "Netzwerkfehler"),
      checkedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ── SkinBaron file helpers ────────────────────────────────────────

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

    const capabilities = parsed.capabilities && typeof parsed.capabilities === "object" ? parsed.capabilities : {};
    return { capabilities, checkedAt: typeof parsed.checkedAt === "string" ? parsed.checkedAt : null };
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

// ── SkinBaron login window ────────────────────────────────────────

let skinBaronSessionLoginPromise = null;

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
        parent: undefined,
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
          finish(() => resolve({ ok: true, status }));
        } catch (error) {
          finish(() => reject(error));
        } finally {
          savingAuthCookie = false;
        }
      };

      await loginWindow.loadURL("https://skinbaron.de/en/profile/purchases");
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── SkinBaron status ──────────────────────────────────────────────

export function getSkinBaronApiKeyStatus() {
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
    sessionCookieCheckedAt: typeof sessionProbeSnapshot?.checkedAt === "string" ? sessionProbeSnapshot.checkedAt : null,
    sessionCookieAccess: {
      allowed: sessionAllowed,
      statusCode: Number.isFinite(Number(sessionProbeSnapshot?.statusCode)) ? Number(sessionProbeSnapshot.statusCode) : null,
      message: typeof sessionProbeSnapshot?.message === "string" && sessionProbeSnapshot.message.trim() ? sessionProbeSnapshot.message.trim() : null,
    },
    importReady: sessionAllowed,
  };
}

export async function writeSkinBaronApiKey(apiKey) {
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

  const { restartPhpSidecar } = await import("./sidecar.js");
  await restartPhpSidecar();
  return getSkinBaronApiKeyStatus();
}

export async function clearSkinBaronApiKey() {
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
  const { restartPhpSidecar } = await import("./sidecar.js");
  await restartPhpSidecar();
  return getSkinBaronApiKeyStatus();
}

export async function writeSkinBaronSessionCookie(sessionCookie) {
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

  const { restartPhpSidecar } = await import("./sidecar.js");
  await restartPhpSidecar();
  return getSkinBaronApiKeyStatus();
}

export async function clearSkinBaronSessionCookie() {
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
  const { restartPhpSidecar } = await import("./sidecar.js");
  await restartPhpSidecar();
  return getSkinBaronApiKeyStatus();
}

// ── Helpers used by sidecar.js ────────────────────────────────────

export { getStoredCsFloatApiKey, getStoredSkinBaronApiKey, getStoredSkinBaronSessionCookie, touchSecretVaultActivity, updateSecretVaultPreferences, configureSecretVaultPassword, unlockSecretVault, lockSecretVault, ensureSecretVaultUnlocked, isAlreadyUnlocked };

function isAlreadyUnlocked() {
  return sidecarSecretsUnlockedForCurrentRun;
}

export function getSidecarSecretsUnlocked() {
  return sidecarSecretsUnlockedForCurrentRun;
}

// ── Secret vault API exports for IPC ──────────────────────────────

export {
  configureSecretVaultPassword as apiConfigureSecretVaultPassword,
  unlockSecretVault as apiUnlockSecretVault,
  lockSecretVault as apiLockSecretVault,
  updateSecretVaultPreferences as apiUpdateSecretVaultPreferences,
  openSkinBaronSessionLoginWindow as apiOpenSkinBaronSessionLoginWindow,
};
