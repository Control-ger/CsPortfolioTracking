# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Quickstart
1. Read `docs/architecture-overview.md` first — it is the central architecture reference.
2. Keep architecture/plans out of `README.md` (setup/screenshots only).
3. Before push: run `npm run docs:guard`.

## Commands
```bash
npm run dev           # Vite build watch + Electron
npm run build         # clean + fetch:php + vite build + electron-builder (current OS)
npm run build:linux   # clean + fetch:php + vite build + electron-builder --linux (AppImage + .deb)
npm run fetch:php     # download bundled static PHP runtime + CA bundle → resources/php/<platform>/
npm run lint          # ESLint 9 flat config (JS/JSX only)
npm run docs:guard    # Documentation governance check
npm run preview       # Vite preview
```
No test suite is configured (Playwright exists as devDep but no `test` script).

## Project Structure (Monorepo — npm workspaces)
| Package | Path | Description |
|---|---|---|
| Root | `.` | Electron build config, shared tooling |
| Shared | `packages/shared/src/` | React components, hooks, contexts, lib, pages |
| Web App | `apps/web/src/` | SPA/PWA entry (`main.jsx`, `App.jsx`) |
| Desktop | `apps/desktop/` | Electron `main.js`, `preload.js`, SQLite localStore |
| Backend | `backend/` | PHP — two front controllers + shared `src/` |

**Two PHP entry points:**
- `backend/public/index.php` — Server front controller (Web, Sync, public API). Calls `ensureTable()` for all repositories at startup; new repositories must be added here. Schema migration failures are caught and logged so they don't take down all routes.
- `backend/desktop/index.php` — Desktop Sidecar (local 127.0.0.1, no MySQL required)

**Sync push ownership:** `SyncService` owns `sync_entities`/`sync_idempotency` (revision + idempotency); domain projection into `items`/`investments`/`watchlist` (and their DDL `ensure*Table()`) belongs to `SyncEntityService`, invoked via `applyDomainChange`. `SyncService::push` must call the `ensure*Table()` helpers on `$this->syncEntityService`, not `$this`. Desktop sync/login calls the server via `/api/index.php/api/v1/...` (bare `/api/v1/...` 404s at the edge); `buildSyncEndpointCandidates` (desktopSync.js) tries the `/api/index.php` form first.

**PHP autoloader** (`backend/src/bootstrap.php`): PSR-4-like, maps `App\` → `backend/src/`.
No Composer. No framework (custom Router, DI, Logger).

**Import aliases** (configured in all `vite.config.js` + `jsconfig.json`):
- `@shared/*` → `packages/shared/src/*`
- `@/*` → `packages/shared/src/*` (same target!)

## Critical Rules

### README.md Governance
`README.md` MUST only contain: install/setup, `npm run` commands, screenshots, disclaimer.
NEVER: architecture plans, sync strategies, DB schemas, roadmaps, technical decisions.

### Frontend Visual Rule
All color gradients (shells, sidebar, hero, panels) MUST use the avatar-derived Steam palette:
- Source: `packages/shared/src/components/SteamLoginPrompt.jsx` (`deriveSteamPaletteFromUser`)
- CSS variables: `--steam-shell-color-a` through `--steam-shell-color-d`
- Static fallback gradients only when avatar data is unavailable.

### Backend Data Rules
- **Currency**: USD persisted, EUR computed at runtime.
- **Item references**: always `item_id`, never string-based names.
- **History tables**: no precomputed aggregates; values computed in Services.
- **Exchange rates**: reference `exchange_rate_id`, never redundant `price_eur` columns.
- **Items catalog**: `items` table is server-owned, read-only for all except CLI cron `backend/sync-prices.php` (requires `ITEMS_CATALOG_WRITE_SCOPE=cron`).
- **No PHP→JS migration**: PHP business logic stays in `backend/src`; `packages/shared/src/lib/dataSource.js` only selects runtime/URL, never implements logic.

### Desktop Local-First
- Desktop is the primary write client for investments and watchlist.
- SQLite at Electron `userData` path (`cs-investor-hub.sqlite`), accessed only via `window.electronAPI.localStore` (IPC, never direct from renderer).
- Local writes must fill `operations_log` for idempotent sync push.
- Sync push (`pushPendingOperations`, `desktopSync.js`) processes the **oldest 200** pending ops per run. Ops that can never be claimed by any account — payload user scope missing or purely numeric (desktop scopes are always `steam-<steamId>`; legacy `"1"` is migrated on access) — and ops with unmappable entity types are **retired** (marked applied) instead of skipped, then the next window is fetched immediately. Skipping them silently would let a block of ≥200 unclaimable ops permanently occupy the push window and stall all sync pushes (observed with stale scope-`"4"` ops).
- CSFloat trade import (`executeCsFloatTradeSync`) keeps stable identity on re-import: when an existing investment matches (by id, external trade id, or legacy cluster id), the upsert reuses `existing.id`/`existing.externalTradeId` and preserves the user-chosen `bucket`; only genuinely new rows get the `csfloatImportBucket` default. New ids on re-import would orphan portfolio-group `memberInvestmentIds` and duplicate positions. After import, Steam↔CSFloat matching is refreshed (like the SkinBaron path) so duplicates auto-resolve.
- Server item resolution during sync (`SyncEntityService::resolveItemIdForSync`) is a pure relational chain — **`item_id` (FK to `items`) → `market_hash_name` (item natural key, UNIQUE) → error**. A valid payload `itemId` is trusted as-is; otherwise the item is resolved by `market_hash_name` via `resolveExistingItemId` (find-by-natural-key or **throw** — never create, since the catalog is server-owned/read-only on this path). **Image URL is an attribute, never a key**: there is no image-based resolution. A previous fuzzy Steam-image-token `LIKE` fallback, a later exact-image-URL fallback, and a "canonicalize a valid itemId by image" redirect all cross-linked distinct skins sharing long image-token prefixes (observed: a Dreams & Nightmares Case position bound to a Stiletto knife `item_id`); all were removed.
- Sync pull import (`investments`/`watchlist_items`) treats `server_id` as the canonical identity: before upserting a pulled row it hard-deletes any other local row holding the same `server_id` (different `id`), so the `UNIQUE(server_id)` constraint can't abort the pull when the server re-emits a fresh local id for an existing server row.
- Steam↔external matching covers **CSFloat and SkinBaron** rows as candidates (platform/id-prefix filter in `syncSteamInventory`); match rows live in `steam_csfloat_matches` regardless of the external platform. Resolution depends on the external row's quantity: **unit rows** (qty 1, e.g. skins) are excluded and their buy price is copied onto the price-less Steam row; **quantity rows** (qty > 1, e.g. patch packs/cases) are the ledger side — they can match up to `quantity` Steam pieces (capacity-counted pairing) and on resolve the STEAM piece is excluded (with the unit price copied for reference), never the quantity position itself.
- SkinBaron purchase prices arrive in **EUR** (`price` field; the AdditionalCurrency=USD automation only affects SkinBaron's secondary display currency, not the purchases payload). The desktop sidecar preview converts EUR→USD via `ExchangeRateClient` before returning `buyPriceUsd`; the purchase-item external-trade-id fingerprint stays on the raw EUR price so ids remain stable across exchange-rate changes.
- Portfolio investments API rows expose `clientId` (the desktop-local entity id from the sync payload) and name-aggregated rows expose index-aligned `sourceInvestmentIds`/`sourceClientIds`, because portfolio-group `memberInvestmentIds` may reference either id namespace (desktop-created groups → local ids, web-created → server ids). Group resolution (`portfolioGroups.js`) and the grouped-member row filter (`InventoryTable`) match across all id aliases.
- Watchlist view uses a 60-minute module snapshot (`packages/shared/src/lib/watchlistViewSnapshot.js`) with stale-while-revalidate painting; PortfolioPage prefetches it during idle after the initial dashboard load, and CSFloat auto-imports run fire-and-forget (mutation bus triggers the refresh when they add items). View loads and prefetch read **cache-only from the server** (`syncLive=false`) — the homeserver is the single source of truth for prices (cron-owned); the `syncLive=true` per-item live path (server→CSFloat + 200ms sleep/item) is reserved for explicit sync actions.
- Steam↔CSFloat match scoring persists a `score_breakdown` (per-signal points + measured deviations) on `steam_csfloat_matches`; `listSteamCsfloatMatches` backfills it for pre-existing matches (incl. confirmed/auto-linked) without altering status/score/confidence.
- Desktop sidecar settings writes degrade gracefully: `PUT /api/v1/settings/portfolio-groups` returns a `desktop-local-fallback` success instead of `502` when all upstream candidates fail, since the renderer already persisted locally and the GET handler auto-migrates to the server once reachable.
- All desktop sidecar **write** proxies (PUT/POST) use the shared `$proxyUpstreamSend` helper, which mirrors the GET proxy's insecure-TLS retry on certificate/connect errors. The host system PHP (Windows) frequently lacks a curl CA bundle → HTTPS verification fails with curl code `0`; without the retry every write silently failed and was swallowed as a local fallback (root cause of portfolio groups never syncing to the server). Never reintroduce a raw `curl` write in the sidecar without this TLS fallback.
- CSFloat `me/buy-orders` is requested with `limit≤50` + `order=desc` (larger sizes 500, unlike `me/trades`); the buy-orders pagination loop checks against that 50 cap, not the raw request limit. The trades fallback fires only on real upstream failures (429/500/503), never on a successful-but-empty result; the original buy-orders error is kept in response meta as `buyOrdersError` for diagnostics.
- CSFloat watchlist import (`GET /api/v1/csfloat/watchlist` → `me/watchlist`, limit≤40) is **add-only**: dedupe by name against the local watchlist, add new items via `createWatchlistItemsBatchData` (never delete). Opt-in via `csfloatWatchlistAutoImport` portfolio pref (stored as `"true"`/`"false"` string — coerce on read, never `Boolean()`); auto-runs per watchlist load with a 60s cooldown and only force-syncs when new names are found.
- CSFloat buy order import (`importCsFloatBuyOrdersAsWatchlistData`, `dataSource.js`): same add-only pattern as watchlist import, sourced from `summaryByMarketHashName` of the existing buy orders endpoint. Opt-in via `csfloatBuyOrderAutoImport` portfolio pref; 60 s cooldown. Both watchlist and buy order auto-imports run in parallel via `Promise.allSettled` at the start of each watchlist load.
- Both CSFloat imports resolve candidate names against the server item catalog via the watchlist **search** endpoint (`resolveWatchlistCandidatesFromCatalog` in `dataSource.js`) before adding. Rationale: desktop must not invent catalog items, and server sync **throws** (`resolveExistingItemId` is find-by-natural-key-or-throw, never create) on a watchlist change whose name is not in `items`. Only exact catalog matches are added — carrying the canonical `marketHashName` (so server sync resolves `item_id` by name → price/history) and the catalog `iconUrl` (image shown immediately). Names the catalog rejects are skipped (reported as `notInCatalog`); if search itself fails (no server reachable), items fall back to name-only adds so behaviour does not regress. `createWatchlistItemsBatchData` forwards `imageUrl` to `upsertWatchlistItem`, which now honours a directly supplied image over the existing-payload/investment fallback.
- Portfolio preferences include notification toggles and per-category impact-level thresholds for **desktop system notifications** (`notifyBanWaveDesktop`, `notifyCsUpdatesDesktop`, `notifySteamSyncDesktop`). All stored as strings in the `meta` table; booleans coerce via `=== "true"`, levels via `IMPACT_LEVELS.indexOf()`. Both `apps/desktop/src/localStore/utils.js` (normalize) and `apps/desktop/src/localStore/settings.js` (upsert) must be kept in sync with `packages/shared/src/lib/portfolioPreferences.js`.
- **Web-push notification prefs are server-owned, not part of the localStore blob** — the server decides which subscriptions to wake. Table `user_notification_preferences` (`UserNotificationPreferenceRepository`); endpoints `GET|PUT /api/v1/settings/notifications` (`SettingsController`); frontend accessors `get/updateWebPushNotificationPreferences()` in `portfolioPreferences.js` (server on web, localStore mirror on desktop). Default: CS-updates web push ON, min level `high`. Fire web-push wakeups only from `CsUpdatesAiRatingService::notifyWebPushSubscribers` (after AI rating, so min-level can be honored) — never at RSS-ingest time. Ban-wave web push has no send path and is hidden on web.
- App-update availability surfaces **only** in the in-app notification bell (persisted `category=app_update` notifications from `apps/desktop/main/updater.js`) and the Settings "Über die App" card ("Nach Updates suchen" + live status). Do **not** reintroduce a floating in-app update toast or native OS toast. Auto-check is ~15s after launch + every 10 min (check-only; download/install stay user-confirmed).
- Sidecar starts on `127.0.0.1` with per-start secret (`X-Desktop-Sidecar-Secret` header required). Exception: `GET /api/v1/auth/steam/callback` is public (external browser redirect).
- Sidecar uses the host system PHP and requires the `mbstring`, `curl`, `json` extensions; `backend/desktop/index.php` returns a `PHP_EXTENSION_MISSING` error at startup if any are missing.
- User scope: `steam-<steamId>`, never legacy `"1"`. Legacy data auto-merged on first access.
- Secrets (CSFloat/SkinBaron keys) live only in the app-password-gated Secret Vault (Electron main process RAM after unlock). Never in `.env`, SQLite, or server.

### Auth/User Scope
- Server enforces that `userId`/`steamId` in requests MUST match the authenticated Steam session (`RequestUserScopeResolver`). Foreign scopes → `401/403`.
- Desktop sidecar forwards `Authorization`/`X-Auth-Token` to server upstreams so scope checks remain effective.
- The upstream server (incl. `/api`) sits behind a Cloudflare Zero Trust tunnel; the sidecar's upstream curl proxy authenticates by forwarding the renderer's per-user CF Access cookie. The Electron header bridge injects it as `X-Upstream-Cf-Cookie` on every renderer→sidecar request and `backend/desktop/index.php` promotes it into `UPSTREAM_COOKIE_HEADER` per request. No shared service token — each user uses their own CF identity. On missing/expired cookie the proxy returns `upstreamHint.code = CLOUDFLARE_ACCESS_LOGIN_REQUIRED` and the renderer prompts one CF re-login + retry.
- Desktop Cloudflare Access detection treats `404` or a `get-identity` `no app token set` body error as "Access not active" and proceeds without a login window; only `401/403` triggers the login flow. This avoids an endless login-popup + sidecar-restart loop when no Access app fronts the host.

### Data Ownership Layers
| Layer | Writes | Reads |
|---|---|---|
| Investments/Watchlist | Desktop only | Desktop + Web (via sync) |
| Prices | Server cron only | Desktop (via sidecar) + Web |
| Import triggers | Desktop-initiated | Desktop |
| VAC ban stats + ban-wave feed entries | Server cron only (`sync-ban-stats.php`, hourly) — CS2 source (csstats.gg) preferred; all-Steam (vac-ban.com) as fallback trigger + corroboration. Ban waves are auto-rated (no Gemini) by `CsUpdatesAiRatingService::autoRateBanWave()`; recent waves (14-day window) are injected as context into Gemini prompts for CS-update ratings. | Web + Desktop |

- Frontend watchlist view refresh: the Watchlist tab stays mounted via `forceMount` and holds a module-level snapshot, so a watchlist mutation from another surface (global search, search tab, CSFloat import) must signal it to refetch. `dataSource.js` create/batch helpers call `notifyWatchlistMutated()` (`watchlistMutationBus.js`) and `Watchlist.jsx` subscribes; without this the mounted view shows stale data until a full reload.

### Pricing Rules
- Canonical, source-aware price tables: `item_live_cache` (`PK item_id, price_source`) and `price_history_hourly` (`PK item_id, bucket_start, price_source`). Written **only** by the cron (`backend/sync-prices.php` bulk import + CLI queue worker).
- Passive reads never live-fetch: `PortfolioService::getEnrichedInvestments` defaults to `allowLiveRefresh=false`; investments/summary/composition/watchlist serve the last known price immediately. The cron is the sole price updater for web users.
- The web frontend makes **zero** external price calls: the old `PortfolioPage` auto-trigger that called `refresh-stale` (→ CSFloat) on stale prices was removed, along with the `refreshPortfolioStalePrices*` client wrappers. Do not reintroduce a web-initiated live price fetch — price freshness is cron-owned. (The desktop write-client and the CLI queue worker keep their own live-fetch paths.)
- Passive reads also skip the Steam Market catalog metadata fetch: `PricingService::getCatalogEntry` honors `allowLiveRefresh` and, when off, serves the existing (possibly stale/partial) catalog row instead of calling `SteamMarketClient::findExactItem` per item. Catalog metadata (image/labels) is backfilled solely by the cron — a passive page read must never make a synchronous external call.
- The dormant "scaling" price mirror (`item_price_latest`, `item_price_history_hourly`, `ScalingShadowReadService`, `SCALING_*_READ_ENABLED` flags) was retired; `user_positions`/`position_events`/`portfolio_snapshots_daily` remain for the future read-model.
- Price-history read responses expose **USD** as source of truth: `PriceHistoryRepository::findHistoryByItemId`/`findHistoryMapByItemIds` and `PortfolioService::getHistory` return `priceUsd`/`wert` in USD (`priceEur` kept only for back-compat); `WatchlistService::enrichHistoryWithGrowthPercent` keys on `priceUsd` and preserves raw fields. The frontend `PortfolioChart` reads the USD field and converts to the display currency at runtime via `CurrencyContext` — never assume EUR in a chart.

## Release Workflow
"Release" means Electron release (not just git push):
1. Commit feature changes with descriptive messages.
2. Clean working tree.
3. Bump `package.json` version + `package-lock.json`.
4. Commit: `release: vX.Y.Z` (version bump only, features already committed).
5. Create tag `vX.Y.Z` (must match `package.json`).
6. Push branch + tag → triggers `.github/workflows/desktop-release.yml`.

## Desktop Packaging (Windows + Linux)
- Every desktop release ships **both** targets: Windows (NSIS `.exe`) and Linux (`AppImage` + Debian `.deb`, for Debian/Ubuntu-based distros incl. Zorin OS). CI builds both on each `v*` tag via `desktop-release.yml`.
- Both platforms are **self-contained**: a fully static PHP runtime is fetched at build time (`npm run fetch:php`, from static-php-cli) and embedded via electron-builder `extraResources`; no system PHP is required. A `cacert.pem` is bundled for HTTPS. The binaries are git-ignored and re-fetched on every build.
- Canonical build/packaging/CI/release detail: `docs/devops.md`. Sidecar/runtime detail (static ini, CA injection, `resolvePhpBinary` fallback): `docs/architecture-overview.md` §3.1.

## Documentation Governance
`scripts/docs-guard.mjs` routes changes by category (same-commit doc updates required):
- **Architecture** triggers (runtime/ownership: `apps/desktop/main.js`, `backend/**` services/controllers/front-controllers, `dataSource.js`/`desktopSync.js`, …) → `AGENTS.md` + `docs/architecture-overview.md`.
- **DevOps/build** triggers (`package.json`, build config, `scripts/**`, `.github/workflows/**`, new top-level dirs like `build/`/`resources/`) → `AGENTS.md` + `docs/devops.md`.

Run `npm run docs:guard` before push. CI enforces via `.github/workflows/docs-governance.yml`.
No new `.md` files without entry in the Active Docs table (see `docs/architecture-overview.md` §7).

## Aktive Docs
| File | Status | Purpose |
|---|---|---|
| `docs/architecture-overview.md` | FINAL | Central architecture + doc navigator |
| `docs/devops.md` | FINAL | Build/packaging/CI/release (DevOps) |
| `docs/local-db-schema.md` | FINAL | SQLite schema |
| `docs/sync-api.md` | IN PROGRESS | Sync API contract |
| `backend/MVC_API_CONTRACT.md` | FINAL | Backend API contract |
| `backend/OBSERVABILITY_IMPLEMENTATION_PLAN.md` | IN PROGRESS | Observability plan |
| `backend/STRANGLER_ROLLOUT.md` | IN PROGRESS | Backend rollout plan |
| `docs/archive/repo-restructure-plan.md` | ARCHIVED | Monorepo structure (historical) |
| `docs/desktop-local-sync-plan.md` | IN PROGRESS | Sync roadmap |
| `docs/server-scale-plan.md` | IN PROGRESS | Server scaling architecture |
| `docs/fee-settings-plan.md` | IN PROGRESS | Fee/Break-even features |
| `docs/cs-updates-feed-plan.md` | IN PROGRESS | Updates/Feed feature |
| `docs/archive/MONOREPO_MIGRATION_STATUS.md` | ARCHIVED | Migration status (historical) |
| `plans/codebase-optimization-findings.md` | IN PROGRESS | Codebase optimization findings |
| `plans/codebase-optimization-plan.md` | IN PROGRESS | Codebase optimization plan |
| `old_agents.md` | ARCHIVED | Previous German AGENTS.md (preserved as reference) |
| `.kilocode/rules-architect/AGENTS.md` | ACTIVE | Kilo Code architect mode instructions |
| `.kilocode/rules-ask/AGENTS.md` | ACTIVE | Kilo Code ask mode instructions |
| `.kilocode/rules-code/AGENTS.md` | ACTIVE | Kilo Code code mode instructions |
| `.kilocode/rules-debug/AGENTS.md` | ACTIVE | Kilo Code debug mode instructions |
| `CLAUDE.md` | ACTIVE | Claude Code session instructions (overrides defaults) |

## Known Issues
- Bootstrap/DI in `backend/public/index.php` should target final migrated repository dependencies.
- `DesktopCsFloatController::watchlist` response metadata includes `mappedCount` (normalized items after parser) alongside `rawCount` (raw API rows); a caller can detect a silent parse failure when `rawCount > 0 && mappedCount === 0 && errors.length === 0`.
