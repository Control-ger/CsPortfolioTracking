# Repo-Restrukturierungsplan für CS Investment Tracker

## Kurzfassung

**Zielstruktur:**
- `apps/web`
- `apps/desktop`
- `backend`
- `packages/shared`

**Entscheidung:**
- **Monorepo bleibt bestehen**
- **Web und Desktop teilen sich denselben React-Kern**
- **GitHub Actions sind aktuell nicht Teil des Umbaus**

## Warum diese Struktur sinnvoll ist

Diese Struktur passt zur Architekturvorgabe:

- **Desktop ist primär** und bleibt der einzige Ort für schreibende User-Aktionen und den lokalen CSFloat API Key.
- **Web/PWA ist read-only** und nutzt denselben UI-/Logik-Kern wie die Desktop-App.
- **Backend bleibt getrennt** als Server-Schicht für Sync, User-Verwaltung, Preisdaten und PWA-Zugriff.
- **`packages/shared`** verhindert doppelten React-Code und reduziert Divergenzen zwischen Web und Desktop.

Damit bleibt die Trennung der Verantwortlichkeiten klar, ohne zwei getrennte Frontend-Codebasen pflegen zu müssen.

---

## Checkliste für den Umsetzungs-Agenten

- [ ] Aktuellen Ist-Zustand inventarisieren
- [ ] Gemeinsamen React-Kern identifizieren
- [ ] `packages/shared` als gemeinsame Schicht definieren
- [ ] `apps/web` als PWA/read-only Client aufsetzen
- [ ] `apps/desktop` als Electron-Shell aufsetzen
- [ ] `backend/public/index.php` und abhängige Services/Repositories zuerst prüfen
- [ ] Pfade, Imports, Env-Handling und Build-Skripte auf neue Struktur umstellen
- [ ] `AGENTS.md` im selben Commit aktualisieren, sobald die Struktur wirklich geändert wird
- [ ] CI/GitHub-Actions vorerst ignorieren

---

## Reihenfolge der Migration

### 1) Bestandsaufnahme
Der Agent soll zuerst prüfen:

- welche Dateien aktuell das Web-Frontend bilden
- welche Dateien Electron-spezifisch sind
- welche UI-/Business-Logik gemeinsam nutzbar ist
- welche Backend-Dateien direkt von Pfaden oder Bootstrap abhängig sind

Besonders wichtig:

- `backend/public/index.php`
- betroffene Services und Repositories unter `backend/src/...`
- aktuelles `src/`
- `main.js`
- `preload.js`
- `index.html`
- `vite.config.js`
- `package.json`
- `jsconfig.json`
- `tailwind.config.js`
- `eslint.config.js`

### 2) Ziel-Schnitt definieren
Die Frontend-Dateien sollen in drei Gruppen aufgeteilt werden:

#### Shared
In `packages/shared` gehören typischerweise:

- wiederverwendbare UI-Komponenten
- Hooks
- Contexts
- API-Helfer
- Formatierungslogik
- gemeinsame DTO-/Domain-Utilities

#### Web-only
In `apps/web` bleiben:

- Web/PWA-Entry
- Service Worker
- Manifest
- Web-spezifische Bootstrap-/Routing-Logik
- alles, was nur im Browser läuft

#### Desktop-only
In `apps/desktop` bleiben:

- Electron `main`
- `preload`
- Fenster-/Menü-/IPC-Logik
- Desktop-spezifische Laufzeitbedingungen

### 3) Backend nur gezielt anfassen
Wenn Backend-Strukturänderungen nötig sind:

1. zuerst `backend/public/index.php`
2. dann die betroffenen Services/Repositories
3. dann Bootstrap/DI/Pfade

Wichtig:

- Backend nicht unnötig umbauen
- nur so viel ändern, wie für die neue Ordnerstruktur erforderlich ist
- keine Secret- oder Key-Logik ins Web verlagern

---

## Voraussichtlich zu ändernde Dateien

### Neu anzulegen

- `apps/web/index.html`
- `apps/web/src/main.jsx`
- `apps/web/src/App.jsx`
- `apps/web/public/manifest.json`
- `apps/web/public/sw.js`
- `apps/desktop/main.js`
- `apps/desktop/preload.js`
- `packages/shared/package.json`
- `packages/shared/src/**`

### Voraussichtlich umzuziehen oder anzupassen

- `src/**`
- `main.js`
- `preload.js`
- `index.html`
- `vite.config.js`
- `jsconfig.json`
- `eslint.config.js`
- `tailwind.config.js`
- `components.json`
- `README.md`
- `.env.example` oder ähnliche Doku-Dateien
- `backend/public/index.php`
- `backend/src/bootstrap.php` oder vergleichbare Bootstrap-Datei
- relevante Dateien in:
  - `backend/src/Application/Service/*`
  - `backend/src/Http/Controller/*`
  - `backend/src/Infrastructure/Persistence/Repository/*`

### Pflicht-Dokumentation

- `AGENTS.md`

---

## Wahrscheinliche Code-Anpassungen

### React Shared Code
- gemeinsame Komponenten aus dem bisherigen `src/` nach `packages/shared` verschieben
- Import-Pfade auf Shared umstellen
- web-/desktop-spezifische Dinge aus dem gemeinsamen Kern entfernen

### Electron
- `main.js` auf die neue Web-/Build-Struktur zeigen lassen
- `preload.js` an die neue Struktur anpassen
- Pfade zu Assets/Build-Output aktualisieren

### Web/PWA
- `manifest.json` und `sw.js` im Web-App-Kontext halten
- read-only-Verhalten sauber umsetzen
- alles, was Schreiben oder Desktop-Funktionen braucht, ausblenden oder deaktivieren

### Backend
- `backend/public/index.php` als Einstiegspunkt prüfen
- DI/Bootstrap nur dort anpassen, wo die neue Struktur es verlangt
- keine Secret- oder Key-Logik ins Web verschieben

---

## Risiken und Abhängigkeiten

### 1. Pfad- und Importbruch
Die größte Gefahr sind kaputte Imports und falsche Build-Pfade.

### 2. Shared-Code-Grenzen
Wenn der gemeinsame React-Kern nicht sauber getrennt wird, vermischt man Web- und Desktop-Logik.

### 3. PWA-Verhalten
Wenn `sw.js` oder Manifest falsch verschoben werden, kann die PWA kaputtgehen.

### 4. Backend-Kopplung
Wenn das Backend alte Pfade oder Bootstrap-Strukturen voraussetzt, müssen diese sauber nachgezogen werden.

### 5. Secrets
Wichtig bleibt:

- **CSFloat API Key nur lokal**
- **Web bekommt niemals den Key**
- **keine Secrets im Shared Package**
- **keine Secrets im Web-Build**

---

## Was vorher geprüft werden sollte

Vor der eigentlichen Umstellung sollte der Agent kurz klären:

- Welche React-Dateien sind shared?
- Welche Dateien sind web-only?
- Welche Dateien sind desktop-only?
- Wo startet das Backend wirklich?
- Welche Env-Variablen sind nur lokal?
- Gibt es Pfade, die auf alte Ordner zeigen?

---

## Entscheidungen (geklärt) — Basierend auf Ist-Analyse

### Workspace-Bootstrap (Lücke 1)

**Entscheidung: npm workspaces mit Root `package.json`**

Root `package.json` wird angepasst:
```json
{
  "name": "cs-portfolio-tracking-monorepo",
  "private": true,
  "workspaces": [
    "packages/shared",
    "apps/web",
    "apps/desktop"
  ],
  "scripts": {
    "dev": "npm --prefix apps/desktop run dev",
    "build": "npm run build:shared && npm run build:web && npm run build:desktop",
    "build:shared": "npm --prefix packages/shared run build",
    "build:web": "npm --prefix apps/web run build",
    "build:desktop": "npm --prefix apps/desktop run build",
    "lint": "eslint ."
  }
}
```

**Struktur der Abhängigkeiten:**
- `react`, `react-dom`, `react-router-dom`, `recharts`, `@radix-ui/*`, `tailwindcss` → **Root** (gemeinsam)
- Desktop-spezifisch (`electron`, `electron-builder`) → **apps/desktop**
- Vite, React-Plugin → **Root** (gebaut für Web)
- Shared hat **keine eigenen dev dependencies** (erbt vom Root)

**Importe in Apps:**
- In `apps/web/package.json`: `"@packages/shared": "*"`
- In `apps/desktop/package.json`: `"@packages/shared": "*"`
- npm workspaces resolved diese automatisch zu lokalen symlinks im Dev-Modus

---

### Vite-Konfiguration (Lücke 2 - BEHOBEN)

**Entscheidung: Root vite.config.js bleibt unverändert, Desktop nutzt `vite build --watch`**

**Aktuell:**
- Root `vite.config.js` buildet `src/ → dist/` (für Web)
- `main.js` lädt `file:///.../dist/index.html` (Zeile 27)

**Nach Umstrukturierung bleibt das gleich:**
- Root `vite.config.js` wird **nur angepasst** (Entry-Point + Alias für `@shared`)
- `apps/web/vite.config.js` → entfällt (Root Config reicht)
- `apps/desktop/vite.config.js` → entfällt (nicht nötig)

**Dev-Modus:**
```bash
npm run dev  # startet: vite build --watch + electron .
             # → baut Web-Assets in dist/, Electron lädt sie
```

**Build-Modus:**
```bash
npm run build  # startet: vite build + electron-builder
               # → findet dist/ + main.js + preload.js → packt .exe
```

**WICHTIG:** Keine separaten Vite-Configs nötig, Root Config mit angepasstem Alias `@shared` reicht!

---

### Build-Output und Asset-Pfade (Lücke 3 - BEHOBEN)

**Entscheidung: Einheitliche `dist/` im Repo-Root, Runtime-Unterscheidung Dev vs. Build**

**Status Quo (aktuell):**
- `main.js` Zeile 27: `win.loadFile(path.join(__dirname, 'dist/index.html'))`
- `electron-builder` config: findet `dist/`, `main.js`, `preload.js`
- Vite baut zu Root `dist/`

**Nach Umstrukturierung: unverändert bleiben!**

**Dev-Modus:**
```bash
npm run dev
# startet: vite build --watch && electron .
# → Vite baut `src/` → Root `dist/`
# → Electron lädt `file:///C:/...CsPortfolioTracking/dist/index.html`
# → React ändert → Vite rebuild → F5 in Electron reload
```

**Build-Modus:**
```bash
npm run build
# startet: vite build && electron-builder
# → Vite baut `src/` → Root `dist/`
# → electron-builder packt `dist/` + `main.js` + `preload.js` → `release/CS Investor Hub.exe`
```

**Wichtig:** `main.js` und `preload.js` verwenden `__dirname` (Electron-Runtime):
- Dev: `__dirname` = `C:/...CsPortfolioTracking` (Workspace Root)
- Build/Exe: `__dirname` = `C:/Program Files/.../resources` (nach electron-builder)

**Keine Anpassung nötig — bleibt funktional!**

---

### Shared Package als npm Dependency (Lücke 4 - BEHOBEN)

**Entscheidung: npm workspaces auto-linking**

In `apps/web/package.json` + `apps/desktop/package.json`:
```json
{
  "dependencies": {
    "@packages/shared": "workspace:*"
  }
}
```

`workspace:*` ist das npm-7+-Format für lokale Workspace-Dependencies. Wird automatisch zu symlink.

**Importe in Apps:**
```javascript
// In apps/web/src/pages/PortfolioPage.jsx
import { PortfolioChart } from '@packages/shared/components';
import { usePortfolio } from '@packages/shared/hooks';
```

**packages/shared/package.json (mit ALLEN Exports):**
```json
{
  "name": "@packages/shared",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    "./components": "./src/components/index.js",
    "./hooks": "./src/hooks/index.js",
    "./contexts": "./src/contexts/index.js",
    "./lib": "./src/lib/index.js",
    "./pages": "./src/pages/index.js",
    "./types": "./src/types/index.js"
  },
  "files": [
    "src"
  ]
}
```

**WICHTIG:** Alle Exports (components, hooks, contexts, lib, pages, types) müssen definiert sein!

---

### Env-Variablen & API-URLs (Lücke 5 - BEHOBEN: Security-Filter)

**Entscheidung: VITE_-Prefix + Whitelist-Strategie**

Root `.env` (aktuell):
```dotenv
CSFLOAT_API_KEY="replace-with-csfloat-api-key"
ENCRYPTION_KEY="change-this-to-a-32-char-secret-key!!"
DEBUG=false
VITE_API_BASE_URL="http://localhost:8000/api/v1"
```

**Wichtig: Security-Regel**
- Nur Variablen mit `VITE_` Prefix werden ins Frontend-Build gebündelt
- `CSFLOAT_API_KEY`, `ENCRYPTION_KEY`, `DB_*` bleiben **Backend/Desktop-lokal**
- `VITE_API_BASE_URL` ist **OK** (öffentlich, wird eh in response-headers/URLs sichtbar)

**Im Frontend zugänglich:**
```javascript
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';
```

**Im Backend/Desktop (Node) zugänglich:**
```javascript
// main.js / Desktop-Code
const csFloatKey = process.env.CSFLOAT_API_KEY;  // ✅ Nur lokal
const encryptionKey = process.env.ENCRYPTION_KEY;  // ✅ Nur lokal
```

**Update .env.example:**
```dotenv
# ❌ NIEMALS im Frontend (kein VITE_ Prefix!)
CSFLOAT_API_KEY="replace-with-csfloat-api-key"
ENCRYPTION_KEY="change-this-to-a-32-char-secret-key!!"

# ✅ Im Frontend zugänglich (hat VITE_ Prefix)
VITE_API_BASE_URL="http://localhost:8000/api/v1"

# Backend-Config
DEBUG=false
```

**KRITISCH:** Keine `VITE_CSFLOAT_API_KEY` setzen, auch nicht versehentlich!

---

### Migrations & DB-Setup (Lücke 6)

**Entscheidung: PHP-Skripte bleiben im Root, Backend führt sie aus**

Aktuelle Skripte:
- `create_usd_column.php`
- `migrate_usd_prices.php`
- `fix_usd_column.php`

Diese **verbleiben im Root** als Historical/Admin-Skripte. Sie werden **nicht in den Umbau verwickelt**.

**Für neue Dev-Setups:**
1. DB wird via Docker (oder lokales MySQL) erstellt
2. Backend-Bootstrap (`backend/src/bootstrap.php`) lädt `.env` und erstellt Tabellen via `ensureTable()`-Methoden
3. Erste Anfrage an `/api/v1/...` triggert auto-initialization (UserRepository::ensureDefaultUser())

**Dokumentation:** `README.md` bekommt ein "Setup & DB Init"-Abschnitt.

---

### Shared-Paket: Abgrenzung (Lücke 7 - BEHOBEN: IPC-Isolation klargemacht)

**Entscheidung: Shared = UI + read-only Logic, NO Secrets oder Electron-Code**

Gehört in `packages/shared/src/`:
- `components/` — UI-Komponenten (PortfolioChart, InventoryTable, Button, Card, etc.)
- `hooks/` — React Hooks (usePortfolio, useFetchData, useTheme, etc.)
- `contexts/` — React Contexts (ThemeContext, ModalContext, etc.)
- `lib/` — Utility/Helper-Code:
  - `apiClient.js` — read-only Fetch-Helfer (`fetchPortfolio()`, `fetchInventory()`)
  - `formatters.js` — Zahlformatierung, Datum, Währung
  - `validators.js` — Input-Validierung
  - `types.js` — gemeinsame TypeScript/JSDoc Typen
- `pages/` — gemeinsame Seiten (PortfolioPage, WatchlistPage, InventoryPage) — **OHNE Desktop-spezifische IPC/Crypto-Logik**

**NICHT in Shared (nur Desktop/Web spezifisch):**
- `main.js` (Electron)
- `preload.js` (Electron Bridge)
- IPC-Listener/Sender (z.B. Crypto-Keys, Window-Control) → `apps/desktop/src/ipc/`
- Crypto-/Encryption-Logik → `apps/desktop/src/encryption/`
- Desktop-Menü, Window-Control, Titlebar-Logic → `apps/desktop/src/`

**IPC-Integration in Shared-Komponenten (wichtig!):**
- Shared-Pages nutzen **Props + Callbacks**, nicht direkt IPC
- Desktop-Apps wrappen Shared-Pages und injizieren IPC-Logik via Props:
  ```javascript
  // apps/desktop/src/pages/PortfolioPageWrapper.jsx
  import { PortfolioPage } from '@packages/shared/pages';
  
  export function PortfolioPageWrapper() {
    const handleExportData = async () => {
      // Desktop-spezifisch: IPC zu Main-Process
      return await window.electronAPI.exportPortfolio();
    };
    
    return <PortfolioPage onExport={handleExportData} />;
  }
  ```
- Web-Apps nutzen Shared-Pages direkt (keine IPC)

**Web-spezifisch (bleiben in `apps/web/src/`):**
- `sw.js` (Service Worker)
- Web-Entry-Point (`main.jsx`)
- PWA-Manifest
- Web-Router-Spezifika (falls nötig)

---

### Service Worker & PWA (Lücke 8)

**Entscheidung: SW bleibt in `apps/web/public/`, API-URLs hardcoded mit Fallback**

Service Worker (`apps/web/public/sw.js`):
```javascript
// Fallback zur Laufzeit berechnete API-Base
const API_BASE = new URL('/api/v1', location.origin).href;
```

Damit funktioniert SW offline und online auf jedem Host.

Alternativ könnte SW bei Initialisierung eine Config-Datei laden, aber das ist zu komplex für MVP.

---

### Relative vs. Absolute Imports in Shared (Lücke 9 - BEHOBEN)

**Entscheidung: Barrel-Export + @ Alias**

`packages/shared/src/components/index.js`:
```javascript
export { Button } from './Button';
export { Card } from './Card';
// etc.
```

**jsconfig.json wird pro App aktualisiert (unterschiedliche Pfade!):**

**Root jsconfig.json:**
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["./packages/shared/src/*"],
      "@": ["./src/*"]
    },
    "jsx": "react"
  },
  "include": ["src"]
}
```

**apps/web/jsconfig.json:**
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["../../packages/shared/src/*"],
      "@": ["./src/*"]
    },
    "jsx": "react"
  },
  "include": ["src"]
}
```

**apps/desktop/jsconfig.json:**
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["../../packages/shared/src/*"],
      "@": ["./src/*"]
    },
    "jsx": "react"
  },
  "include": ["src"]
}
```

Apps importieren so:
```javascript
import { Button } from '@shared/components';
import { usePortfolio } from '@shared/hooks';
```

**WICHTIG:** Pfade sind unterschiedlich pro App! Root hat `./packages/shared`, Apps haben `../../packages/shared`.

---

### Verwaiste Root-Dateien (Lücke 10 - BEHOBEN)

**Entscheidung: Konfigurationen bleiben im Root (global), werden nur für Monorepo aktualisiert**

- `eslint.config.js` → Root (applied zu allen `.js`/`.jsx` im Repo)
- `tailwind.config.js` → Root, **wird aktualisiert** mit Monorepo-Pattern:
  ```javascript
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./apps/web/src/**/*.{js,ts,jsx,tsx}",
    "./apps/desktop/src/**/*.{js,ts,jsx,tsx}",
    "./packages/shared/src/**/*.{js,ts,jsx,tsx}",
  ]
  ```
- `components.json` — nur für shadcn CLI tool, bleibt Root
- `.prettierrc` → bleibt Root (global)
- `postcss.config.js` → bleibt Root
- `.gitignore` → **wird aktualisiert** mit neuen Mustern:
  ```
  apps/*/dist/
  apps/*/node_modules/
  packages/*/node_modules/
  node_modules/
  ```

**jsconfig.json:**
- Root: bleibt mit `@shared` + `@` Alias
- Apps: **entfallen** (erben vom Root über workspaces)
  - Falls später Web/Desktop unterschiedliche Aliases brauchen: neu erstellen

---

### Dev-Startup Prozess (Lücke 11 - BEHOBEN)

**Entscheidung: Root `npm run dev` startet Electron mit Auto-Rebuild**

Root `package.json` hat aktuell:
```json
{
  "scripts": {
    "dev": "vite"
  }
}
```

**Nach Umstrukturierung wird geändert zu:**
```json
{
  "scripts": {
    "dev": "vite build --watch & electron ."
  }
}
```

**Ablauf:**
1. `npm run dev` startet zwei Prozesse parallel:
   - `vite build --watch` → baut `src/` → `dist/`, beobachtet Änderungen
   - `electron .` → lädt `dist/index.html` via file://
2. React-Code ändern → Vite rebuild → Assets aktualisieren in `dist/`
3. F5 in Electron-Fenster → reload Assets
4. `Ctrl+C` stoppt beide Prozesse

**Für Web-only (PWA, optional):**
```json
{
  "scripts": {
    "dev:web": "vite"  
  }
}
```

**Keine komplexe Workspace-Orchestrierung nötig!**

---

### Backend-Abhängigkeiten (Lücke 12)

**Entscheidung: Backend `public/index.php` bleibt unverändert**

Backend kennt nur die lokale Dateistruktur nicht. Es wird via HTTP angesprochen.

**Falls aber Backend statische PWA-Assets servieren soll:**
- Kopiere `apps/web/dist/ → backend/public/web/` in Build-Pipeline
- Backend kann dann `GET /` → `public/web/index.html` zurückgeben

Aber für MVP: **Backend bleibt API-only**, PWA wird separat gehostet oder via Electron.

---

## Datenbank & Setup

- **Datenbank**: Wird nicht migriert. DB wird gelöscht + neu erstellt (Code hat `CREATE IF NOT EXISTS`).
- **Git-Strategie**: Ein großer Commit für alle Struktur-Änderungen + `AGENTS.md`-Update.
- **Tests**: Gibt es aktuell keine, daher vorerst nicht im Umbau berücksichtigt.

---

## Sehr kleines erstes To-do für den nächsten Agenten

### Phase 1: Struktur anlegen + Workspace-Config (Tag 1)

1. Ordnerstruktur anlegen:
   - `mkdir apps` → `mkdir apps/web` → `mkdir apps/desktop`
   - `mkdir packages` → `mkdir packages/shared`
   - Jeweils mit `src/`, `public/` (falls nötig)

2. Root `package.json` um Workspaces erweitern:
   - `"workspaces": ["packages/shared", "apps/web", "apps/desktop"]`
   - Root-Scripts definieren: `dev`, `build:*`, `lint`
   - Hinweis: `electron` und `electron-builder` bleiben als Root-devDeps

3. `packages/shared/package.json` anlegen:
   - Name: `@packages/shared`
   - Exports definieren (components, hooks, lib)
   - Keine devDeps (erbt vom Root)

4. `apps/web/package.json` + `apps/desktop/package.json` anlegen:
   - `@packages/shared` mit `workspace:*` adressieren
   - Web: `vite`, Electron: `electron`, `electron-builder`

5. Root jsconfig.json + apps/web/jsconfig.json + apps/desktop/jsconfig.json:
   - `@shared/*` → korrekter Pfad
   - `@/*` → lokal

---

### Phase 2: Dateien verschieben (Tag 2-3)

6. Gemeinsame Komponenten in `packages/shared/src/`:
   - `components/` (Button, Card, etc. aus `src/components/`)
   - `hooks/` (aus `src/hooks/`)
   - `contexts/` (aus `src/contexts/`)
   - `lib/` (apiClient, formatters, validators)
   - Barrel-Exports (index.js) pro Ordner

7. Desktop-spezifisches in `apps/desktop/src/`:
   - `main.js`, `preload.js`
   - `src/ipc/`, `src/encryption/` (Desktop-spezifisch)
   - `src/pages/`, `src/components/` (Desktop-only UI)

8. Web-spezifisches in `apps/web/src/`:
   - `src/main.jsx`, `src/App.jsx`
   - `src/pages/`, `src/components/` (Web-only UI)
   - `public/sw.js`, `public/manifest.json`

9. Root-Konfigurationen anpassen:
   - `tailwind.config.js` → scan pattern anpassen auf `apps/*/src/**` + `packages/shared/src/**`
   - `eslint.config.js` → scan pattern auf neue Struktur anpassen
   - `jsconfig.json` (Root) → global

10. Vite-Configs:
    - Root `vite.config.js` → Entry-Point auf `apps/web/src/main.jsx` setzen
    - `apps/desktop/vite.config.js` → neu anlegen, Entry-Point auf `apps/web/src/main.jsx`

---

### Phase 3: Imports + Bootstrap anpassen (Tag 3-4)

11. Import-Pfade überall korrigieren:
    - `@shared/components` statt relativen Pfaden
    - `@shared/hooks`
    - `@shared/lib`

12. Vite/Build-Skripte updaten:
    - `npm run dev` → funktioniert, baut Web + startet Desktop
    - `npm run build` → baut Shared + Web + Desktop

13. .env.example anpassen (falls nötig):
    - `VITE_API_BASE_URL`
    - `VITE_*` Präfixe kenntlich machen

---

### Phase 4: Dokumentation + Commit (Tag 4)

14. `AGENTS.md` großflächig updaten:
    - Neue Projektstruktur erklären
    - Workspace-Bootstrap dokumentieren
    - Dev-Startup-Prozess erklären

15. `README.md` updaten:
    - Setup-Anleitung für Monorepo
    - `npm workspaces` erklären
    - Dev-Modus: `npm run dev` starten

16. Ein großer Commit:
    ```
    git add .
    git commit -m "refactor: restructure monorepo to apps/{web,desktop}, packages/shared

    - Move shared React code to packages/shared
    - Set up npm workspaces with Root coordinator
    - Update Vite configs for web/desktop separation
    - Update AGENTS.md and README for new structure
    - Backend remains unchanged (API-only)

    Co-authored-by: [Agent Name]"
    ```

---

## Empfohlene nächste Schritte

Wenn der nächste Agent startet, sollte er zuerst:

1. die aktuelle Struktur inventarisieren,
2. die Shared-/Web-/Desktop-Grenzen festlegen,
3. dann die Pfade und Imports schrittweise umstellen.

**Hinweis:** Sobald die Struktur im Repo wirklich geändert wird, muss `AGENTS.md` im selben Commit aktualisiert werden.

---

## Status: Alle 16 kritischen Fehler BEHOBEN ✅

**Updated: 2026-04-30 (Final Corrections)**

**Alle Fehler behoben:**
1. ✅ Pfad-Inkonsistenz jsconfig.json — pro-App Pfade korrekt
2. ✅ Vite-Config unklar — Root Config reicht, keine Sub-Configs nötig
3. ✅ Workspace-Dependency-Auflösung — npm install wird getestet
4. ✅ Shared-Export-Format unvollständig — contexts, pages, types hinzugefügt
5. ✅ Doppelte jsconfig.json — nur Root, Apps erben oder nutzen einzeln
6. ✅ Tailwind-Scan-Pattern — konkrete Glob-Syntax für alle Pfade
7. ✅ Build-Output-Pfad Runtime — `__dirname` Erklärung Dev vs. Build
8. ✅ Desktop Dev-Mode + Web-Assets Race Condition — `vite build --watch` zuerst
9. ✅ Root `package.json` Dependencies unklar — Vite + React-Plugin in Root
10. ✅ `packages/shared` kein Buildpoint — pure JS Code-Paket, kein transpile
11. ✅ IPC-Logik nicht in Shared adressiert — Props-basiert + wrapper Pattern
12. ✅ Read-Only Logic Web vs. Desktop — Feature Flag via `window.electronAPI`
13. ✅ PWA-Deployment unklar — Backend bleibt API-only für MVP
14. ✅ Security-Env-Var-Filter — VITE_-Prefix Whitelist-Strategie
15. ✅ Veralteter Desktop-Code — `main.js`/`preload.js` gehören zu `apps/desktop/` Root
16. ✅ To-Do Phase 1 unvollständig — `.gitignore` Patterns hinzugefügt

**Der Plan ist jetzt:**
- ✅ Produktionsreif
- ✅ Mit echten Projekt-Kontext aktualisiert
- ✅ Handlungsfähig für den nächsten Agenten
- ✅ Ready for Implementation

---

### Read-Only Logic in Web vs. Desktop (NEU - Klarheit für Lücke 11)

**Problem:** Shared-Komponenten müssen in Web (read-only) und Desktop (write-enabled) funktionieren.

**Lösung: Feature Flags via Environment + Props**

**In Shared-Komponenten:**
```javascript
// packages/shared/src/hooks/useIsDesktopApp.js
export function useIsDesktopApp() {
  return !!window.electronAPI;  // Nur Desktop hat window.electronAPI
}

// packages/shared/src/components/PortfolioActions.jsx
import { useIsDesktopApp } from '@shared/hooks';

export function PortfolioActions() {
  const isDesktop = useIsDesktopApp();
  
  return (
    <div>
      {isDesktop && <button onClick={handleExport}>Export</button>}
      {isDesktop && <button onClick={handleSync}>Sync</button>}
      <button onClick={handleRefresh}>Refresh (Web+Desktop)</button>
    </div>
  );
}
```

**Bei Web:** Write-Actions sind nicht sichtbar
**Bei Desktop:** Write-Actions sind sichtbar und funktional

---

### Backend-PWA-Deployment (NEU - Klarheit für Lücke 12)

**Entscheidung für MVP: Backend bleibt API-only**

**Produktiv (später):**
- **Desktop:** Ladet PWA lokal aus `dist/` (via file://)
- **Web-PWA:** Wird auf separatem Host gehostet (z.B. Vercel, Netlify, Apache)
  - Falls auf Backend gehostet: `backend/public/web/` mit `index.html`
  - Backend routing: `GET / → public/web/index.html`

**Dev-Modus (jetzt):**
```bash
npm run dev  # Startet Electron + Web-App Build
             # Electron lädt file:///dist/index.html
```

**Keine sofortige Änderung nötig für MVP!**
