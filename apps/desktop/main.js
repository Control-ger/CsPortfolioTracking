/* eslint-disable */
import { app, BrowserWindow, dialog, ipcMain, shell, safeStorage, session } from "electron";
import { spawn } from "child_process";
import { randomBytes } from "crypto";
import fs from "fs/promises";
import fsSync from "fs";
import net from "net";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;

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
let createLocalStore = null;
let localStore = null;
let distIndexPath = null; // Will be set when app is ready
let phpSidecar = null;
let backendBaseUrl = null;
let sidecarSecret = null;
let updateCheckTimer = null;
let cloudflareAccessLoginPromise = null;
const AUTO_UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;
const shouldAutoOpenDevTools = !app.isPackaged || process.env.DEBUG === "1";

function emitUpdaterStatus(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("app-updater-status", payload);
}

function setupAutoUpdater() {
  if (!app.isPackaged) {
    console.log("[updater] skipped in development mode");
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    console.log("[updater] checking for update");
    emitUpdaterStatus({ state: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    console.log("[updater] update available:", info?.version || "unknown");
    emitUpdaterStatus({ state: "available", version: info?.version || null, info });
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[updater] no update available");
    emitUpdaterStatus({ state: "not-available" });
  });

  autoUpdater.on("download-progress", (progress) => {
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
    emitUpdaterStatus({ state: "error", message: error?.message || String(error) });
  });

  autoUpdater.on("update-downloaded", async (info) => {
    console.log("[updater] update downloaded:", info?.version || "unknown");
    emitUpdaterStatus({ state: "downloaded", version: info?.version || null, info });

    const result = await dialog.showMessageBox({
      type: "info",
      buttons: ["Jetzt neu starten", "Spater"],
      defaultId: 0,
      cancelId: 1,
      title: "Update bereit",
      message: "Eine neue Version wurde heruntergeladen.",
      detail: "Jetzt neu starten, um das Update zu installieren?",
    });

    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
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

  merged.APP_ENV = merged.APP_ENV || "desktop";
  merged.DESKTOP_SIDECAR_SECRET = sidecarSecret;
  merged.DESKTOP_LOG_FILE = LOG_FILE;
  merged.DESKTOP_STATE_DIR = app.getPath("userData");
  if (localCsFloatApiKey) {
    merged.CSFLOAT_API_KEY = localCsFloatApiKey;
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
  if (trimmed.includes("://") || /[\\/]/.test(trimmed)) {
    return "";
  }
  return trimmed;
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
    if (!Array.isArray(cookies) || cookies.length === 0) {
      return "";
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
    if (response.status === 404 || response.status === 400) {
      return true;
    }
    if (response.status === 401 || response.status === 403) {
      return false;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("application/json")) {
      return false;
    }

    const payload = await response.json().catch(() => null);
    return Boolean(payload && typeof payload === "object");
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
        show: true,
        webPreferences: {
          contextIsolation: true,
        },
      });

      loginWindow.on("closed", () => {
        clearTimeout(timeoutId);
        finish(() => reject(new Error("Cloudflare Access Login wurde geschlossen.")));
      });

      await loginWindow.loadURL(baseUrl);

      const pollIdentity = async () => {
        if (finished) {
          return;
        }
        const hasIdentity = await hasCloudflareAccessIdentity(baseUrl);
        if (hasIdentity) {
          clearTimeout(timeoutId);
          finish(() => resolve({ ok: true }));
          return;
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
    const rawInput = String(serverConfig?.serverUrl || "").trim();
    if (rawInput) {
      throw new Error("Bitte nur den Hostnamen ohne Protokoll oder Pfad eingeben (z.B. cs.tracking).");
    }
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
    const rawInput = String(serverUrl || "").trim();
    return {
      ok: false,
      message: rawInput
        ? "Bitte nur den Hostnamen ohne Protokoll oder Pfad eingeben (z.B. cs.tracking)."
        : "Server URL fehlt.",
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
  const filePath = getCsFloatApiKeyFilePath();

  if (!fsSync.existsSync(filePath)) {
    return null;
  }

  if (!safeStorage.isEncryptionAvailable()) {
    console.warn("[desktop-secrets] safeStorage is not available; CSFloat key cannot be decrypted.");
    return null;
  }

  try {
    const encrypted = fsSync.readFileSync(filePath);
    return safeStorage.decryptString(encrypted);
  } catch (error) {
    console.warn("[desktop-secrets] failed to decrypt CSFloat API key", error);
    return null;
  }
}

function getCsFloatApiKeyStatus() {
  const storedKey = getStoredCsFloatApiKey();

  return {
    configured: Boolean(storedKey),
    hasKey: Boolean(storedKey),
    lastFour: storedKey ? storedKey.slice(-4) : null,
    source: "electron-safe-storage",
    desktopLocal: true,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
  };
}

async function writeCsFloatApiKey(apiKey) {
  const trimmedKey = String(apiKey || "").trim();

  if (!trimmedKey) {
    throw new Error("CSFloat API Key darf nicht leer sein.");
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS-Verschluesselung ist auf diesem System nicht verfuegbar.");
  }

  const encrypted = safeStorage.encryptString(trimmedKey);
  await fs.mkdir(getSecretsDirPath(), { recursive: true });
  await fs.writeFile(getCsFloatApiKeyFilePath(), encrypted);

  await restartPhpSidecar();
  return getCsFloatApiKeyStatus();
}

async function clearCsFloatApiKey() {
  try {
    await fs.unlink(getCsFloatApiKeyFilePath());
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  await restartPhpSidecar();
  return getCsFloatApiKeyStatus();
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

async function waitForSidecarReady(baseUrl) {
  if (typeof fetch !== "function" || !baseUrl) {
    return;
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/desktop/health`, {
        cache: "no-store",
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

ipcMain.handle("backend-base-url", async () => {
  return await ensurePhpSidecarForRenderer();
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
ipcMain.handle("secret-csfloat-status", () => getCsFloatApiKeyStatus());
ipcMain.handle("secret-csfloat-set", async (event, apiKey) => {
  const status = await writeCsFloatApiKey(apiKey);
  return {
    status,
    backendBaseUrl,
  };
});
ipcMain.handle("secret-csfloat-clear", async () => {
  const status = await clearCsFloatApiKey();
  return {
    status,
    backendBaseUrl,
  };
});

function safeLocalStoreInvoke(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
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
  stopPhpSidecar();
});
