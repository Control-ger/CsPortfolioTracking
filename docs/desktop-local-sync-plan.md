```markdown
# Desktop-local-first Sync Plan — Umsetzungsschritte für nächsten Agenten

Ziel: Desktop (Electron) als primärer, offline-fähiger Client mit lokaler Persistenz (SQLite) und robustem bidirektionalem Sync (push/pull) zum Server. Shared-Business‑Logic liegt in `packages/shared`. Web bleibt read-only bzw. optional PWA‑Cache.

Wichtig: Bei jeder strukturellen Änderung (Top-Level-Ordner, Datenmodell, Auth-Strategie) MUSS `AGENTS.md` im selben Commit aktualisiert werden.

Kurzüberblick (High Level)
- Phase 0: Design & API‑Contract
- Phase 1: Quick fallback (low-risk) — macht UI offline-fähig mit Cache
- Phase 2: Local persistence MVP (SQLite) für Desktop
- Phase 3: Sync Engine + Server sync endpoints (push/pull)
- Phase 4: Hardening (Verschlüsselung, Key‑Storage, Tests)
- Phase 5: Optional PWA‑offline (IndexedDB)

Akzeptanzkriterien (Definition of Done)
- Desktop speichert Portfolio/Watchlist/Inventory lokal und zeigt sie an ohne Server.
- Sync‑Engine kann Änderungen pushen/pullen, einfache Konflikte automatisch lösen, komplexe Konflikte markieren.
- Business‑Logic (Wertberechnung u.Ä.) liegt in `packages/shared` und ist per Unit‑Tests abgesichert.
- Server bietet `/api/v1/prices` und Sync‑endpoints `/api/v1/sync/pull` + `/api/v1/sync/push`.

Phase 0 — Design & Vertrag (1–2 Tage)
- Task 0.1: Erstelle `docs/sync-api.md` (OpenAPI minimal) — Push/Pull Schema.
- Task 0.2: Definiere SQLite Schema inkl. sync‑Metafeldern.
- Deliverables:
  - `docs/sync-api.md`
  - `docs/local-db-schema.md`

Phase 1 — Quick fallback (0.5–1 Tag) — unblocker
- Ziel: UI zeigt gecachte lokale Daten wenn API unreachable.
- Tasks:
  - `packages/shared/src/lib/localCache.js` implementieren (API: get/set/remove).
  - `packages/shared/src/lib/apiClient.js` erweitern: bei fetch‑Fehler fallback auf localCache.
  - Desktop: localCache über Preload/Electron filesystem (JSON) implementieren; Web: IndexedDB/localStorage.
- Verifikation:
  - Electron offline → UI zeigt Cache oder freundliche Offline‑Meldung.

Phase 2 — Local persistence MVP (3–7 Tage)
- Ziel: Desktop persistiert in SQLite; Renderer liest standardmäßig daraus.
- Tasks:
  - `apps/desktop/src/localStore/` (better-sqlite3 wrapper) erstellen: init, migrations, CRUD-APIs.
  - `apps/desktop/preload.js`: sichere IPC‑APIs exportieren (read/write/sync control).
  - `packages/shared/src/lib/logic.js`: deterministische Business‑Logic exportieren (Value calc, Formatter).
  - Renderer Hooks anpassen: bei Desktop lokale APIs nutzen (feature‑flag `useIsDesktopApp()`).
- Verifikation:
  - Erstelle Investition in Desktop UI → DB‑File enthält den Eintrag; Restart behält Daten.

Phase 3 — Sync Engine + Server endpoints (5–10 Tage)
- Ziel: Zuverlässiger bidirektionaler Sync (incremental) mit Konfliktbehandlung.
- Server (PHP) — Endpoints:
  - `GET  /api/v1/sync/pull?since=TIMESTAMP`
  - `POST /api/v1/sync/push`
  - `GET  /api/v1/prices/latest?symbols=...`
- Client (Desktop) — Sync Engine:
  - Background Worker (worker thread / child process) mit Queue, retry/backoff, batching.
  - operations_log in local DB für idempotente Änderungen.
  - Apply responses: applied | conflict | rejected.
- Conflict Strategy: LWW für einfache Felder; bei komplexen Konflikten markieren und UI zur Lösung anbieten.
- Verifikation:
  - Local change -> push -> server applies -> client pull confirms revision.
  - Simulierter Konflikt → Konfliktmarkierung sichtbar.

Phase 4 — Hardening, Encryption, Tests (3–7 Tage)
- Tasks:
  - Schlüsselmanagement: `keytar` für CSFloat API key / encryption key.
  - Encrypt sensitive fields in DB if required (AES‑GCM).
  - Unit Tests (Jest) für `packages/shared` logic.
  - Integration tests: mock server / sync roundtrip.
  - Observability: Telemetry events for sync errors/queue length.

Phase 5 — PWA offline (optional, 3–6 Tage)
- IndexedDB (Dexie) cache für Web read‑only fallback.
- ServiceWorker: stale‑while‑revalidate für prices.

Datenmodell / Sync‑Metadaten (empfohlen)
- Für jede Entität (investments, watchlist, inventory):
  - id TEXT PRIMARY KEY
  - user_id TEXT
  - payload domain fields
  - updated_at TEXT (ISO)
  - revision INTEGER DEFAULT 1
  - deleted INTEGER DEFAULT 0
  - conflict INTEGER DEFAULT 0
- Zusätzliche Tabellen:
  - operations_log(id, client_id, op_type, table_name, record_id, payload JSON, created_at, idempotency_key, applied_at)
  - sync_meta(key, last_sync_at)

Beispiel SQLite SQL (Minimal):
```sql
CREATE TABLE investments (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name TEXT,
  qty INTEGER,
  price_usd REAL,
  updated_at TEXT,
  revision INTEGER DEFAULT 1,
  deleted INTEGER DEFAULT 0,
  conflict INTEGER DEFAULT 0
);
CREATE TABLE operations_log (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  op_type TEXT,
  table_name TEXT,
  record_id TEXT,
  payload TEXT,
  created_at TEXT,
  idempotency_key TEXT,
  applied_at TEXT
);
CREATE TABLE sync_meta (key TEXT PRIMARY KEY, last_sync_at TEXT);
```

Sync‑Protokoll (kurz)
- Push: POST /api/v1/sync/push
  - Body: { clientId, changes: [{ op:'upsert'|'delete', table, id, payload, clientRevision, idempotencyKey, ts }] }
  - Response: per change { status:'applied'|'conflict'|'rejected', serverRevision, serverPayload }
- Pull: GET /api/v1/sync/pull?since=TIMESTAMP
  - Response: { changes: [{ table, id, op, payload, serverRevision, updatedAt }], serverTime }

Security‑Musspunkte
- Keine Secrets in `packages/shared` oder im Frontend‑Build.
- CSFloat API Key nur in main/background (Desktop) oder Server; niemals in renderer.
- TLS für alle Serverendpoints.
- `keytar` für OS‑Keyring; falls nicht verfügbar, AES‑GCM verschlüsselte Datei mit user passphrase.

Tests & CI
- Unit tests (Jest) für `packages/shared` logic.
- Integration tests: local SQLite + mock server for sync flows.
- NPM scripts: `test:unit`, `test:integration`.

Developer Checklist (konkret)
- Zu erstellen/zu ändern:
  - `packages/shared/src/lib/localCache.js` (phase1)
  - `packages/shared/src/lib/logic.js` (shared business logic)
  - `packages/shared/src/lib/apiClient.js` (fallback adaptions)
  - `apps/desktop/src/localStore/index.js` (SQLite wrapper)
  - `apps/desktop/preload.js` (IPC safe facade)
  - `apps/desktop/src/sync/engine.js` (sync background worker)
  - `backend/src/Http/Controller/SyncController.php` + SyncService
  - `docs/sync-api.md`, `docs/local-db-schema.md`

Quick Test Commands (PowerShell)
```powershell
# Start local backend via docker-compose
Copy-Item .env.example .env
# edit .env: set DB creds + VITE_API_BASE_URL (z.B. http://127.0.0.1:8080)
docker-compose up -d
docker-compose logs -f web

# Restart dev (Electron + Vite watch)
npm install
npm run dev

# Test API
Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8080/api/index.php/api/v1/portfolio/summary" -TimeoutSec 5
```

PR/Commit Guidance
- Branch: `feat/desktop-local-sync`
- Commit message template:
```
feat(desktop): add local persistence and sync prototype

- Add localCache fallback in apiClient
- Add localStore (SQLite) wrapper
- Add sync engine scaffold
- Move business logic into packages/shared/lib/logic.js
- Update AGENTS.md and docs/sync-api.md
```
- PR Checklist:
  - [ ] Unit tests for shared logic pass
  - [ ] Integration test for sync (or documented manual verification)
  - [ ] `AGENTS.md` updated in same commit if top-level changes

Rollout Empfehlung
- 1) Merge fallback + shared logic (unblock users)
- 2) Ship Desktop local persistence MVP to beta users
- 3) Roll out server endpoints and enable sync for opt‑in users
- 4) Full rollout + monitoring

Final Note für nächsten Agenten
- Halte Änderungen klein und iterativ. Starte mit Phase 1 (Quick fallback) um Offline‑Erlebnis sofort zu verbessern. Aktualisiere `AGENTS.md` bei jeder strukturellen Änderung.

---

Updated: 2026-04-30
Change: Desktop-local-first / Sync Roadmap (Agent‑Plan)

```

