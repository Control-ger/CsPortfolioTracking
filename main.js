/* eslint-disable */
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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
app.whenReady().then(createWindow);
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

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
