/* eslint-disable */
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheFileName = 'cache.json';
let createLocalStore = null;
let localStore = null;

function getLocalStore() {
    if (!localStore) {
        localStore = createLocalStore(app.getPath('userData'));
    }
    return localStore;
}

function getCacheFilePath() {
    return path.join(app.getPath('userData'), cacheFileName);
}

async function readCacheFile() {
    try {
        const content = await fs.readFile(getCacheFilePath(), 'utf8');
        return JSON.parse(content);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.warn('[desktop-cache] failed to read cache file', error);
        }
        return {};
    }
}

async function writeCacheFile(cacheData) {
    await fs.mkdir(path.dirname(getCacheFilePath()), { recursive: true });
    await fs.writeFile(getCacheFilePath(), JSON.stringify(cacheData, null, 2), 'utf8');
}

function createWindow() {
    const win = new BrowserWindow({
        title: "CS Portfolio Tracking",
        width: 1280,
        height: 720,
        show: false, // Erst verstecken, um das Flackern beim Maximieren zu verhindern
        frame: false, // <--- Entfernt die hässliche Windows-Standardleiste
        titleBarStyle: 'hidden', // Alternativ für macOS/Windows Integration
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
        },
        icon: path.join(__dirname, 'icon.ico'),
    });

    win.setMenu(null);
    win.maximize(); // Startet das Fenster im "Fullscreen-Window" Modus
    win.show();     // Jetzt anzeigen

    win.loadFile(path.join(__dirname, 'dist/index.html'));

    win.on('closed', () => {
        app.quit();
    });
}

// App starten
app.whenReady().then(async () => {
    const base = __dirname.includes('app.asar')
        ? __dirname.replace('app.asar', 'app.asar.unpacked')
        : __dirname;
    const localStorePath = path.join(base, 'apps/desktop/src/localStore/index.js');

    // pathToFileURL correctly produces file:///C:/... on Windows
    ({ createLocalStore } = await import(pathToFileURL(localStorePath).href));

    createWindow();
});
ipcMain.on('window-control', (event, action) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return;

    if (action === 'close') {
        win.close();
    } else if (action === 'minimize') {
        win.minimize();
    } else if (action === 'maximize') {
        if (win.isMaximized()) {
            win.unmaximize();
        } else {
            win.maximize();
        }
    }
});

ipcMain.handle('local-cache-read', async (event, key) => {
    const cacheData = await readCacheFile();
    return cacheData[key] || null;
});

ipcMain.handle('local-cache-write', async (event, key, content) => {
    try {
        const cacheData = await readCacheFile();
        cacheData[key] = content;
        await writeCacheFile(cacheData);
        return true;
    } catch (error) {
        console.warn('[desktop-cache] failed to write cache entry', error);
        return false;
    }
});

ipcMain.handle('local-cache-remove', async (event, key) => {
    try {
        const cacheData = await readCacheFile();
        delete cacheData[key];
        await writeCacheFile(cacheData);
        return true;
    } catch (error) {
        console.warn('[desktop-cache] failed to remove cache entry', error);
        return false;
    }
});

ipcMain.handle('local-store-info', () => getLocalStore().getInfo());
ipcMain.handle('local-store-list-investments', (event, userId) => getLocalStore().listInvestments(userId));
ipcMain.handle('local-store-import-investments', (event, rows, userId) => getLocalStore().importInvestments(rows, userId));
ipcMain.handle('local-store-upsert-investment', (event, payload) => getLocalStore().upsertInvestment(payload));
ipcMain.handle('local-store-delete-investment', (event, id) => getLocalStore().deleteInvestment(id));
ipcMain.handle('local-store-get-investment', (event, id) => getLocalStore().getInvestment(id));
ipcMain.handle('local-store-list-watchlist', (event, userId) => getLocalStore().listWatchlistItems(userId));
ipcMain.handle('local-store-import-watchlist', (event, rows, userId) => getLocalStore().importWatchlistItems(rows, userId));
ipcMain.handle('local-store-upsert-watchlist-item', (event, payload) => getLocalStore().upsertWatchlistItem(payload));
ipcMain.handle('local-store-delete-watchlist-item', (event, id) => getLocalStore().deleteWatchlistItem(id));
ipcMain.handle('local-store-list-portfolio-snapshots', (event, userId, limit) => getLocalStore().listPortfolioSnapshots(userId, limit));
ipcMain.handle('local-store-upsert-portfolio-snapshot', (event, payload) => getLocalStore().upsertPortfolioSnapshot(payload));
ipcMain.handle('local-store-upsert-price', (event, payload) => getLocalStore().upsertPrice(payload));
ipcMain.handle('local-store-list-pending-operations', (event, limit) => getLocalStore().listPendingOperations(limit));
ipcMain.handle('local-store-mark-operation-applied', (event, id) => getLocalStore().markOperationApplied(id));

// Shell / External links
ipcMain.handle('open-external', async (event, url) => {
    await shell.openExternal(url);
    return true;
});

// Auth Session Management
const sessionFileName = 'session.enc';
let currentSession = null;

function getSessionFilePath() {
    return path.join(app.getPath('userData'), sessionFileName);
}

async function readSessionFile() {
    try {
        const content = await fs.readFile(getSessionFilePath(), 'utf8');
        return JSON.parse(content);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.warn('[desktop-session] failed to read session file', error);
        }
        return null;
    }
}

async function writeSessionFile(sessionData) {
    await fs.mkdir(path.dirname(getSessionFilePath()), { recursive: true });
    await fs.writeFile(
        getSessionFilePath(),
        JSON.stringify(sessionData, null, 2),
        'utf8'
    );
}

ipcMain.handle('store-session', async (event, token, user) => {
    try {
        currentSession = { token, user, createdAt: new Date().toISOString() };
        await writeSessionFile(currentSession);
        return true;
    } catch (error) {
        console.warn('[desktop-session] failed to store session', error);
        return false;
    }
});

ipcMain.handle('get-session', async () => {
    try {
        if (!currentSession) {
            currentSession = await readSessionFile();
        }
        return currentSession;
    } catch (error) {
        console.warn('[desktop-session] failed to get session', error);
        return null;
    }
});

ipcMain.handle('clear-session', async () => {
    try {
        currentSession = null;
        await fs.unlink(getSessionFilePath()).catch(() => {});
        return true;
    } catch (error) {
        console.warn('[desktop-session] failed to clear session', error);
        return false;
    }
});

app.on('window-all-closed', () => {
    localStore?.close();
    if (process.platform !== 'darwin') app.quit();
});
