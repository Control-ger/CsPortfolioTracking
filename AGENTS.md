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
| `docs/architecture-overview.md` | FINAL | Zentrale Architektur + Doc-Navigator |
| `docs/local-db-schema.md` | FINAL | SQLite Schema |
| `docs/sync-api.md` | IN PROGRESS | Sync API Contract |
| `docs/archive/repo-restructure-plan.md` | HISTORICAL | Monorepo Struktur (Archiv) |
| `docs/desktop-local-sync-plan.md` | IN PROGRESS | Sync Roadmap |
| `docs/server-scale-plan.md` | IN PROGRESS | Server scaling architecture + migration plan |
| `docs/fee-settings-plan.md` | IN PROGRESS | Fee/Break-even Features |
| `docs/cs-updates-feed-plan.md` | IN PROGRESS | Updates/Feed Feature |
| `backend/MVC_API_CONTRACT.md` | FINAL | Backend API Contract |
| `backend/OBSERVABILITY_IMPLEMENTATION_PLAN.md` | IN PROGRESS | Observability Plan |
| `backend/STRANGLER_ROLLOUT.md` | IN PROGRESS | Backend Rollout Plan |
| `docs/archive/MONOREPO_MIGRATION_STATUS.md` | HISTORICAL | Migrationsstatus (Archiv) |

**Regel:** Keine neue MD anlegen ohne Eintrag in dieser Tabelle.
Erledigte Phasen werden als DONE markiert — nicht gelöscht, nicht neu erstellt.

## Agent-Start (Kurzcheck)
1. Diese Datei (`AGENTS.md`) komplett lesen — sie ist die einzige Wahrheit.
2. `docs/architecture-overview.md` lesen (zentrale Architekturreferenz).
3. Aktive Docs-Tabelle prüfen bevor neue MDs angelegt werden.
4. Detaildokus nur ueber den Doc-Navigator in `docs/architecture-overview.md` aufrufen.
5. `README.md` nur für Setup/Install-Befehle konsultieren, nicht für Architektur.
6. Bei Backend-Änderungen zuerst `backend/public/index.php` und betroffene Services prüfen.
7. Nach strukturellen Änderungen diese Datei im selben Commit aktualisieren.

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

## Frontend Visual-Regel (verbindlich)

- Alle produktiven Color-Gradients (Shells, Sidebar, Hero/Welcome, Panels mit Brand-Farbverlauf) muessen auf der avatarbasierten Steam-Palette beruhen.
- Quelle der Palette ist die bestehende Welcome-Logik in `packages/shared/src/components/SteamLoginPrompt.jsx` (`deriveSteamPaletteFromUser`, inkl. Komplementaerfarbe aus `complementaryHsl`).
- Rendering erfolgt ausschliesslich ueber die CSS-Variablen `--steam-shell-color-a`, `--steam-shell-color-b`, `--steam-shell-color-c`, `--steam-shell-color-d`.
- Harte, statische Ersatz-Gradients sind nur als Fallback erlaubt, wenn keine Avatardaten verfuegbar sind.

## Backend Leitlinien

- Multi-User Scope: Service- und Repository-Methoden sollen `userId` sauber propagieren.
- Persistenz waehrung: USD wird gespeichert, EUR zur Laufzeit berechnet.
- Item-Referenzen: `item_id` statt string-basierter Item-Namen fuer Verknuepfungen.
- History-Tabellen: keine vorab berechneten Aggregatfelder persistieren, Werte im Service berechnen.
- Exchange Rates: `exchange_rate_id` statt redundanter `exchange_rate`/`price_eur` Spalten.

## Server-Zuständigkeiten

- Server ist zuständig für: Web-read-only Ansicht von Investments, Preisdaten (Cronjob holt stündlich CSFloat-Preise), Sync-Endpunkte.
- Investments werden fuer Web-Tracking serverseitig persistiert, aber der primaere Schreib-/Import-Trigger bleibt Desktop.
- CSFloat/Steam Import-Flows duerfen vom Desktop ueber Sidecar/Server-Endpunkte orchestriert werden; sie sind kein direkter Web-Client-Flow.
- Der CSFloat API Key bleibt lokal — er kommt nie auf den Server und nie in den Web-Build.
- Web/PWA fragt Preise beim Server ab, nicht direkt bei CSFloat.
- Desktop bezieht Preise über den lokalen PHP-Sidecar; dieser nutzt die serverseitige Preislogik bzw. die Backend-Preisdaten.
- 
### Drei Datenschichten

| Schicht | Speicherort | Wer schreibt | Wer liest |
|---|---|---|---|
| Investments | SQLite lokal + Server-DB (via Sync) | nur Desktop (Server empfängt nur) | Desktop + Web |
| Preise | Server-DB | nur Server/Cronjob | Desktop (via Sidecar) + Web |
| CSFloat/Steam Import-Trigger | Desktop-initiiert (lokal + via Sidecar/Server-Endpoint) | Desktop (primaer) / Server (verarbeitend) | Desktop |

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
- Lokale API-Secrets wie CSFloat/SkinBaron werden im app-passwortgeschuetzten Secret Vault gespeichert; Entschluesselung nur im Electron Main Process nach Unlock (Auto-Lock nach Inaktivitaet). Keine Ablage in `.env`, SQLite oder Server.

## User/Auth Richtung

- `users` ist Steam-orientiert (`steam_id`, `steam_name`, `steam_avatar`, `last_login_at`).
- Default-User wird aktuell ueber `UserRepository::ensureDefaultUser()` abgesichert.
- Steam OpenID Login/Callback + Session-Validierung ist implementiert; weiterer Ausbaupunkt bleibt die Haertung/Produktiv-Session-Strategie.

## Aenderungs-Workflow fuer Agents

Bei folgenden Aenderungen MUSS diese Datei angepasst werden:

- neue Top-Level Ordner/Umstrukturierung
- neue zentrale Backend-Komponenten (Service/Repository/Controller-Boundaries)
- neue verpflichtende Datenmodell-Regeln
- geaenderte Auth- oder Session-Strategie

Empfohlenes Update-Format am Dateiende:

- `Updated: YYYY-MM-DD`
- `Change: <kurze Beschreibung>`

## Dokumentations-Governance (verbindlich)

Globale/architekturelle Aenderungen muessen im selben Commit dokumentiert werden.

Als global gelten insbesondere:
- Aenderungen an zentralen Runtime-Boundaries (`backend/public/index.php`, `backend/desktop/index.php`, `apps/desktop/main.js`, `apps/desktop/preload.js`, `packages/shared/src/lib/dataSource.js`)
- neue/geaenderte zentrale Service-/Repository-/Controller-Boundaries im Backend
- neue oder umstrukturierte Top-Level-Struktur
- neue oder verschobene zentrale Markdown-Dokumente

Pflicht bei globalen Aenderungen:
- `AGENTS.md` aktualisieren
- `docs/architecture-overview.md` aktualisieren
- neue/verschobene `.md`-Dateien in der Active-Docs-Tabelle registrieren (oder als HISTORICAL/Archiv markieren)

Automatischer Guard:
- Lokal vor Push: `npm run docs:guard`
- CI erzwingt dieselbe Regel ueber `.github/workflows/docs-governance.yml`

## Release-Regel (verbindlich)

Wenn der User "release" sagt, ist damit ein echter Electron-Release gemeint, nicht nur ein Git-Push.

Pflichtablauf:
- Fachliche Aenderungen zuerst in logischen Einzel-Commits mit klaren, beschreibenden Commit-Messages committen.
- Vor dem eigentlichen Release muss der Arbeitsbaum sauber sein (keine uncommitteten fachlichen Aenderungen).
- `package.json` Version erhoehen (und `package-lock.json` mitziehen).
- Separaten Release-Commit nur fuer den Version-Bump erstellen (z. B. `release: v0.1.55`).
- Git-Tag `v<version>` erstellen (muss exakt zur `package.json` Version passen).
- Branch + Tag pushen.
- Sicherstellen, dass der Workflow `.github/workflows/desktop-release.yml` dadurch triggert (Tag `v*`).

Ohne neuen Tag gibt es keinen neuen Electron/GitHub-Release.

## Commit-Message-Regel (verbindlich)

- Commit-Messages muessen immer den inhaltlichen Aenderungsgrund enthalten.
- Reine Platzhalter wie `release: vX.Y.Z` ohne Kontext sind nicht erlaubt.
- Release-Commits sollen neben der Version kurz die wichtigsten Aenderungen nennen.
  - Beispiel: `release: v0.1.54 (dashboard watchlist movers + pie chart sonstige <1%)`
- Ausnahme: Der dedizierte Release-Commit fuer den reinen Version-Bump darf nur die Versionsangabe tragen (z. B. `release: v0.1.55`),
  sofern die fachlichen Aenderungen bereits vorher in logischen Commits mit Inhalt dokumentiert wurden.

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

---

Updated: 2026-05-05
Change: Lokale Steam-Sync-Verwaltung und Notification-Persistenz erweitert
- Neue lokale Tabelle `sync_notifications` fuer persistente Sync-Benachrichtigungen mit Read-Status (`read_at`).
- Steam-Sync-Notifications sind restart-fest und koennen einzeln oder gesammelt als gelesen markiert werden.
- Auto-Sync ist lokal durch Cooldown begrenzt und bleibt manuell triggerbar.
- Fehlertexte fuer Steam-Import wurden fuer typische Ursachen (Inventory access denied, Rate Limit, invalid response, Netzwerk) konkretisiert.
- Journey/Onboarding zeigt klaren Schrittfortschritt fuer Steam, Import, CSFloat-Key und Matching-Status.

---

Updated: 2026-05-05
Change: Server Sync Push/Pull produktiv angebunden
- Neuer Backend-Service `SyncService` implementiert (`backend/src/Application/Service/SyncService.php`).
- Neuer HTTP-Controller `SyncController` implementiert (`backend/src/Http/Controller/SyncController.php`).
- Neue API-Routen registriert: `GET /api/v1/sync/pull`, `POST /api/v1/sync/push`.
- Serverseitige Idempotency fuer Push-Changes ueber `sync_idempotency` eingefuehrt.
- Konfliktbehandlung fuer aeltere `clientRevision` auf Change-Ebene eingefuehrt.

---

Updated: 2026-05-07
Change: Queue-basierte Preis-Historie mit Prioritaeten fuer Server-Cron erweitert
- Neuer Service `PriceRefreshQueueService` (`backend/src/Application/Service/PriceRefreshQueueService.php`) plant stündliche Queue-Slots fuer alle `items`.
- Prioritaetsstufen: Investments (P1) vor Watchlist (P2) vor Katalog-Rest (P3).
- Neuer Worker-Entry `backend/sync-price-queue-worker.php` verarbeitet due-Items in kleinen Batches mit Backoff bei Rate-Limits.
- `price_history.date` wurde auf `DATETIME` umgestellt, damit stündliche Buckets pro Item persistiert werden koennen.
- Supervisor-Konfiguration erweitert um `csportfolio-price-queue-worker` (alle 3 Minuten).

---

Updated: 2026-05-11
Change: Investment/Inventar-Bucket als verbindliche Datenmodell-Regel eingefuehrt
- Jede lokale/gesyncte Position fuehrt `bucket` (`investment` | `inventory`) im Payload.
- KPI-Scope ist standardmaessig `investments_only`; optional `toggle_mode` oder `always_all` ueber Portfolio-Preferences.
- Import-Defaults sind quellbasiert konfigurierbar (Steam/CSFloat) und werden in Desktop-Preferences gespeichert.

---

Updated: 2026-05-14
Change: CS Updates Feed Architektur auf SteamDB-RSS + Realtime vorbereitet
- Neue Backend-Komponenten: `CsUpdatesIngestService`, `CsUpdatesFeedRepository`, `CsUpdatesController`.
- Neuer Worker-Entry: `backend/sync-cs-updates-rss.php` fuer minuetlichen RSS-Ingest in `cs_updates_feed`.
- Neue REST-Route: `GET /api/v1/cs-updates` in Server-Frontcontroller und Desktop-Sidecar-Proxy.
- Neues Gateway-Verzeichnis `backend/ws-gateway/` fuer separaten WebSocket-Prozess (`/ws/updates`).

---

Updated: 2026-05-14
Change: CS Updates Ingest auf Steam News API umgestellt
- Externer Feed-Client nutzt jetzt `ISteamNews/GetNewsForApp` fuer `appid=730` als Primärquelle.
- Grund: SteamDB-RSS liefert in Container-Laufzeiten teils `HTTP 403` und ist dadurch nicht stabil genug als alleinige Produktionsquelle.

---

Updated: 2026-05-18
Change: Preisquellen-Praeferenz + getrennte Live-Quotes pro Source
- Neue zentrale Repository-Komponente: `backend/src/Infrastructure/Persistence/Repository/UserPriceSourcePreferenceRepository.php`.
- Datenmodell-Regel erweitert: `item_live_cache` speichert jetzt getrennte Quotes je `item_id + price_source` (mind. `csfloat`/`steam`), nicht mehr eine einzelne ueberschriebene Zeile pro Item.
- Pricing-Flow in `backend/src/Application/Service/PricingService.php` nutzt User-Praeferenz (`auto`/`csfloat`/`steam`) fuer Source-Selection und vermeidet Source-Mischung durch Fallback-Ueberschreiben.

---

Updated: 2026-05-22
Change: Web Push fuer CS-Updates + SteamDB RSS Ingest-Latenz reduziert
- Neue zentrale Backend-Komponenten:
  - `backend/src/Http/Controller/WebPushController.php` (Public-Key + Subscribe/Unsubscribe API)
  - `backend/src/Infrastructure/Persistence/Repository/WebPushSubscriptionRepository.php` (Persistenz fuer Browser-Subscriptions)
  - `backend/src/Application/Service/WebPushService.php` (VAPID-Signierung + Push-Dispatch)
- `backend/src/Application/Service/CsUpdatesIngestService.php` nutzt SteamDB Patchnotes RSS primaer und sendet Web Push bei neuen Feed-Eintraegen.
- Supervisor-Konfiguration erweitert um `csportfolio-cs-updates-ingest` (alle 30s), damit CS-Update-Ingest nahezu in Echtzeit laeuft.

---

Updated: 2026-05-22
Change: CS-Updates Feed Enrichment fuer bessere KI-Bewertungen
- Neue Backend-Komponente: `backend/src/Infrastructure/External/SteamDbPatchnotesClient.php` (best-effort Nachladen und Text-Extraktion von SteamDB-Patchnotes-Links).
- `backend/src/Application/Service/CsUpdatesIngestService.php` reichert SteamDB-RSS-Eintraege jetzt mit Steam-News-Inhalten (Build/Title-Matching) und optionalem Patchnotes-Link-Fetch an.
- Neue ENV-Optionen fuer Ingest-Enrichment:
  - `CS_UPDATES_ENRICH_MAX_PER_RUN` (Default 3)
  - `CS_UPDATES_SUMMARY_MAX_LENGTH` (Default 1600)

---

Updated: 2026-05-22
Change: Asynchrones KI-Rating fuer CS-Updates (Gemini Free Tier vorbereitet)
- Neue zentrale Backend-Komponenten:
  - `backend/src/Infrastructure/External/GeminiUpdateRaterClient.php` (Gemini API Client fuer strukturierte Impact-Bewertung)
  - `backend/src/Application/Service/CsUpdatesAiRatingService.php` (batchweises Nachziehen von Ratings fuer pending Feed-Eintraege)
  - `backend/sync-cs-updates-ai-rating.php` (separater Worker-Entry)
- `backend/src/Infrastructure/Persistence/Repository/CsUpdatesFeedRepository.php` erweitert `cs_updates_feed` um AI-Rating-Spalten und Pending-Queue-Methoden.
- `backend/src/Http/Controller/CsUpdatesController.php` liefert AI-Rating-Felder (`aiImpactLevel`, `aiUrgency`, `aiRecommendedAction`, etc.) an Web/Desktop aus.
- Supervisor-Konfiguration erweitert um `csportfolio-cs-updates-ai-rating` (alle 60s), damit Eilmeldung sofort bleibt und Bewertung asynchron nachgereicht wird.

---

Updated: 2026-05-23
Change: Verbindliche Release-Regel fuer Agents ergaenzt
- "Release" bedeutet explizit Electron-Release mit Version-Bump, Tag `v<version>` und Push von Branch + Tag.
- Klarstellung aufgenommen, dass ohne neuen Tag kein GitHub/Electron-Release erzeugt wird.

---

Updated: 2026-05-23
Change: Zentrale Architekturreferenz eingefuehrt
- Neue zentrale Datei `docs/architecture-overview.md` als Architekturreferenz + Doc-Navigator hinzugefuegt.
- `AGENTS.md` Agent-Start aktualisiert: verpflichtender Verweis auf `docs/architecture-overview.md`.
- Active-Docs-Tabelle um die zentrale Architekturdatei erweitert.

---

Updated: 2026-05-23
Change: Historische Dokus in Archiv verschoben
- `docs/repo-restructure-plan.md` wurde nach `docs/archive/repo-restructure-plan.md` verschoben.
- `MONOREPO_MIGRATION_STATUS.md` wurde nach `docs/archive/MONOREPO_MIGRATION_STATUS.md` verschoben.
- Referenzen in `AGENTS.md` und `docs/architecture-overview.md` auf Archivpfade umgestellt.

---

Updated: 2026-05-23
Change: Dokumentations-Governance + Auto-Guard eingefuehrt
- Verbindliche Governance-Regeln fuer globale/architekturelle Aenderungen ergaenzt.
- Pflicht: Bei globalen Aenderungen immer `AGENTS.md` + `docs/architecture-overview.md` im selben Commit aktualisieren.
- Neuer Guard-Check `npm run docs:guard` ueber `scripts/docs-guard.mjs`.
- Neuer CI-Workflow `.github/workflows/docs-governance.yml` validiert die Regeln automatisch.

---

Updated: 2026-05-23
Change: Review-Findings eingearbeitet (Security + Konsistenz)
- Desktop-Sidecar erzwingt jetzt `X-Desktop-Sidecar-Secret` gegen `DESKTOP_SIDECAR_SECRET` in `backend/desktop/index.php`.
- Electron Main fuegt Sidecar-Header fuer lokale Requests hinzu und nutzt ihn auch beim Health-Check.
- Sidecar-Proxy fuer `GET /api/v1/cs-updates` reicht `since` jetzt korrekt durch.
- Architekturdoku auf Live-Tracking-Modell praezisiert: Investments bleiben server-synchronisiert fuer Web-Tracking, Import-Trigger bleiben desktop-initiiert.

---

Updated: 2026-05-24
Change: CSFloat 429-Entlastung im Portfolio-Read-Path
- `PortfolioController::summary` nutzt `PortfolioService::getEnrichedInvestments(..., allowLiveRefresh=false)` und triggert damit keine zusaetzlichen Live-CSFloat-Requests.
- `PricingService` nutzt fuer HTTP 429 ein deutlich laengeres Backoff (Basis 10min) und respektiert zusaetzlich `Retry-After` falls geliefert.
- `PricingService` begrenzt interaktive CSFloat-Lookups pro Request (`MAX_INTERACTIVE_CSFLOAT_LOOKUPS`) und laesst CLI-Worker unbegrenzt.
- Aktive Circuit-Breaker-Warnungen werden pro Request nur einmal gezaehlt statt pro Item erneut hochgezaehlt.

---

Updated: 2026-05-24
Change: CSFloat Bulk-Preisquelle ueber `price-list` aktiviert
- `CsFloatClient::fetchLowestListingResult` nutzt primaer `GET /api/v1/listings/price-list`.
- Antwort wird 90 Sekunden in-memory gecached (pro Runtime-Request/Worker-Durchlauf), um wiederholte Netzwerkanfragen zu vermeiden.
- Fallback auf den bisherigen per-item `listings` Lookup bleibt aktiv, falls ein Item nicht in der Price-List vorhanden ist.

---

Updated: 2026-05-24
Change: Bulk-Import der CSFloat price-list + partitionierte price_history_hourly
- Neuer Service `PriceListBulkImportService` und hourly Bulk-Import in `backend/sync-prices.php`
- `PriceHistoryRepository` nutzt `price_history_hourly` mit monatlicher Partitionierung
- Bulk-Upserts fuer `items` und `item_live_cache` hinzugefuegt

---

Updated: 2026-05-25
Change: MariaDB-Kompatibilitaet fuer `price_history_hourly` korrigiert
- Partitionierung in `PriceHistoryRepository` entfernt, da MariaDB partitionierte Tabellen mit Foreign Keys nicht unterstuetzt (Error 1506).
- `price_history_hourly` bleibt als normale InnoDB-Tabelle mit Foreign Keys auf `items` und `exchange_rates`.

---

Updated: 2026-05-25
Change: Portfolio-Request-Loop im Frontend gestoppt
- `usePortfolio` triggert den Initial-Load jetzt pro `cacheKey` statt indirekt ueber Snapshot-Objektwechsel.
- `fetchApiPortfolioData` reduziert Requests auf `investments` + `history`; Summary wird aus Rows clientseitig berechnet.

---

Updated: 2026-05-25
Change: App-weite Desktop-Sidebar-Shell vereinheitlicht
- Desktop-Sidebar-Rail wurde als gemeinsame Komponente auf App-Ebene zentralisiert (`apps/web/src/App.jsx`, `packages/shared/src/components/DesktopSidebarRail.jsx`).
- `PortfolioPage`, `SettingsPage` und `CsUpdatesPage` koennen ihre lokale Sidebar-Shell ueber `useExternalDesktopSidebarShell` deaktivieren.
- Ergebnis: Beim Wechsel zwischen Dashboard/Watchlist/CS-Updates/Einstellungen bleibt die Sidebar stabil gemountet und wird nicht pro Route neu aufgebaut.

---

Updated: 2026-05-25
Change: Sidebar-Shell fuer alle Runtime-Pfade vereinheitlicht
- Die gemeinsame Rail-Shell in `apps/web/src/App.jsx` gilt jetzt einheitlich fuer Desktop und Web statt nur fuer den Electron-Zweig.
- Dadurch sind Sidebar-Verhalten und Active-State zwischen Dashboard, Einstellungen und Updates in allen Runtimes konsistent.

---

Updated: 2026-05-25
Change: Electron-Update-Flow auf manuelles Download-Opt-in umgestellt
- `apps/desktop/main.js`: `autoUpdater.autoDownload=false` und `autoInstallOnAppQuit=false`.
- Bei `update-available` wird eine native Electron-Notification angezeigt; Klick oeffnet Dialog mit `Jetzt updaten` / `Spaeter`.
- Download startet nur nach expliziter User-Bestaetigung (`app-updater-download`), danach bleibt Installation weiterhin manuell ueber `app-updater-install`.
- `apps/desktop/preload.js` erweitert um `updater.download()`, UI-Hinweistext in `PortfolioPage` entsprechend angepasst.

---

Updated: 2026-05-25
Change: Verbindliche Commit-Message-Regel ergaenzt
- Commit-Messages muessen die inhaltlichen Aenderungen nennen (auch bei Releases).
- Reine Versions-Release-Titel ohne Aenderungskontext sind nicht mehr erlaubt.

---

Updated: 2026-05-26
Change: Release-Ablauf auf "logische Commits zuerst, separater Versions-Release danach" umgestellt
- Vor einem Release muessen fachliche Aenderungen bereits in eigenen, inhaltlich benannten Commits vorliegen.
- Der eigentliche Release-Commit darf als dedizierter Version-Bump nur die Versionsangabe tragen (z. B. `release: v0.1.55`).

---

Updated: 2026-05-26
Change: CSFloat Buyorders fuer Watchlist + Desktop-Sidecar Endpoint erweitert
- Neuer Desktop-Sidecar Read-Endpoint `GET /api/v1/csfloat/buy-orders` in `backend/desktop/index.php` (lokaler CSFloat-Key bleibt im Desktop-Runtime-Kontext).
- `DesktopCsFloatController` erweitert um Buyorder-Aggregation (Best-Preis + Anzahl je `marketHashName`) mit Fallback auf Trades, falls Buyorder-Endpoint upstream nicht verfuegbar ist.
- Watchlist zeigt Buyorder-Badges und eine Buyorder-Uebersicht; der Refresh passiert nur im CSFloat-Sync-Flow, nicht bei jedem Watchlist-Load.

---

Updated: 2026-05-26
Change: Electron Update-Benachrichtigungen gehaertet
- Native System-Toast fuer `update-available` bleibt aktiv; Fehler beim Anzeigen werden explizit geloggt.
- Zusaetzliche persistente Desktop-System-Notifications (`category=app_update`) fuer `update-available` und `update-downloaded` im lokalen Notification-Store, damit Updates auch ohne OS-Toast im Bell-Menue sichtbar bleiben.

---

Updated: 2026-05-26
Change: Mobile Web UX gehaertet (Scroll + Swipe + Header)
- `apps/web/src/App.jsx`: Web-App-Shell nutzt jetzt eine feste Viewport-Hoehe (`100dvh`) plus explizite `flex`-Layout-Constraint um den `<main>`-Scroller, damit Mobile-Scroll stabil bleibt.
- `packages/shared/src/pages/PortfolioPage.jsx`: Horizontaler Swipe-Tabwechsel auf Mobile entfernt, um Fehl-Trigger bei normalen Scroll-Gesten zu vermeiden.
- `packages/shared/src/pages/PortfolioPage.jsx`: Mobile Header zeigt kein irrefuehrendes "Cash"-Label mehr.

---

Updated: 2026-05-26
Change: Watchlist-Suche auf lokalen Katalog priorisiert + Suchmetriken
- `PricingService::searchWatchlistCandidates()` nutzt DB-first Suche (lokaler `items`-Katalog) und faellt nur bei 0 lokalen Treffern auf Steam-Suche zurueck.
- `ItemRepository` und `WatchlistService` behandeln Filter/Browse fuer `other` jetzt inkl. Legacy-Datensaetzen mit leerem `item_type/type`.
- Neuer Debug-Endpunkt `GET /api/v1/debug/watchlist-search-stats` ist serverseitig registriert und im Desktop-Sidecar als Upstream-Proxy verfuegbar.
- Relevance-Sortierung in `ItemRepository::searchCatalog()` nutzt token-basiertes Scoring mit korrekter SQL-Placeholder-Reihenfolge.

---

Updated: 2026-05-27
Change: Watchlist-Buyorder-Fallback + Web-Watchlist-Add + mobile Search-Touch-Targets
- `packages/shared/src/lib/dataSource.js`: Desktop-Watchlist triggert bei fehlendem Buyorder-Cache-Snapshot einmalig einen Live-Fetch und cached danach wieder cache-first.
- `packages/shared/src/pages/PortfolioPage.jsx`: Search-Tab nutzt fuer "bereits in Watchlist" nur echte Watchlist-Items, damit Web-User Items auch dann zur Watchlist hinzufuegen koennen, wenn sie bereits im Inventar/Portfolio sind.
- `packages/shared/src/components/ItemSearch.jsx`: mobile Pagination/Actions/Filter mit groesseren Touch-Zielen fuer bessere Bedienbarkeit auf dem Handy.

---

Updated: 2026-05-27
Change: Updater-Flow gehaertet + Watchlist-Metrik-Fallback stabilisiert
- `apps/desktop/main.js`: IPC `app-updater-download` fuehrt bei fehlendem `latestAvailableUpdateInfo` jetzt zuerst `checkForUpdates()` aus und liefert strukturierte Fehlergruende (`no-update-info`, `not-packaged`, `error`) statt still zu scheitern.
- `packages/shared/src/lib/dataSource.js`: Desktop-Watchlist erkennt Sidecar-Proxy-Fallbacks bei `syncLive=true` und faellt fuer Read-Metriken einmalig auf `syncLive=false` zurueck, damit bestehende Preishistorie/Preisveraenderungen sichtbar bleiben.

---

Updated: 2026-05-28
Change: Verbindliche Avatar-Palette-Regel fuer alle Color-Gradients
- Produktive Frontend-Gradients muessen die avatarbasierte Steam-Palette (`--steam-shell-color-a` bis `--steam-shell-color-d`) verwenden.
- Die Palette bleibt zentral ueber `deriveSteamPaletteFromUser` in `packages/shared/src/components/SteamLoginPrompt.jsx` definiert (inkl. Komplementaerfarbe).

---

Updated: 2026-05-28
Change: SkinBaron Desktop-Import + Capability-Checks ergaenzt
- Electron Main speichert SkinBaron API Keys lokal via `safeStorage` (analog zu CSFloat) und fuehrt beim Speichern einen Capability-Probe-Check fuer Read-Rechte aus.
- Desktop-Sidecar erweitert um `POST /api/v1/portfolio/sync/skinbaron/preview` (plus `execute`-Stub) sowie Key-Statusroute `GET /api/v1/settings/skinbaron-api-key`.
- Management-Flow in der Desktop-App bietet jetzt einen SkinBaron-Sync-Dialog (Preview/Import) analog zum CSFloat-Sync.
- Steam-Matching beruecksichtigt neben CSFloat auch SkinBaron-importierte Positionen fuer automatische Zuordnung.

---

Updated: 2026-05-29
Change: Serverseitige Currency-Preference + anonymisierte Popularitaets-Stats ergaenzt
- Neue zentrale Repository-Komponente: `backend/src/Infrastructure/Persistence/Repository/UserCurrencyPreferenceRepository.php`.
- Neue API-Routen fuer User-Waehrung: `GET /api/v1/settings/currency`, `PUT /api/v1/settings/currency` (Server + Desktop-Sidecar-Proxy/Fallback).
- Persistenzregel: `user_currency_preferences` speichert pro User nur die aktuelle Anzeige-Waehrung; aggregierte Beliebtheit in `currency_usage_stats` bleibt anonym ohne User-IDs.
- Frontend `CurrencyContext` persistiert die Waehrungswahl serverseitig und nutzt anonyme Popular-Codes fuer sortierte Anzeige im Settings-UI.

---

Updated: 2026-05-29
Change: SkinBaron Preview-Abdeckung fuer GetSales-States erweitert
- `DesktopSkinBaronController` laedt fuer die Preview jetzt `GetSales` ueber alle dokumentierten `type`-States (`1..7`) statt implizit nur Teilmengen.
- Responses werden pro `saleId` dedupliziert (bevorzugt neuere `last_updated`/`list_time` Datensaetze), damit die Preview keine state-uebergreifenden Doppelzeilen zeigt.

---

Updated: 2026-05-29
Change: SkinBaron Import auf Purchases + Session-Cookie umgestellt
- Electron Main speichert zusaetzlich einen SkinBaron Session-Cookie (AUTHID) lokal verschluesselt via `safeStorage` und prueft beim Speichern den Zugriff auf `https://skinbaron.de/api/v2/Purchases`.
- Desktop-Sidecar/Backend nutzen fuer den SkinBaron-Preview jetzt den Purchases-Endpoint (statt `GetSales`) und flatten `purchaseGroups[*].purchaseItems[*]` zu importierbaren Einzelzeilen.
- Preview filtert auf `state=SUCCEEDED`, erzeugt stabile `externalTradeId`s pro Purchase-Item und liefert damit die erwartete Vollstaendigkeit fuer Kauf-Historie.
- Desktop-Settings zeigen Import-Readiness ueber Session-Cookie separat vom optionalen SkinBaron API-Key an.

---

Updated: 2026-05-31
Change: Secret Vault mit App-Passwort + globalem Desktop-Unlock-Guard eingefuehrt
- `apps/desktop/main.js` verwaltet jetzt einen lokalen Secret Vault (app-passwortgeschuetzt) und entschluesselt Secrets nur im Main-Process-RAM.
- Auto-Sperre ist als User-Opt-in konfigurierbar; Standard bleibt "Unlock bei App-Start/Neustart erforderlich".
- `apps/desktop/preload.js` exponiert neue Vault-IPC-Methoden (`getVaultStatus`, `setVaultPassword`, `unlockVault`, `lockVault`, `touchVaultActivity`).
- `apps/web/src/App.jsx` blockiert Desktop-Routen global, solange der Vault nicht eingerichtet/entsperrt ist, und zeigt Setup/Unlock-UI.
- Sensitive Desktop-IPC-Pfade (`backend-base-url`, `backend-auth-headers`, `local-store-*`, Secret-Mutationen) sind bei gesperrtem Vault technisch blockiert.

---

Updated: 2026-05-31
Change: Welcome-Kontext in den Secret-Vault Einstieg integriert
- Die geschuetzte Unlock/Setup-Ansicht in `apps/web/src/App.jsx` zeigt jetzt zusaetzlich Welcome-/Onboarding-Kontext (Steam-Login-Hinweise), ohne die Guard-Reihenfolge zu aendern.
- Technisch bleibt der Vault-Guard vor dem Route-Mount aktiv, sodass Auth-/Portfolio-Flows weiterhin erst nach erfolgreichem Unlock starten.

---

Updated: 2026-05-31
Change: SkinBaron Session-Cookie Auto-Connect per Login-Fenster
- `apps/desktop/main.js` erweitert um einen Browser-Login-Flow, der `AUTHID` direkt aus den SkinBaron-Cookies liest und als verschluesselten Session-Cookie speichert (inkl. Purchases-Probe).
- Neuer Desktop-IPC `secret-skinbaron-session-connect-browser` fuer automatischen Session-Connect statt manuellem Cookie-Copy.
- `apps/desktop/preload.js` und `packages/shared/src/pages/SettingsPage.jsx` binden den Flow als "Mit SkinBaron verbinden"-Aktion in den Settings ein.

---

Updated: 2026-05-31
Change: Steam OpenID Callback ohne Sidecar-Secret freigegeben (nur Callback-Route)
- `backend/desktop/index.php` erzwingt den Header `X-Desktop-Sidecar-Secret` weiterhin fuer alle lokalen API-Calls aus dem Renderer.
- Ausnahme ist ausschliesslich `GET /api/v1/auth/steam/callback`, damit der externe Steam-Browser-Redirect den Login im lokalen Sidecar erfolgreich abschliessen kann.
- Hintergrund: Externe Browser-Redirects koennen keinen app-internen Sidecar-Secret-Header mitsenden.
