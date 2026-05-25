# Architecture Overview (Central Reference)

Status: FINAL
Last updated: 2026-05-25

Use this file as the first architecture entrypoint, then jump into detail docs via the navigator table.

## 1. Scope

This document tracks:
- monorepo structure and runtime boundaries,
- data ownership rules,
- page lifecycle policy (preload/cache/refresh),
- health status of all active markdown docs.

## 2. Monorepo Structure (current)

- `apps/web/`
  - SPA bootstrap (`apps/web/src/main.jsx`, `apps/web/src/App.jsx`)
- `apps/desktop/`
  - Electron main/preload (`apps/desktop/main.js`, `apps/desktop/preload.js`)
  - local SQLite store (`apps/desktop/src/localStore/`)
- `packages/shared/`
  - shared UI, hooks, contexts, lib, pages
- `backend/`
  - server front controller: `backend/public/index.php`
  - desktop sidecar front controller: `backend/desktop/index.php`
  - ws gateway process: `backend/ws-gateway/server.mjs`
- `docs/`
  - architecture and implementation plans

### Compatibility artifacts currently present

- `backend/index.php` wraps `backend/public/index.php`.
- root `main.js` and root `preload.js` still exist, while active Electron entry is `apps/desktop/main.js`.
- `src.old/` exists as migration remainder.

## 3. Runtime Boundaries

### 3.1 Desktop runtime (primary write client)

- Starts local PHP sidecar on `127.0.0.1` with dynamic port + per-start secret.
- Renderer never reads SQLite directly.
- Renderer uses `window.electronAPI.localStore` for local persistence.
- Steam/CSFloat import triggers originate in desktop runtime; desktop may call sidecar/upstream endpoints for execution.
- Secrets stay local (Electron safe storage / process env only).

### 3.2 Web runtime

- Uses server APIs only.
- Must not receive desktop-local secrets.

### 3.3 Server runtime

- Owns sync API (`/api/v1/sync/pull`, `/api/v1/sync/push`).
- Owns pricing ingestion/read flows.
- Owns CS-updates ingest and web push.

### 3.4 WS gateway runtime

- Separate process under `backend/ws-gateway/`.
- Serves `/ws/updates` for CS updates realtime events.

## 4. Data Ownership Model

| Domain | Write owner | Storage | Read clients |
|---|---|---|---|
| Investments + watchlist | Desktop | local SQLite + synced server DB | Desktop + Web |
| Prices | Server workers | server DB | Web + Desktop (via sidecar/upstream) |
| Import execution (Steam/CSFloat) | Desktop-initiated | Desktop + server processing path | Desktop |
| Steam/CSFloat secrets | Desktop only | Electron safe storage | Desktop only |

## 5. Frontend Route Map (current)

From `apps/web/src/App.jsx`:
- `/` -> `PortfolioPage` (`initialTab=overview`)
- `/inventory` -> `PortfolioPage` (`initialTab=inventory`)
- `/watchlist` -> `PortfolioPage` (`initialTab=watchlist`)
- `/search` -> `PortfolioPage` (`initialTab=search`)
- `/cs-updates` -> `CsUpdatesPage`
- `/settings` -> `SettingsPage`

## 6. Page Lifecycle and Cache Policy

### 6.1 Verified current behavior

- `PortfolioPage` keeps visited tabs mounted (`visitedTabs` + `forceMount`).
- `usePortfolio` uses in-memory snapshots with TTL `120s`.
- `usePortfolio` initial API load is keyed by `cacheKey` (not by snapshot object identity) to prevent self-triggered fetch loops.
- `Watchlist` uses in-memory snapshots with TTL `120s`.
- `WatchlistOverview` uses in-memory snapshots with TTL `120s`.
- `useCsUpdatesFeed` uses in-memory snapshots with TTL `120s`.
- `GET /api/v1/portfolio/summary` uses enriched rows without live refresh (`allowLiveRefresh=false`) to avoid duplicate CSFloat load in the same page cycle.
- Interactive pricing requests apply a capped CSFloat lookup budget per request (`MAX_INTERACTIVE_CSFLOAT_LOOKUPS`), while CLI workers remain uncapped.
- `CsFloatClient::fetchLowestListingResult()` uses `GET /api/v1/listings/price-list` as primary bulk source (90s in-memory cache), with per-item listing lookup as fallback.
- Frontend stale handling calls `POST /api/v1/portfolio/prices/refresh-stale` (cooldown 120s) to refresh stale portfolio prices in background.
- Portfolio fetch path uses two backend requests (`investments`, `history`) and computes summary client-side from rows.
- CSFloat rate-limit handling uses a circuit-breaker file backoff and respects upstream `Retry-After` when present.

### 6.4 Hourly price write policy

- `backend/sync-prices.php` plans the hourly queue and processes the full planned kickoff batch by default (`PRICE_QUEUE_KICKOFF_BATCH` can override).
- `backend/sync-prices.php` runs a bulk CSFloat price-list import to upsert all items into `items`, `item_live_cache`, and `price_history_hourly`.
- `price_history_hourly` stores hourly USD snapshots as a regular InnoDB table (no partitioning) to stay compatible with MariaDB foreign-key limitations.
- With `price-list` as bulk source, hourly runs can update all tracked queue items without per-item external lookups in the common case.

### 6.2 CS updates feed behavior

- default query window: last `7` days,
- incremental history via `before` cursor,
- explicit UI action `Load older` for older entries.

### 6.3 Required rule for every new data-heavy page

1. Render fast from bounded cache.
2. Enforce TTL (default target `60-120s`).
3. Refresh in background after cached paint.
4. Invalidate cache after writes.
5. Avoid full data reset on internal tab/route switches.

## 7. Active Docs Navigator + Health

Health legend:
- `CURRENT`: aligned with repo state.
- `HISTORICAL`: keep for context, not implementation source.

| File | AGENTS status | Health | Notes |
|---|---|---|---|
| `docs/architecture-overview.md` | FINAL | CURRENT | Central architecture source. |
| `docs/local-db-schema.md` | FINAL | CURRENT | Updated to current local-store read path (no automatic server seeding). |
| `docs/sync-api.md` | IN PROGRESS | CURRENT | Pull/push contract aligns with current routes and flow. |
| `docs/archive/repo-restructure-plan.md` | HISTORICAL | HISTORICAL | Migration plan artifact. |
| `docs/desktop-local-sync-plan.md` | IN PROGRESS | CURRENT | Rewritten to current sidecar + safeStorage + sync engine reality. |
| `docs/server-scale-plan.md` | IN PROGRESS | CURRENT | Forward plan; still valid as target architecture. |
| `docs/fee-settings-plan.md` | IN PROGRESS | CURRENT | Matches versioned `user_fee_settings` + current API wiring. |
| `docs/cs-updates-feed-plan.md` | IN PROGRESS | CURRENT | Matches RSS primary + fallback enrichment + AI + ws + load-older UX. |
| `backend/MVC_API_CONTRACT.md` | FINAL | CURRENT | `/api/v1` contract aligned; includes known overpay-route mismatch note. |
| `backend/OBSERVABILITY_IMPLEMENTATION_PLAN.md` | IN PROGRESS | CURRENT | Rebased to actual implementation and remaining gaps. |
| `backend/STRANGLER_ROLLOUT.md` | IN PROGRESS | CURRENT | Rebased to real cutover status + residual cleanup tasks. |
| `docs/archive/MONOREPO_MIGRATION_STATUS.md` | HISTORICAL | HISTORICAL | Completion report, not live architecture source. |

## 8. Known Inconsistencies (current repo)

1. Overpay API mismatch:
- `packages/shared/src/lib/apiClient.js` contains `/api/v1/portfolio/investments/{id}/overpay`
- backend route is currently not registered in `backend/public/index.php`

2. Dead legacy helper:
- `packages/shared/src/hooks/ajax.jsx` still points to `/api/getPortfolioData.php`
- currently appears unused and should be removed or updated

3. Frontend telemetry runtime toggle:
- `packages/shared/src/lib/frontendTelemetry.js` currently hard-disables sending (`FRONTEND_TELEMETRY_ENABLED = false`)

## 9. Maintenance Rules

- If runtime boundaries or ownership change, update this file and `AGENTS.md` in the same commit.
- Run `npm run docs:guard` before push for global changes.
- Keep architecture content out of `README.md`.
- Do not add new architecture markdown files without AGENTS table entry.
