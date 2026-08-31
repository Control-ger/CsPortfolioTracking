# CS Tracking

## Video
Tried Claude with Remotion for this one:
<video src="https://github.com/user-attachments/assets/18241488-2846-4a69-b66b-c7e0f512bfd3"></video>

## Installation / Setup

1. Abhaengigkeiten installieren:
```bash
npm install
```

2. Lokale Env-Datei anlegen:
```powershell
Copy-Item .env.example .env
```

3. `.env` konfigurieren (mindestens relevante DB/API-Werte fuellen).

## npm run Befehle

```bash
npm run dev
npm run build
npm run lint
npm run docs:guard
```

## Desktop Builds

Der Build erfolgt jeweils auf dem Zielbetriebssystem (electron-builder erkennt die
Plattform automatisch). Das native Modul `better-sqlite3` wird dabei fuer die
jeweilige Plattform neu kompiliert.

### Windows

```bash
npm run build
```

Erzeugt den NSIS-Installer (`CS-Investor-Hub-Setup-*.exe`) unter `release/`.

### Linux (AppImage + .deb)

```bash
npm run build:linux
```

Erzeugt unter `release/`:
- `CS-Investor-Hub-*.AppImage` — portabel, ohne Installation. Ausfuehrbar machen und starten:
  ```bash
  chmod +x release/CS-Investor-Hub-*.AppImage && ./release/CS-Investor-Hub-*.AppImage
  ```
  Auf Ubuntu 24.04 / Zorin OS 18 ggf. `sudo apt install libfuse2t64` (nur zum Ausfuehren, nicht zum Bauen).
- `CS-Investor-Hub-*.deb` — fuer Debian/Ubuntu-basierte Distros (inkl. Zorin OS 18):
  Installation via `sudo apt install ./release/CS-Investor-Hub-*.deb`.

**Kein System-PHP noetig (Windows & Linux):** Das PHP-Backend (Sidecar) wird als
statisch gelinkte Runtime mitgeliefert. Die Build-Scripts fuehren `npm run fetch:php`
aus, das ein fertiges statisches PHP-Binary (mit `curl`, `openssl`, `mbstring`,
`sqlite3`, `pdo_sqlite`) plus ein CA-Bundle (`cacert.pem`) von static-php.dev nach
`resources/php/<platform>/` laedt; electron-builder bettet es je Plattform via
`extraResources` in die App ein. Die Binaries sind bewusst nicht im Git
(siehe `.gitignore`) und werden bei jedem Build geholt.

Falls beim Start ein `better-sqlite3`-ABI-Fehler auftritt, die nativen Module gegen die
Electron-ABI neu bauen:

```bash
npm run rebuild:desktop-native
```

Ein eigenes Linux-Icon kann optional als `build/icon.png` (mind. 512x512) hinterlegt werden;
ohne diese Datei wird das Standard-Electron-Icon verwendet.

### CI

Der Workflow `.github/workflows/desktop-release.yml` baut bei einem `v*`-Tag automatisch
Windows- und Linux-Artefakte und haengt sie an das GitHub-Release.


## Screenshots
![Year Wrapped Intro (Dark)](docs/screenshots/desktop-dark/13-year-wrapped-01.png)
![Year Wrapped Kaeufe (Dark)](docs/screenshots/desktop-dark/13-year-wrapped-02.png)
![Year Wrapped Fazit (Dark)](docs/screenshots/desktop-dark/13-year-wrapped-10.png)
![Year Wrapped Intro (Light)](docs/screenshots/desktop-light/10-year-wrapped-01-light.png)
