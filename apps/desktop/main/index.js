/* eslint-disable */

import { app, BrowserWindow, protocol as electronProtocol, shell } from "electron";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { createWriteStream } from "fs";

import {
  setMainWindow,
  setupAutoUpdater,
  clearUpdateCheckTimer,
  startUpdateDownload,
} from "./updater.js";

import {
  getStoredCsFloatApiKey,
  getStoredSkinBaronApiKey,
  getStoredSkinBaronSessionCookie,
  getOrCreateEncryptionKey,
  getSidecarSecretsUnlocked,
  apiConfigureSecretVaultPassword,
  apiUnlockSecretVault,
  apiLockSecretVault,
  apiUpdateSecretVaultPreferences,
  apiOpenSkinBaronSessionLoginWindow,
} from "./secret-vault.js";

import {
  phpSidecar,
  sidecarSecret,
  setSidecarProcess,
  setSidecarSecret,
  setSidecarHeaderBridgeInstalled,
  startPhpSidecar,
  stopPhpSidecar,
  restartPhpSidecar,
  ensurePhpSidecarForRenderer,
  installSidecarRequestHeaderBridge,
  resolveRuntimePath,
  isAsarVirtualPath,
  readDotEnvFile,
} from "./sidecar.js";

import {
  registerAllIpcHandlers,
  setBackendBaseUrl,
  setIpcDeps,
} from "./ipc-handlers.js";

// ── Constants ─────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTOCOL = "cs-investor-hub";
const APP_NAME = "CS Investor Hub";

// ── Module-level shared state ──────────────────────────────────────
let mainWindow = null;
let backendBaseUrl = null;
let distIndexPath = null;
let createLocalStore = null;
let localStore = null;
let cloudflareAccessLoginPromise = null;
let pendingProtocolUrl = null;

// ═══════════════════════════════════════════════════════════════════
// File logging
// ═══════════════════════════════════════════════════════════════════

function setupFileLogging() {
  if (!app.isPackaged) {
    return;
  }

  try {
    const logDir = path.join(app.getPath("userData"), "logs");
    if (!fsSync.existsSync(logDir)) {
      fsSync.mkdirSync(logDir, { recursive: true });
    }

    const logFile = path.join(logDir, "main.log");
    const logStream = createWriteStream(logFile, { flags: "a" });

    const originalLog = console.log.bind(console);
    const originalWarn = console.warn.bind(console);
    const originalError = console.error.bind(console);

    console.log = (...args) => {
      originalLog(...args);
      logStream.write(`[LOG] ${new Date().toISOString()} ${args.map((a) => String(a)).join(" ")}\n`);
    };

    console.warn = (...args) => {
      originalWarn(...args);
      logStream.write(`[WARN] ${new Date().toISOString()} ${args.map((a) => String(a)).join(" ")}\n`);
    };

    console.error = (...args) => {
      originalError(...args);
      logStream.write(`[ERROR] ${new Date().toISOString()} ${args.map((a) => String(a)).join(" ")}\n`);
    };

    process.on("exit", () => {
      try {
        logStream.end();
      } catch {
        // ignore
      }
    });
  } catch (error) {
    console.warn("[setupFileLogging] Failed to set up file logging:", error);
  }
}

// ═══════════════════════════════════════════════════════════════════
// File path helpers (cache / session / server-config)
// ═══════════════════════════════════════════════════════════════════

function getCacheFilePath() {
  return path.join(app.getPath("userData"), "desktop-cache.json");
}

function getSessionFilePath() {
  return path.join(app.getPath("userData"), "desktop-session.json");
}

function getServerConfigFilePath() {
  return path.join(app.getPath("userData"), "server-config.json");
}

// ── Cache file management ─────────────────────────────────────────

async function readCacheFile() {
  const filePath = getCacheFilePath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeCacheFile(data) {
  const filePath = getCacheFilePath();
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

// ── Session file management ───────────────────────────────────────

async function readSessionFile() {
  const filePath = getSessionFilePath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeSessionFile(data) {
  const filePath = getSessionFilePath();
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function deleteSessionFile() {
  const filePath = getSessionFilePath();
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// Server config
// ═══════════════════════════════════════════════════════════════════

function getStoredServerConfig() {
  const filePath = getServerConfigFilePath();
  if (!fsSync.existsSync(filePath)) {
    return {};
  }
  try {
    const raw = fsSync.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeServerConfig(config) {
  const filePath = getServerConfigFilePath();
  const merged = {
    ...getStoredServerConfig(),
    ...(config || {}),
  };
  fsSync.writeFileSync(filePath, JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

async function testServerConnection(serverUrl) {
  const normalizedUrl = String(serverUrl || "").replace(/\/+$/, "");
  if (!normalizedUrl) {
    return { ok: false, error: "Keine URL angegeben." };
  }
  try {
    const response = await fetch(`${normalizedUrl}/api/v1/health`, {
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) {
      return { ok: true, status: response.status };
    }
    return { ok: false, status: response.status, error: `HTTP ${response.status}` };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || "Verbindung fehlgeschlagen.",
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// Cloudflare Access
// ═══════════════════════════════════════════════════════════════════

function getAccessCookieHeader(serverUrl) {
  const normalizedUrl = String(serverUrl || "").replace(/\/+$/, "");
  if (!normalizedUrl) {
    return null;
  }

  try {
    const session = readSessionFile();
    const urlSession = session[normalizedUrl];
    if (!urlSession || typeof urlSession !== "object") {
      return null;
    }

    const cookies = urlSession.cookies;
    if (!cookies || typeof cookies !== "object") {
      return null;
    }

    const cfCookies = Object.keys(cookies)
      .filter((key) => key.toLowerCase().startsWith("cf_") || key.toLowerCase() === "__cflb" || key.toLowerCase() === "cf_clearance")
      .map((key) => `${key}=${cookies[key]}`)
      .join("; ");

    return cfCookies || null;
  } catch {
    return null;
  }
}

function hasCloudflareAccessIdentity(serverUrl) {
  const cookieHeader = getAccessCookieHeader(serverUrl);
  return Boolean(cookieHeader);
}

async function openCloudflareAccessLoginWindow(serverUrl) {
  const normalizedUrl = String(serverUrl || "").replace(/\/+$/, "");
  if (!normalizedUrl) {
    throw new Error("Keine Server-URL angegeben.");
  }

  if (cloudflareAccessLoginPromise) {
    return cloudflareAccessLoginPromise;
  }

  cloudflareAccessLoginPromise = new Promise((resolve, reject) => {
    let loginWindow = null;
    let finished = false;
    let pollTimer = null;

    const cleanup = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const finish = (handler) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.close();
      }
      loginWindow = null;
      cloudflareAccessLoginPromise = null;
      handler();
    };

    const timeoutId = setTimeout(() => {
      finish(() => reject(new Error("Cloudflare Access Login Timeout.")));
    }, 300000);

    const pollCookies = async () => {
      if (finished || !loginWindow || loginWindow.isDestroyed()) return;
      try {
        const cookies = await loginWindow.webContents.session.cookies.get({});
        const cfCookies = cookies.filter(
          (cookie) =>
            cookie.name.toLowerCase().startsWith("cf_") ||
            cookie.name === "__cflb" ||
            cookie.name === "cf_clearance",
        );

        const cfAccessToken = cookies.find(
          (cookie) =>
            cookie.name.toLowerCase() === "cf_authorization" ||
            cookie.name.toLowerCase().startsWith("cf-access-") ||
            cookie.name.startsWith("CF_"),
        );

        if (cfCookies.length > 0 || cfAccessToken) {
          clearTimeout(timeoutId);
          const cookieMap = {};
          for (const cookie of cfCookies) {
            cookieMap[cookie.name] = cookie.value;
          }
          if (cfAccessToken && !cookieMap[cfAccessToken.name]) {
            cookieMap[cfAccessToken.name] = cfAccessToken.value;
          }

          try {
            const session = await readSessionFile();
            session[normalizedUrl] = { cookies: cookieMap, updatedAt: new Date().toISOString() };
            await writeSessionFile(session);
          } catch (writeError) {
            console.warn("[cloudflare] failed to persist session cookies", writeError);
          }

          const { default: { session: electronSession } } = await import("electron");
          const targetUrls = [
            `${normalizedUrl}/api/v1/health`,
            `${normalizedUrl}/api/v1/auth/steam/callback`,
          ];
          for (const url of targetUrls) {
            try {
              const cookieString = Object.entries(cookieMap)
                .map(([k, v]) => `${k}=${v}`)
                .join("; ");
              const parsedUrl = new URL(url);
              for (const [name, value] of Object.entries(cookieMap)) {
                await electronSession.cookies.set({
                  url: parsedUrl.origin,
                  name,
                  value,
                  domain: parsedUrl.hostname,
                });
              }
            } catch (cookieError) {
              console.warn(`[cloudflare] failed to set cookie for ${url}`, cookieError);
            }
          }

          finish(() => resolve({ ok: true, cookieCount: cfCookies.length }));
        }
      } catch (error) {
        console.warn("[cloudflare] cookie poll error:", error);
      }
    };

    const start = async () => {
      loginWindow = new BrowserWindow({
        parent: undefined,
        modal: false,
        width: 1180,
        height: 860,
        minWidth: 980,
        minHeight: 700,
        show: true,
        title: "Cloudflare Access Login",
        webPreferences: {
          contextIsolation: true,
          partition: "persist:cloudflare-access",
        },
      });

      loginWindow.on("closed", () => {
        clearTimeout(timeoutId);
        finish(() => reject(new Error("Cloudflare Access Login wurde geschlossen, bevor der Authentifizierungsprozess abgeschlossen war.")));
      });

      await loginWindow.loadURL(normalizedUrl);
      await new Promise((r) => setTimeout(r, 1000));
      await pollCookies();
      pollTimer = setInterval(() => {
        void pollCookies();
      }, 1500);
    };

    start().catch((error) => {
      clearTimeout(timeoutId);
      finish(() => reject(error));
    });
  });

  return cloudflareAccessLoginPromise;
}

async function ensureCloudflareAccessSession(serverUrl) {
  if (hasCloudflareAccessIdentity(serverUrl)) {
    return { ok: true, alreadyAuthenticated: true };
  }
  return await openCloudflareAccessLoginWindow(serverUrl);
}

// ═══════════════════════════════════════════════════════════════════
// Local store loader
// ═══════════════════════════════════════════════════════════════════

async function getLocalStore() {
  if (createLocalStore) {
    return createLocalStore;
  }
  try {
    // Dynamic import() needs a file:// URL for absolute paths on Windows,
    // otherwise the drive letter (C:) is parsed as a URL scheme and throws
    // ERR_UNSUPPORTED_ESM_URL_SCHEME.
    const localStorePath = resolveRuntimePath(
      "apps", "desktop", "src", "localStore", "index.js",
    );
    const localStoreModule = await import(pathToFileURL(localStorePath).href);
    createLocalStore = localStoreModule.createLocalStore;
    return createLocalStore;
  } catch (error) {
    console.error("[main] failed to load local store:", error);
    createLocalStore = null;
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Create window
// ═══════════════════════════════════════════════════════════════════

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 980,
    minHeight: 700,
    show: false,
    frame: true,
    icon: resolveRuntimePath("icon.ico"),
    title: APP_NAME,
    webPreferences: {
      preload: resolveRuntimePath("apps", "desktop", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
    },
  });

  if (distIndexPath && fsSync.existsSync(distIndexPath)) {
    win.loadFile(distIndexPath);
  } else {
    const devUrl = "http://localhost:5173";
    console.log("[main] loading dev server:", devUrl);
    win.loadURL(devUrl);
  }

  win.once("ready-to-show", () => {
    win.show();
    if (pendingProtocolUrl) {
      const url = pendingProtocolUrl;
      pendingProtocolUrl = null;
      handleProtocolUrl(url);
    }
  });

  win.on("closed", () => {
    mainWindow = null;
  });

  mainWindow = win;

  return win;
}

// ═══════════════════════════════════════════════════════════════════
// Protocol handler (cs-investor-hub://)
// ═══════════════════════════════════════════════════════════════════

function registerProtocol() {
  if (!app.isPackaged) {
    return;
  }
  try {
    app.setAsDefaultProtocolClient(PROTOCOL);
    console.log(`[protocol] registered ${PROTOCOL}://`);
  } catch (error) {
    console.warn("[protocol] failed to register protocol client:", error);
  }
}

function handleProtocolUrl(url) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingProtocolUrl = url;
    return;
  }
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send("protocol-url", url);
}

// ═══════════════════════════════════════════════════════════════════
// App lifecycle
// ═══════════════════════════════════════════════════════════════════

// ── Single instance lock ─────────────────────────────────────────

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }

    const protocolUrl = commandLine.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    if (protocolUrl) {
      handleProtocolUrl(protocolUrl);
    }
  });
}

// ── macOS open-url ──────────────────────────────────────────────

app.on("open-url", (event, url) => {
  event.preventDefault();
  if (url && url.startsWith(`${PROTOCOL}://`)) {
    handleProtocolUrl(url);
  }
});

// ── before-quit ─────────────────────────────────────────────────

app.on("before-quit", () => {
  clearUpdateCheckTimer();
  stopPhpSidecar();
});

// ── window-all-closed ───────────────────────────────────────────

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// ── app.whenReady ───────────────────────────────────────────────

app.whenReady().then(async () => {
  setupFileLogging();

  app.setName(APP_NAME);

  // Determine dist index path
  const distPath = resolveRuntimePath("dist", "index.html");
  if (fsSync.existsSync(distPath)) {
    distIndexPath = distPath;
    console.log("[main] dist found:", distIndexPath);
  } else {
    console.log("[main] no dist found, will use dev server");
  }

  registerProtocol();

  // Resolve backend base URL
  const serverConfig = getStoredServerConfig();
  const configuredUrl = String(serverConfig?.serverUrl || "").trim();
  if (configuredUrl) {
    backendBaseUrl = configuredUrl;
  } else {
    const dotEnv = readDotEnvFile(
      path.resolve(__dirname, "..", "..", "..", ".env"),
    );
    backendBaseUrl = String(dotEnv?.BACKEND_BASE_URL || "").trim() || "http://localhost:8080";
  }
  setBackendBaseUrl(backendBaseUrl);

  // Ensure encryption key for session tokens
  getOrCreateEncryptionKey();

  // Load local store module
  const storeLoader = await getLocalStore();
  if (typeof storeLoader === "function") {
    try {
      // createLocalStore(userDataPath) resolves the SQLite path from this
      // argument; omitting it makes path.join() throw "path must be a string"
      // and leaves localStore null → every IPC call returns
      // "Local store not available".
      localStore = storeLoader(app.getPath("userData"));
    } catch (storeError) {
      console.warn("[main] local store init error:", storeError);
    }
  }

  // Wire up IPC dependencies
  setIpcDeps({
    getLocalStore: () => localStore,
    readCacheFile,
    writeCacheFile,
    readSessionFile,
    writeSessionFile,
    deleteSessionFile,
    openCloudflareAccessLoginWindow,
    getStoredServerConfig,
    writeServerConfig,
    testServerConnection,
  });

  // Register all IPC handlers
  registerAllIpcHandlers();

  // Start sidecar
  try {
    await startPhpSidecar();
    console.log("[main] sidecar started");
  } catch (error) {
    console.warn("[main] sidecar start failed (will retry after vault unlock):", error?.message);
  }

  // Install request header bridge for sidecar auth
  await installSidecarRequestHeaderBridge();

  // Register updater refs
  const win = createWindow();
  const { setMainWindow: setUpdaterMainWindow, setLocalStoreRefs } = await import("./updater.js");
  setUpdaterMainWindow(win);
  setLocalStoreRefs(getLocalStore, localStore);

  // Setup auto-updater
  setupAutoUpdater();

  console.log(`[main] ${APP_NAME} ready`);
});

// Export for testing / external use
export {
  getStoredServerConfig,
  writeServerConfig,
  testServerConnection,
  readCacheFile,
  writeCacheFile,
  readSessionFile,
  writeSessionFile,
  deleteSessionFile,
  getLocalStore,
  createWindow,
  getAccessCookieHeader,
  hasCloudflareAccessIdentity,
  openCloudflareAccessLoginWindow,
  ensureCloudflareAccessSession,
};
