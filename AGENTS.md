# AGENTS.md

Diese Datei ist die zentrale Einstiegshilfe fuer neue Copilot/AI-Sessions in diesem Repository.
Ziel: weniger Token fuer Wiederholung, schneller produktiv werden, konsistente Aenderungen.

## Agent-Start (Kurzcheck)

1. `README.md` lesen (Setup + API-Basis).
2. Diese Datei komplett lesen.
3. Bei Backend-Aenderungen zuerst `backend/public/index.php` und die betroffenen Services/Repositories pruefen.
4. Nach strukturellen Aenderungen diese Datei im selben Commit aktualisieren.

## Projektstruktur (Monorepo)

- Frontend Shared: `packages/shared/src/` (React Components, Hooks, Contexts, Utils)
- Web App: `apps/web/src/` (Entry Point + Web-specific code)
- Desktop App: `apps/desktop/` (Electron main.js, preload.js + Desktop-specific code)
- Backend Entry: `backend/public/index.php`
- Backend App-Layer: `backend/src/Application/`
- Backend HTTP Layer: `backend/src/Http/`
- Backend Persistence: `backend/src/Infrastructure/Persistence/Repository/`
- Observability: `backend/src/Observability/`
- Doku/Pläne: `docs/`

### Frontend Monorepo Details

**packages/shared/src/**
- `components/` — wiederverwendbare UI-Komponenten
- `hooks/` — React Hooks (usePortfolio, etc.)
- `contexts/` — React Context APIs
- `lib/` — Utilities (apiClient, formatters, validators)
- `pages/` — geteilte Seiten (ohne Desktop-spezifisk Logik)
- `types/` — gemeinsame Typen

**apps/web/src/**
- Web-spezifische Entry-Points
- PWA-Manifest
- Service Worker

**apps/desktop/**
- `main.js` — Electron main process
- `preload.js` — Electron preload bridge
- `src/localStore/` — SQLite local-first Persistenz (nur Main Process)
- Desktop-spezifische IPC-handler

## Backend Leitlinien

- Multi-User Scope: Service- und Repository-Methoden sollen `userId` sauber propagieren.
- Persistenz waehrung: USD wird gespeichert, EUR zur Laufzeit berechnet.
- Item-Referenzen: `item_id` statt string-basierter Item-Namen fuer Verknuepfungen.
- History-Tabellen: keine vorab berechneten Aggregatfelder persistieren, Werte im Service berechnen.
- Exchange Rates: `exchange_rate_id` statt redundanter `exchange_rate`/`price_eur` Spalten.

## Desktop Local-first Leitlinien

- Desktop ist primaerer Schreib-Client fuer Investments und Watchlist.
- SQLite liegt im Electron `userData` Pfad (`cs-investor-hub.sqlite`).
- Renderer greift nie direkt auf SQLite zu, sondern ueber `window.electronAPI.localStore`.
- Shared Runtime Reads laufen ueber `packages/shared/src/lib/dataSource.js`.
- Lokale Schreibaktionen muessen `operations_log` fuellen, damit spaeterer Sync idempotent pushen kann.
- Server ist langfristig fuer Preisdaten sowie User-/Investment-Sync zustaendig, nicht fuer primaere Desktop-UI-Persistenz.

## User/Auth Richtung

- `users` ist Steam-orientiert (`steam_id`, `steam_name`, `steam_avatar`, `last_login_at`).
- Default-User wird aktuell ueber `UserRepository::ensureDefaultUser()` abgesichert.
- Eine vollstaendige Steam OpenID Login/Callback Session-Implementierung ist als naechster Ausbaupunkt vorgesehen.

## Aenderungs-Workflow fuer Agents

Bei folgenden Aenderungen MUSS diese Datei angepasst werden:

- neue Top-Level Ordner/Umstrukturierung
- neue zentrale Backend-Komponenten (Service/Repository/Controller-Boundaries)
- neue verpflichtende Datenmodell-Regeln
- geaenderte Auth- oder Session-Strategie

Empfohlenes Update-Format am Dateiende:

- `Updated: YYYY-MM-DD`
- `Change: <kurze Beschreibung>`

## Bekannte offene Punkte

- `toggleExcludeInvestment` in `backend/src/Application/Service/PortfolioService.php` ist aktuell defensiv/placeholder.
- Bootstrap/DI in `backend/public/index.php` sollte konsequent auf die final migrierten Repository-Dependencies ausgerichtet bleiben.

Updated: 2026-04-30
Change: Initiale Agent-Dokumentation angelegt.

---

Updated: 2026-04-30 (18:30 UTC)
Change: **Monorepo-Umstrukturierung: Phase 1 & 2 abgeschlossen**
- Workspaces konfiguriert (apps/{web,desktop}, packages/shared)
- npm install erfolgreich
- Shared-Code in packages/shared/src/ organisiert
- Web-Entrypoints in apps/web/src/ kopiert
- Electron-Code in apps/desktop/ kopiert
- Barrel-Exports für Shared-Module erstellt
- vite.config.js, tailwind.config.js, jsconfig.json aktualisiert
- Next: Phase 3 (Import-Pfade + Bootstrap anpassen)

---

Updated: 2026-04-30
Change: Desktop local-first SQLite Boundary begonnen
- `apps/desktop/src/localStore/` als Main-Process SQLite Store angelegt
- Renderer-Zugriff nur ueber preload IPC `window.electronAPI.localStore`
- Lokale Tabellen fuer Investments, Watchlist, Preise, Snapshots und operations_log dokumentiert
- `usePortfolio` liest ueber `dataSource.js` im Desktop local-first aus SQLite und seedet bei leerer DB einmal aus dem Backend

