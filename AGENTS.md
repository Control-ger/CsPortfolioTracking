# AGENTS.md

Diese Datei ist die zentrale Einstiegshilfe fuer neue Copilot/AI-Sessions in diesem Repository.
Ziel: weniger Token fuer Wiederholung, schneller produktiv werden, konsistente Aenderungen.

## README.md — Schreibverbot für Agenten

README.md darf NUR enthalten:
- Installation / Setup
- npm run Befehle
- Screenshots
- Disclaimer

README.md darf NIEMALS enthalten:
- Architekturpläne
- Sync-Strategien
- DB-Schemas
- Phasen/Roadmaps
- Technische Entscheidungen

Verstöße dagegen sind aktiv rückgängig zu machen.

## Aktive Docs (einzige Quellen der Wahrheit)

| Datei | Status | Inhalt |
|---|---|---|
| `docs/local-db-schema.md` | FINAL | SQLite Schema |
| `docs/sync-api.md` | IN PROGRESS | Sync API Contract |
| `docs/repo-restructure-plan.md` | FINAL | Monorepo Struktur |
| `docs/desktop-local-sync-plan.md` | IN PROGRESS | Sync Roadmap |
| `docs/fee-settings-plan.md` | IN PROGRESS | Fee/Break-even Features |
| `docs/cs-updates-feed-plan.md` | IN PROGRESS | Updates/Feed Feature |
| `backend/MVC_API_CONTRACT.md` | FINAL | Backend API Contract |
| `backend/OBSERVABILITY_IMPLEMENTATION_PLAN.md` | IN PROGRESS | Observability Plan |
| `backend/STRANGLER_ROLLOUT.md` | IN PROGRESS | Backend Rollout Plan |
| `MONOREPO_MIGRATION_STATUS.md` | STATUS | Migrationsstatus |

**Regel:** Keine neue MD anlegen ohne Eintrag in dieser Tabelle.
Erledigte Phasen werden als DONE markiert — nicht gelöscht, nicht neu erstellt.

## Agent-Start (Kurzcheck)
1. Diese Datei (`AGENTS.md`) komplett lesen — sie ist die einzige Wahrheit.
2. Aktive Docs-Tabelle prüfen bevor neue MDs angelegt werden.
3. `README.md` nur für Setup/Install-Befehle konsultieren, nicht für Architektur.
4. Bei Backend-Änderungen zuerst `backend/public/index.php` und betroffene Services prüfen.
5. Nach strukturellen Änderungen diese Datei im selben Commit aktualisieren.

## Projektstruktur (Monorepo)

- Frontend Shared: `packages/shared/src/` (React Components, Hooks, Contexts, Utils)
- Web App: `apps/web/src/` (Entry Point + Web-specific code)
- Desktop App: `apps/desktop/` (Electron main.js, preload.js + Desktop-specific code)
- Backend Entry: `backend/public/index.php`
- Desktop Sidecar Entry: `backend/desktop/index.php`
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

## Server-Zuständigkeiten

- Server ist zuständig für: Web-read-only Ansicht von Investments, Preisdaten (Cronjob holt stündlich CSFloat-Preise), Sync-Endpunkte.
- Investments importieren (CSFloat API / Steam API) passiert ausschließlich lokal im Desktop — nie auf dem Server.
- Der CSFloat API Key bleibt lokal — er kommt nie auf den Server und nie in den Web-Build.
- Web/PWA fragt Preise beim Server ab, nicht direkt bei CSFloat.
- Desktop bezieht Preise über den lokalen PHP-Sidecar; dieser nutzt die serverseitige Preislogik bzw. die Backend-Preisdaten.
- 
### Drei Datenschichten

| Schicht | Speicherort | Wer schreibt | Wer liest |
|---|---|---|---|
| Investments | SQLite lokal + Server-DB (via Sync) | nur Desktop (Server empfängt nur) | Desktop + Web |
| Preise | Server-DB | nur Server/Cronjob | Desktop (via Sidecar) + Web |
| CSFloat/Steam Import | nur lokal | nur Desktop | nur Desktop |

## Desktop Local-first Leitlinien

- Desktop ist primaerer Schreib-Client fuer Investments und Watchlist.
- SQLite liegt im Electron `userData` Pfad (`cs-investor-hub.sqlite`).
- Renderer greift nie direkt auf SQLite zu, sondern ueber `window.electronAPI.localStore`.
- Shared Runtime Reads laufen ueber `packages/shared/src/lib/dataSource.js`; dieser Layer waehlt ausschliesslich die Laufzeit/Base-URL und portiert keine Business-Logik.
- Lokale Schreibaktionen muessen `operations_log` fuellen, damit spaeterer Sync idempotent pushen kann.
- Der lokale PHP-Sidecar ist fuer die Electron Desktop-App keine optionale Uebergangsschicht, sondern die permanente Produktionsarchitektur.
- Electron startet beim App-Launch automatisch den lokalen PHP-Prozess; er bindet nur an `127.0.0.1`, nutzt einen dynamischen Port und wird pro Start mit einem Secret abgesichert.
- Electron startet `backend/desktop/index.php` als lokalen Sidecar-Entry; dieser darf keine Server-MySQL-Pflicht beim Start haben.
- `backend/public/index.php` bleibt der Server/API-Frontcontroller fuer Web, Sync und spaetere Server-Funktionen.
- Die fachliche PHP-Logik bleibt in `backend/src` und wird von beiden Clients genutzt; es gibt keinen Rewrite dieser Logik nach JavaScript oder Node.js.
- SQLite ist ausschliesslich fuer lokale Persistenz zustaendig und enthaelt keine Business-Logik.
- Lokale API-Secrets wie der CSFloat API Key werden ueber Electron `safeStorage` im OS-verschluesselten Speicher abgelegt; nicht in `.env`, nicht in SQLite und nicht auf dem Server.

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
- `usePortfolio` liest ueber `dataSource.js` im Desktop local-first aus SQLite

---

Updated: 2026-05-02
Change: **Steam OpenID Auth + Auth-First Architecture**

### Auth-First Datenfluss

```
1. App startet → Kein User → Zeigt Steam Login Button (kein API-Call!)
                        ↓
2. User loggt sich ein → CS2 Inventar laden → Als Investments importieren
                        ↓
3. User vorhanden → Lokale Daten anzeigen (optional Server-Sync)
```

**Vorteile:**
- Kein "Failed to fetch" Fehler beim ersten Start
- Klare UX: "Login erforderlich" statt leerer Daten
- Keine leeren API-Calls ohne User

### Implementierte Komponenten

**Backend (PHP):**
- `SteamAuthController` - OpenID 2.0 Login/Callback
- `AuthStateRepository` - CSRF-State-Token-Management (5min TTL)
- AES-256-GCM Session-Verschlüsselung (30 Tage)
- CS2 Inventar-Abfrage via Steam Web API

**Frontend (Shared):**
- `packages/shared/src/lib/auth.js` - Auth-Service
- `packages/shared/src/lib/dataSource.js` - Auth-First Datenlogik
- `isAuthRequired()`, `getCurrentUser()`, `fetchCS2Inventory()`

### Verbindliche Architekturregel

- Der lokale PHP-Sidecar ist die dauerhafte Produktionsarchitektur der Electron Desktop-App.
- `packages/shared/src/lib/dataSource.js` entscheidet nur zwischen Laufzeitquellen/Base-URL; fachliche Logik bleibt in PHP.
- Eine Migration von PHP-Business-Logik nach JavaScript oder Node.js ist explizit ausgeschlossen.
- SQLite bleibt reine Persistenzschicht fuer den Desktop-Client.

**Sicherheitsmaßnahmen:**
- CSRF-State-Tokens (64-byte random, 5min expiry)
- HTTPS-Enforcement in Produktion
- OpenID Response Verification mit Steam
- Session-Verschlüsselung mit AES-256-GCM
- Auth-State-Tabelle mit automatischem Cleanup

---

Updated: 2026-05-04
Change: **React Error #310 behoben - Doppelte Dateien entfernt**
- Problem: Alte `src/` Struktur mit 57 JSX-Dateien existierte parallel zu `packages/shared/src/`
- Ursache: Monorepo-Migration hinterließ alte Dateien, führte zu Modul-Auflösungs-Konflikten
- Lösung: Alte `src/` zu `src.old` verschoben
- Vite Config synchronisiert: `apps/web/vite.config.js` erhielt React Deduplication wie Root-Config
- Build erfolgreich, Devtools-Probleme sollten behoben sein

---

Updated: 2026-05-04
Change: Desktop PHP-Sidecar vom Server-Frontcontroller getrennt
- Neuer Desktop-Sidecar-Entry: `backend/desktop/index.php`
- Electron startet den Sidecar lokal auf `127.0.0.1` mit dynamischem Port
- Desktop-Sidecar stellt Steam Auth, Steam Inventory und CSFloat Preview ohne MySQL-Bootstrap bereit
- Server-Frontcontroller `backend/public/index.php` bleibt fuer Web/Server/Sync zustaendig
- Lokale Desktop-Persistenz bleibt SQLite ueber `apps/desktop/src/localStore/`

---

Updated: 2026-05-04
Change: Desktop Secret Storage festgelegt
- CSFloat API Key wird lokal ueber Electron `safeStorage` gespeichert.
- Der Key wird dem lokalen PHP-Sidecar nur zur Laufzeit als Prozess-Environment bereitgestellt.
- `.env`, SQLite, Server-DB und Web-Build duerfen keine lokalen CSFloat API Keys enthalten.
