/* eslint-disable */
import { app, BrowserWindow, ipcMain, shell, safeStorage } from "electron";
import { spawn } from "child_process";
import { randomBytes } from "crypto";
import fs from "fs/promises";
import fsSync from "fs";
import net from "net";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

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
const secretsDirName = "secrets";
const csFloatApiKeyFileName = "csfloat-api-key.bin";
let createLocalStore = null;
let localStore = null;
let distIndexPath = null; // Will be set when app is ready
let phpSidecar = null;
let backendBaseUrl = null;
let sidecarSecret = null;

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

function getSecretsDirPath() {
  return path.join(app.getPath("userData"), secretsDirName);
}

function getCsFloatApiKeyFilePath() {
  return path.join(getSecretsDirPath(), csFloatApiKeyFileName);
}

function resolveRuntimePath(...segments) {
  const appPath = app.getAppPath();
  if (appPath.endsWith("app.asar")) {
    return path.join(process.resourcesPath, ...segments);
  }

  return path.join(appPath, ...segments);
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

function buildSidecarEnv() {
  const envFileValues = readDotEnvFile(resolveRuntimePath(".env"));
  const merged = {
    ...envFileValues,
    ...process.env,
  };
  const localCsFloatApiKey = getStoredCsFloatApiKey();

  merged.APP_ENV = merged.APP_ENV || "desktop";
  merged.DESKTOP_SIDECAR_SECRET = sidecarSecret;
  if (localCsFloatApiKey) {
    merged.CSFLOAT_API_KEY = localCsFloatApiKey;
  }

  if (!merged.DESKTOP_DB_HOST && merged.DB_HOST === "db") {
    merged.DB_HOST = "127.0.0.1";
  } else if (merged.DESKTOP_DB_HOST) {
    merged.DB_HOST = merged.DESKTOP_DB_HOST;
  }

  return merged;
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

  if (!fsSync.existsSync(routerScript)) {
    console.warn("[sidecar] backend desktop/index.php not found:", routerScript);
    return null;
  }

  const port = await findFreePort();
  sidecarSecret = randomBytes(32).toString("hex");
  backendBaseUrl = `http://127.0.0.1:${port}`;

  const phpBinary = process.env.PHP_BINARY || "php";
  phpSidecar = spawn(
    phpBinary,
    [
      "-d",
      "extension=pdo_mysql",
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
      env: buildSidecarEnv(),
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
    console.warn("[sidecar] exited", { code, signal });
    if (phpSidecar === currentSidecar) {
      phpSidecar = null;
      backendBaseUrl = null;
    }
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
    return JSON.parse(content);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("[desktop-session] failed to read session file", error);
    }
    return null;
  }
}

async function writeSessionFile(sessionData) {
  await fs.mkdir(path.dirname(getSessionFilePath()), { recursive: true });
  await fs.writeFile(
    getSessionFilePath(),
    JSON.stringify(sessionData, null, 2),
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
      // Enable DevTools
      devTools: true,
    },
    icon: path.join(__dirname, "icon.ico"),
  });

  mainWindow.setMenu(null);
  mainWindow.maximize(); // Startet das Fenster in "Fullscreen-Window" Modus
  mainWindow.show(); // Jetzt anzeigen

  // Always open DevTools for debugging
  mainWindow.webContents.openDevTools({ mode: "detach" });
  console.log("[main] DevTools opened in detach mode");

  // Log renderer console messages to file
  mainWindow.webContents.on("console-message", (event, level, message, line, sourceId) => {
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
    
    const token = params.get("token");
    
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

ipcMain.handle("backend-base-url", () => backendBaseUrl);
ipcMain.handle("backend-sidecar-secret", () => sidecarSecret);
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

ipcMain.handle("local-store-info", () => getLocalStore().getInfo());
ipcMain.handle("local-store-list-investments", (event, userId) =>
  getLocalStore().listInvestments(userId),
);
ipcMain.handle("local-store-import-investments", (event, rows, userId) =>
  getLocalStore().importInvestments(rows, userId),
);
ipcMain.handle("local-store-upsert-investment", (event, payload) =>
  getLocalStore().upsertInvestment(payload),
);
ipcMain.handle("local-store-delete-investment", (event, id) =>
  getLocalStore().deleteInvestment(id),
);
ipcMain.handle("local-store-get-investment", (event, id) =>
  getLocalStore().getInvestment(id),
);
ipcMain.handle("local-store-list-watchlist", (event, userId) =>
  getLocalStore().listWatchlistItems(userId),
);
ipcMain.handle("local-store-import-watchlist", (event, rows, userId) =>
  getLocalStore().importWatchlistItems(rows, userId),
);
ipcMain.handle("local-store-upsert-watchlist-item", (event, payload) =>
  getLocalStore().upsertWatchlistItem(payload),
);
ipcMain.handle("local-store-delete-watchlist-item", (event, id) =>
  getLocalStore().deleteWatchlistItem(id),
);
ipcMain.handle("local-store-list-portfolio-snapshots", (event, userId, limit) =>
  getLocalStore().listPortfolioSnapshots(userId, limit),
);
ipcMain.handle("local-store-upsert-portfolio-snapshot", (event, payload) =>
  getLocalStore().upsertPortfolioSnapshot(payload),
);
ipcMain.handle("local-store-upsert-price", (event, payload) =>
  getLocalStore().upsertPrice(payload),
);
ipcMain.handle("local-store-list-pending-operations", (event, limit) =>
  getLocalStore().listPendingOperations(limit),
);
ipcMain.handle("local-store-mark-operation-applied", (event, id) =>
  getLocalStore().markOperationApplied(id),
);

app.on("window-all-closed", () => {
  localStore?.close();
  stopPhpSidecar();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopPhpSidecar();
});
