# Architecture Overview (Central Reference)

Status: FINAL
Last updated: 2026-06-03

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
- Sidecar secret is mandatory for desktop renderer/API traffic; only `GET /api/v1/auth/steam/callback` is public to allow the external Steam OpenID browser redirect.
- Renderer never reads SQLite directly.
- Renderer uses `window.electronAPI.localStore` for local persistence.
- Steam/CSFloat import triggers originate in desktop runtime; desktop may call sidecar/upstream endpoints for execution.
- Desktop sidecar exposes CSFloat import endpoints and a desktop-local buyorder read endpoint (`GET /api/v1/csfloat/buy-orders`) for watchlist enrichment.
- Desktop sidecar exposes SkinBaron preview endpoints (`POST /api/v1/portfolio/sync/skinbaron/preview`) for desktop-local import.
- Secrets stay local (Electron safe storage / process env only).
- SkinBaron import currently uses only Session-Cookie (`AUTHID`) in Electron safe storage for purchases import data.
- Legacy SkinBaron API-key capability code remains archived in Electron main process, but is not exposed in the current renderer/settings UX.
- Desktop runtime enforces an app-password-gated Secret Vault: secrets are decrypted only after unlock in Electron main-memory, always locked on restart, with optional auto-lock after 15 minutes idle (user opt-in).

### 3.2 Web runtime

- Uses server APIs only.
- Must not receive desktop-local secrets.

### 3.3 Server runtime

- Owns sync API (`/api/v1/sync/pull`, `/api/v1/sync/push`).
- Owns pricing ingestion/read flows.
- Owns CS-updates ingest and web push.
- Owns user currency preference persistence (`GET/PUT /api/v1/settings/currency`) and anonymized aggregate popularity stats (`currency_usage_stats`).
- Owns portfolio group preference persistence (`GET/PUT /api/v1/settings/portfolio-groups`) for cross-runtime group availability.
- Enforces `items` catalog ownership: only the CLI price-catalog cron path may mutate `items`; request/interactive sync flows are read-only against `items`.

### 3.4 WS gateway runtime

- Separate process under `backend/ws-gateway/`.
- Serves `/ws/updates` for CS updates realtime events.

## 4. Data Ownership Model

| Domain | Write owner | Storage | Read clients |
|---|---|---|---|
| Investments + watchlist | Desktop | local SQLite + synced server DB | Desktop + Web |
| Prices | Server workers | server DB | Web + Desktop (via sidecar/upstream) |
| Import execution (Steam/CSFloat) | Desktop-initiated | Desktop + server processing path | Desktop |
| Steam/CSFloat secrets | Desktop only | Local Secret Vault (app-password wrapped, main-memory unlock session) | Desktop only |

## 5. Frontend Route Map (current)

From `apps/web/src/App.jsx`:
- `/` -> `PortfolioPage` (`initialTab=overview`)
- `/inventory` -> `PortfolioPage` (`initialTab=inventory`)
- `/watchlist` -> `PortfolioPage` (`initialTab=watchlist`)
- `/search` -> `PortfolioPage` (`initialTab=search`)
- `/cs-updates` -> `CsUpdatesPage`
- `/settings` -> `SettingsPage`
- Electron/Desktop uses a shared app-level rail shell (`DesktopSidebarRail`) so cross-route navigation does not remount page-local sidebars.
- The same shared app-level rail shell is used consistently across runtime paths so sidebar active-state/layout does not diverge between Dashboard, Settings, and Updates.

## 6. Page Lifecycle and Cache Policy

### 6.1 Verified current behavior

- `PortfolioPage` keeps visited tabs mounted (`visitedTabs` + `forceMount`).
- In Electron, the desktop rail sidebar is mounted once in `App.jsx`; pages can opt out of local sidebar shells via `useExternalDesktopSidebarShell`.
- Frontend color gradients must use the shared avatar-derived Steam palette variables (`--steam-shell-color-a` ... `--steam-shell-color-d`), with static values allowed only as fallback when avatar data is unavailable.
- `usePortfolio` uses in-memory snapshots with TTL `120s`.
- `usePortfolio` initial API load is keyed by `cacheKey` (not by snapshot object identity) to prevent self-triggered fetch loops.
- `Watchlist` uses in-memory snapshots with TTL `120s`.
- Watchlist candidate search is DB-first (`items` catalog), with Steam market lookup only as fallback when local search returns zero matches.
- Item-type filter `other` includes rows with missing/empty `item_type`/`type`, so legacy catalog entries are not silently dropped.
- Watchlist Buyorder enrichment is cache-backed and only refreshed during explicit CSFloat sync execution (not on every watchlist view load).
- If no local CSFloat buyorder cache snapshot exists, desktop watchlist triggers one live fetch and persists the snapshot; subsequent reads stay cache-first.
- If CSFloat `buy-orders` returns a temporary upstream failure such as 429/500/503, the desktop sidecar falls back to the trades endpoint before reporting no buyorders.
- Desktop watchlist detail renders Buyorders directly item-scoped under the price-history panel (mini table: price/orders/quantity) instead of a global buyorder summary card.
- Desktop watchlist detail exposes a compact debug line (client source, upstream source, pages fetched, raw rows, summary rows, cache/error indicators plus first upstream error code/status) to diagnose CSFloat buyorder mismatches quickly.
- If desktop sidecar proxy returns a `syncLive` fallback payload without upstream metrics/history, desktop watchlist performs one follow-up upstream read with `syncLive=false` to preserve visible price history/change metrics.
- `WatchlistOverview` uses in-memory snapshots with TTL `120s`.
- `useCsUpdatesFeed` uses in-memory snapshots with TTL `120s`.
- Web runtime app shell uses a fixed viewport container (`h-[100dvh]`) and a flex-constrained `<main>` scroll area (`flex-1 min-h-0 overflow-y-auto`) to avoid mobile scroll-lock regressions.
- `PortfolioPage` no longer uses horizontal swipe tab switching on mobile; tab changes are explicit to avoid accidental gesture-triggered navigation.
- Desktop supports SkinBaron import preview/execute flow in Management; import writes locally and then re-runs Steam-vs-external matching so duplicates can be auto-resolved like the existing CSFloat flow.
- SkinBaron desktop preview now uses `GET https://skinbaron.de/api/v2/Purchases` (session-authenticated), filters to `SUCCEEDED` purchase groups, flattens `purchaseItems`, and builds stable external trade ids per purchase item.
- Settings in desktop runtime provide only a SkinBaron browser-connect/session-cookie flow that opens a login window, captures `AUTHID` from Electron cookies, and stores it encrypted for Purchases import.
- SkinBaron desktop browser-connect and Purchases web requests now consistently use `/en/profile/purchases` referer + `Accept-Language: en-US` to avoid accidental German-localized import payloads.
- `CurrencyContext` persists selected display currency server-side via settings API and still keeps local fallback in `localStorage`.
- Currency popularity ranking in Settings is sourced from anonymized server aggregates (no user identifiers in `currency_usage_stats`).
- Portfolio groups are loaded from server settings with local fallback; existing local-only groups are auto-migrated to server when the remote payload is empty.
- Desktop sidecar upstream proxy now tries additional `index.php` + `?route=` candidate patterns and classifies Cloudflare Access login HTML as access denial hints instead of route-not-found noise.
- Search-to-watchlist add checks in `PortfolioPage`/`ItemSearch` use watchlist entries only (not inventory/investment presence), so web runtime can add watchlist items independently.
- `ItemSearch` mobile controls use larger touch targets (>=44px) for pagination/actions to improve finger usability.
- Electron app updates are user-confirmed: update checks can report availability, but downloads start only after explicit user action (`Jetzt updaten`), not automatically in background.
- Electron updater download requests self-heal missing in-memory update metadata by running `checkForUpdates()` before prompting download, and return structured failure reasons to renderer/UI when download cannot start.
- Update notifications are dual-path in desktop runtime: native OS toast (when supported) plus persisted in-app system notifications (`category=app_update`) for reliable visibility.
- Desktop app runtime is globally gated by Secret Vault status in `App.jsx`: while locked/not configured, shared routes are blocked by an unlock/setup screen and sensitive IPC paths (`backend-base-url`, local-store IPC, secret mutations) stay denied.
- The Secret Vault setup/unlock screen now embeds welcome/onboarding context inside the same `steam-startup-shell`, using avatar-derived Steam palette variables (`--steam-shell-color-a` ... `--steam-shell-color-d`) with fallback colors.
- `GET /api/v1/portfolio/summary` uses enriched rows without live refresh (`allowLiveRefresh=false`) to avoid duplicate CSFloat load in the same page cycle.
- Interactive pricing requests apply a capped CSFloat lookup budget per request (`MAX_INTERACTIVE_CSFLOAT_LOOKUPS`), while CLI workers remain uncapped.
- `CsFloatClient::fetchLowestListingResult()` uses `GET /api/v1/listings/price-list` as primary bulk source (90s in-memory cache), with per-item listing lookup as fallback.
- Search observability includes `domain.watchlist.search.*` events and a debug aggregation endpoint `GET /api/v1/debug/watchlist-search-stats` (server + desktop sidecar proxy).
- Frontend stale handling calls `POST /api/v1/portfolio/prices/refresh-stale` (cooldown 120s) to refresh stale portfolio prices in background.
- Portfolio fetch path uses two backend requests (`investments`, `history`) and computes summary client-side from rows.
- Desktop portfolio/dashboard hydrates first from local SQLite investments + local snapshots, but that local-only payload is not written into the 120s view cache; the follow-up live refresh waits for desktop sync before reading upstream pricing/history.
- Overview composition uses the dedicated composition data path so local-first rows without live CSFloat fields do not collapse the donut chart to an empty visualization.
- Non-overview dashboard tabs (`inventory`, `watchlist`, `search`) and sync modals are lazy-loaded so their UI code does not block the initial overview bundle.
- Ancillary portfolio side-loads (management rows, group settings, search watchlist preload, watchlist movers) are deferred until the related tab or overlay is active; overview mover data is idle-scheduled but still performs a live watchlist sync with a read-only fallback.
- Desktop auto Steam inventory sync is deferred until the first portfolio load has finished and then scheduled during browser idle, so it no longer competes with the initial dashboard paint.
- For `metricsScope=all`, frontend normalizes history/KPI fallback inputs against the active summary values when the newest history snapshot diverges significantly, so `Gesamt Zuwachs` and chart stay scope-consistent.
- CSFloat rate-limit handling uses a circuit-breaker file backoff and respects upstream `Retry-After` when present.

### 6.4 Hourly price write policy

- `backend/sync-prices.php` plans the hourly queue and processes the full planned kickoff batch by default (`PRICE_QUEUE_KICKOFF_BATCH` can override).
- `backend/sync-prices.php` runs a bulk CSFloat price-list import to upsert all items into `items`, `item_live_cache`, and `price_history_hourly`.
- `backend/sync-prices.php` is the only write-enabled process for `items` and sets `ITEMS_CATALOG_WRITE_SCOPE=cron` explicitly before catalog upserts.
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
