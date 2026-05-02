/* eslint-disable */
import { app, BrowserWindow, ipcMain } from "electron";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheFileName = "cache.json";
let localStore = null;

// ESM imports don't go through Electron's ASAR path patching.
// In the packaged app, unpacked files live at app.asar.unpacked/...
// but import.meta.url still points at app.asar/..., so we need
// to correct the path before dynamic-importing the localStore.
const localStorePath = __dirname.includes("app.asar")
  ? __dirname.replace("app.asar", "app.asar.unpacked") +
    "/src/localStore/index.js"
  : path.join(__dirname, "src/localStore/index.js");

const { createLocalStore } = await import(`file://${localStorePath}`);

function getLocalStore() {
  if (!localStore) {
    localStore = createLocalStore(app.getPath("userData"));
  }

  return localStore;
}

function getCacheFilePath() {
  return path.join(app.getPath("userData"), cacheFileName);
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

function createWindow() {
  const win = new BrowserWindow({
    title: "CS Portfolio Tracking",
    width: 1280,
    height: 720,
    show: false, // Erst verstecken, um das Flackern beim Maximieren zu verhindern
    frame: false, // <--- Entfernt die hässliche Windows-Standardleiste
    titleBarStyle: "hidden", // Alternativ für macOS/Windows Integration
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
    },
    icon: path.join(__dirname, "icon.ico"),
  });

  win.setMenu(null);
  win.maximize(); // Startet das Fenster im "Fullscreen-Window" Modus
  win.show(); // Jetzt anzeigen

  win.loadFile(path.join(__dirname, "dist/index.html"));

  win.on("closed", () => {
    app.quit();
  });
}

// App starten
app.whenReady().then(createWindow);
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
  if (process.platform !== "darwin") app.quit();
});
