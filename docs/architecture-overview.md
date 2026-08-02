# Architecture Overview (Central Reference)

Status: FINAL
Last updated: 2026-07-27

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
- `.kilocode/`
  - mode-specific agent instructions (rules per mode)
- `plans/`
  - codebase optimization plans
- `docs/`
  - architecture and implementation plans

### Compatibility artifacts currently present

- `backend/index.php` wraps `backend/public/index.php`.
- root `main.js` and root `preload.js` still exist, while active Electron entry is `apps/desktop/main.js`.
- `src.old/` exists as migration remainder.

## 3. Runtime Boundaries

### 3.1 Desktop runtime (primary write client)

- Starts local PHP sidecar on `127.0.0.1` with dynamic port + per-start secret.
- Sidecar runs a **bundled, fully static PHP runtime** shipped inside the app (`resources/php/<platform>/php[.exe]`, fetched at build time by `scripts/fetch-php.mjs` from static-php-cli), with `curl`, `openssl`, `mbstring`, `sqlite3`, `pdo_sqlite` compiled in — so **no system PHP is required on Windows or Linux**. `resolvePhpBinary()` (`apps/desktop/main/sidecar.js`) prefers the bundled binary (marked `isStatic`) and falls back to `$PHP_BINARY` or a system `php` on PATH. The backend still requires the `mbstring`, `curl`, and `json` extensions; `backend/desktop/index.php` fails fast with a `PHP_EXTENSION_MISSING` JSON error when any are absent, instead of fataling deep inside a route (which previously surfaced only as empty/non-JSON responses).
- For the static runtime the sidecar loads `backend/desktop/php.static.ini` (no `extension=` lines — extensions are compiled in) and injects `curl.cainfo`/`openssl.cafile` pointing at a bundled `cacert.pem`, so HTTPS (Steam OpenID, upstream APIs) verifies without relying on a host trust store. System PHP instead uses `backend/desktop/php.ini` with dynamically loaded extensions.
- Desktop build/packaging (which artifacts ship, how the static PHP runtime + CA bundle are fetched and embedded, CI/release) is a DevOps concern documented in `docs/devops.md`, not here.
- Sidecar secret is mandatory for desktop renderer/API traffic; only `GET /api/v1/auth/steam/callback` is public to allow the external Steam OpenID browser redirect.
- Renderer never reads SQLite directly.
- Renderer uses `window.electronAPI.localStore` for local persistence.
- Desktop local user scope is Steam-account specific (`steam-<steamId>`). New desktop reads/writes must not normalize Steam accounts back to legacy user `1`.
- Existing legacy local rows under user `1` are merged into the active Steam-local user on first local-store access, including investments, watchlist, inventory state, notifications, portfolio preferences, and pending operation payload user scopes.
- The "are there legacy rows?" probe (`legacyRowsExist`, `localStore/sync.js`) counts `sync_notifications` alongside investments/watchlist/inventory state. Background writers in the Electron main process can create legacy-scoped notifications long after the portfolio tables were migrated; without the notification count those rows would never be picked up again.
- Steam/CSFloat import triggers originate in desktop runtime; desktop may call sidecar/upstream endpoints for execution.
- Desktop sidecar exposes CSFloat import endpoints and a desktop-local buyorder read endpoint (`GET /api/v1/csfloat/buy-orders`) for watchlist enrichment.
- Desktop sidecar exposes SkinBaron preview endpoints (`POST /api/v1/portfolio/sync/skinbaron/preview`) for desktop-local import.
- Desktop sidecar must forward session auth headers (`Authorization` / `X-Auth-Token`) on user-bound upstream portfolio/watchlist/sync/settings requests so server-side scope checks stay effective.
- The upstream server (incl. `/api`) sits behind a Cloudflare Zero Trust tunnel; all traffic must be authenticated. The sidecar's upstream curl proxy therefore forwards the renderer's per-user CF Access cookie (`X-Upstream-Cf-Cookie` → `UPSTREAM_COOKIE_HEADER`). No shared service token is used — each user authenticates with their own CF identity. See §6.1 for the cookie plumbing and expiry/re-login flow.
- Secrets stay local (Electron safe storage / process env only).
- SkinBaron import currently uses only Session-Cookie (`AUTHID`) in Electron safe storage for purchases import data.
- Legacy SkinBaron API-key capability code remains archived in Electron main process, but is not exposed in the current renderer/settings UX.
- The desktop window is frameless; the titlebar (`packages/shared/src/components/Titlebar.jsx`) draws minimize/maximize/close itself. The look is **detected, not hardcoded**: `apps/desktop/main/window-controls-theme.js` (IPC `window-controls-theme`, cached per process, `force` re-detects) reports the button order/side from gsettings `button-layout` (GNOME/Cinnamon/MATE schemas, then `gtk-3.0/settings.ini`) plus the actual button artwork from the active GTK theme (`<theme>/metacity-1/titlebuttons/titlebutton-<action>[-hover].svg|png`), falling back to the icon theme's `window-*` icons (symbolic → rendered as CSS mask so they inherit the text color) and finally to the built-in Windows/macOS presets. This is what makes macOS-style or custom desktop themes appear correctly; do not reintroduce a `process.platform === 'win32'` icon switch. The user can override the detection with an explicit Windows/macOS preset — a localStorage-backed UI preference (`packages/shared/src/lib/windowControls.js`), not part of the synced preferences blob.
- Desktop runtime enforces an app-password-gated Secret Vault: secrets are decrypted only after unlock in Electron main-memory, always locked on restart, with optional auto-lock after 15 minutes idle (user opt-in).

### 3.2 Web runtime

- Uses server APIs only.
- Must not receive desktop-local secrets.

### 3.3 Server runtime

- **Secrets management**: `app_secrets` table (`AppSecretsRepository`, `AppSecretsService`) stores application secrets including ENCRYPTION_KEY. The encryption key is auto-generated (256-bit random, base64-encoded) on first API request if missing from `.env`, persisted in the database, and loaded on every startup. No manual server configuration needed for new users; key persists across restarts.
- Owns sync API (`/api/v1/sync/pull`, `/api/v1/sync/push`). `SyncService` owns the `sync_entities`/`sync_idempotency` tables and revision/idempotency logic; `SyncEntityService` owns domain projection into `items`/`investments`/`watchlist` (including their DDL) via `applyDomainChange`. The desktop reaches these directly and routes through `/api/index.php/api/v1/...` (the bare `/api/v1/...` path is not served by the front edge); `buildSyncEndpointCandidates` tries the `/api/index.php` form first and falls back to the others.
- Sync/portfolio/watchlist endpoints can resolve `steamId` to the server's numeric `users.id`; desktop clients may send Steam identity when no server numeric user id is present.
- **Auth header transport**: The Cloudflare Zero Trust tunnel in front of the server removes the `Authorization` header, so direct renderer→server calls must send the session token additionally as `X-Auth-Token`. Both the sync client (`desktopSync.js`) and `auth.js` do this; server side `RequestUserScopeResolver` and the session-validate route accept either header, and `X-Auth-Token` is listed in `Access-Control-Allow-Headers`. Sending only `Authorization` produces `MISSING_TOKEN`/`AUTH_REQUIRED` despite a valid token.
- **Session token formats**: server (`SteamAuthController`) and desktop sidecar (`DesktopSteamAuthController`) use mutually incompatible encryption (raw key + 16-byte IV vs. `sha256`-derived machine-local key + 12-byte IV). Desktop login therefore prefers the server flow ("Variante C"); the sidecar fallback yields a local-only token that cannot sync. A `401` with `AUTH_REQUIRED`/`INVALID_SESSION`/`MISSING_TOKEN` makes `desktopSync.js` clear the session once and report through `sessionHealthBus.js`, which surfaces the state as a warning badge on the avatar (`UserMenu`) and as a persisted `session_health` notification.
- Explicit request scopes (`userId`, `steamId`) are only valid when they match the authenticated Steam session; otherwise the server returns `401/403` instead of accepting foreign scopes.
- **Identity is resolved once per request, server-side only.** `RequestAuthenticator` (`backend/src/Http/Auth/`) decrypts the session token exactly once and yields a `RequestIdentity` (userId, steamId, IP). The auth gate, the rate limiter and `RequestUserScopeResolver` all consume that one object; none of them derives identity from `X-User-Id`, `X-Steam-Id` or a `userId` body field. Those request-supplied values are only ever *compared* against the verified identity, never trusted as identity.
- **Auth gate is deny-by-default** (`obs_apply_auth_gate` in `backend/public/index.php`, allowlist in `RouteAccessPolicy`). Public routes: Steam login/callback, `auth/session/validate`, `push/public-key`, `exchange-rate`, `cs-updates`. Everything else requires a valid session. Previously a request with no credential at all fell through `RequestUserScopeResolver` to user id `1` and was served that account's portfolio/watchlist/settings — the resolver's `return 1` fallback is now a `401` and the controllers' header-reading fallbacks are gone (the scope resolver is a required constructor dependency). Rollout is flag-gated: `AUTH_REQUIRED_ENFORCED=false` (default) logs `security.auth.request_denied` without blocking, so the denied set can be reviewed before enforcement.
- **`SteamAuthController::validateSession()` is the hot path and makes no outbound calls** — pure decrypt + expiry check. The profile-backfilling variant `validateSessionWithProfile()` (which can issue a Steam profile request) is used only by `GET /api/v1/auth/session/validate`, where refreshed name/avatar is the point. Mixing the two would have put a Steam round-trip on every authenticated request once the gate runs.
- **Rate limiting runs in two stages** (`RateLimitPolicy` / `RateLimitGuard` in `backend/src/Http/Security/`), because identity and the need to protect the process become available at different times:
  - `STAGE_EDGE` — before the DB connection, keyed on the connection IP. Caps the pre-session auth endpoints (fail-closed: a broken limiter store must not make login unlimited) and holds a global per-IP ceiling so a flood never reaches MySQL.
  - `STAGE_SESSION` — after token validation, keyed on the hashed session subject, carrying the per-route budgets (notably the external-fan-out routes: `prices/refresh-stale`, `watchlist/search`, `csfloat/preview|execute`).

  Bucket keys use a peppered SHA-256 of the session subject (or IP), so the limiter store and the `security.rate_limit.blocked` events carry no plaintext Steam IDs or IPs. The hash is internal and is never sent to the client — handing it out would make it client-supplied input again, which is the bug that was fixed. Rules are matched via `RoutePattern` (`{id}`, `{key}`, `*`), most specific wins, so `{id}` routes are coverable.
- **The limiter uses a weighted sliding window, not a fixed one** (`RequestRateLimiter`): current window count plus the previous window's count weighted by how much of it still falls inside the trailing window. A fixed window lets a caller spend the full budget at the end of one window and again at the start of the next — twice the intended rate across the boundary, worst exactly where it matters (login).
- **Counter storage is pluggable** (`backend/src/Application/Service/RateLimit/`): `ApcuRateLimitStore` when APCu is present (atomic `apcu_inc`, lock-free, shared across Apache workers), otherwise `FileRateLimitStore` (locked JSON file, serializes every limited request on one exclusive lock — a fallback, not the target). Availability is probed with `apcu_enabled()`, which is SAPI-aware, so CLI with `apc.enable_cli=0` correctly falls back to the file store instead of using a store that always fails. The server image installs APCu (`Dockerfile`, `conf.d/apcu-ratelimit.ini`).
- Proxy headers (`CF-Connecting-IP`, `X-Forwarded-For`) are only honoured when `TRUST_PROXY_HEADERS=true` declares that a trusted proxy terminates every request; otherwise `ClientIpResolver` uses `REMOTE_ADDR`. On a directly reachable origin those headers are attacker-controlled and each forged value would open a fresh rate-limit bucket.
- **Session tokens are revocable.** The token stays stateless (AES-256-GCM, 30 days) but now carries a `jti` claim; `user_sessions` (`UserSessionRepository`) records it at issue time and `SteamAuthController::validateSession()` rejects a token whose `jti` is missing from the registry or revoked. An **unknown `jti` counts as revoked** — a pruned or never-recorded row must not outlive the registry — and the row is written *before* the token is handed out. A registry read failure is the one fail-open case (a DB blip must not log everyone out). `POST /api/v1/auth/logout` revokes the presented session (public route: a client logging out may hold a token the gate already rejects, and must still be able to clean up); `revokeAllSessions(userId)` is the per-account "sign out everywhere". Tokens issued before this existed carry no `jti` and are accepted while `SESSION_LEGACY_TOKENS_ALLOWED=true`; they age out within the 30-day lifetime, after which the flag should go to `false`. `backend/sync-prices.php` prunes rows 7 days past expiry.
- Frontend `logout()` (`packages/shared/src/lib/auth.js`) calls the revoke endpoint before clearing local state — best-effort, since an unreachable server must not block a logout. On desktop the revoke goes to the **remote server**, because the local sidecar cannot decrypt a server-issued token.
- Owns pricing ingestion/read flows.
- Owns CS-updates ingest and web push.
- Owns ban-stats ingest (`backend/sync-ban-stats.php`, hourly): fetches CS2-specific VAC ban counts from `csstats.gg/bans` (primary) and all-Steam counts from `api.vac-ban.com` (corroboration), stores in `cs_ban_stats`, injects synthetic ban-wave entries into `cs_updates_feed` with dual-source corroboration context. `BanStatsIngestService` / `BanStatsRepository` / `VacBanApiClient` / `CsStatsBansClient`.
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
| VAC ban stats + ban-wave feed entries | Server cron (`sync-ban-stats.php`, hourly) | `cs_ban_stats` (raw daily counts) + `cs_updates_feed` (synthetic ban-wave entries, source=`ban_wave_detected`) | Web + Desktop |

## 5. Frontend Route Map (current)

From `apps/web/src/App.jsx`:
- `/` -> `PortfolioPage` (`initialTab=overview`)
- `/inventory` -> `PortfolioPage` (`initialTab=inventory`)
- `/watchlist` -> `PortfolioPage` (`initialTab=watchlist`)
- `/search` -> `PortfolioPage` (`initialTab=search`)
- `/cs-updates` -> `CsUpdatesPage`
- `/settings` -> `SettingsPage`
- `/wrapped` -> `YearWrappedPage` (Year Wrapped, lazy) — **deliberately not registered in `DesktopSidebarRail`, the page-local rail copies, or `BottomNavigation`.** Reached via the seasonal dashboard banner (15 Dec - 31 Jan, see §6.1) or directly by URL (`#/wrapped?year=YYYY`). Desktop-only: on web the page immediately redirects to `/`.
- Electron/Desktop uses a shared app-level rail shell (`DesktopSidebarRail`) so cross-route navigation does not remount page-local sidebars.
- The same shared app-level rail shell is used consistently across runtime paths so sidebar active-state/layout does not diverge between Dashboard, Settings, and Updates.

## 6. Page Lifecycle and Cache Policy

### 6.1 Verified current behavior

- `PortfolioPage` keeps visited tabs mounted (`visitedTabs` + `forceMount`).
- In Electron, the desktop rail sidebar is mounted once in `App.jsx`; pages can opt out of local sidebar shells via `useExternalDesktopSidebarShell`.
- Frontend color gradients must use the shared avatar-derived Steam palette variables (`--steam-shell-color-a` ... `--steam-shell-color-d`), with static values allowed only as fallback when avatar data is unavailable.
- `usePortfolio` uses in-memory snapshots as **stale-while-revalidate**: the cached payload may be painted for `15min` (`PORTFOLIO_CACHE_TTL_MS`) while the background refresh runs. The window is a paint budget, not a freshness claim — a load always follows the cached paint. It was raised from `120s` because `/cs-updates` and `/settings` are separate routes that unmount `PortfolioPage`: reading the update feed for three minutes used to drop the dashboard back to a cold load on return.
- **Only priced payloads are cached.** `usePortfolio` additionally mirrors the value-bearing fields (`stats` + `portfolioHistory`, not the rows — those rebuild from local SQLite in milliseconds) to `localStorage` under `portfolio-view-snapshot:<userSegment>::<scope>::<rowScope>` with a `60min` window, so an app restart repaints last known values instead of zeros. The window is deliberately shorter than the in-memory one because the restored `stats` carry frozen price-age fields.
- `usePortfolio` and API offline fallback caches are user-scoped so account switches cannot reuse another Steam account's portfolio payload.
- `usePortfolio` initial API load is keyed by `cacheKey` (not by snapshot object identity) to prevent self-triggered fetch loops.
- `Watchlist` uses in-memory snapshots with TTL `120s`.
- Watchlist candidate search is DB-first (`items` catalog), with Steam market lookup only as fallback when local search returns zero matches.
- Item-type filter `other` includes rows with missing/empty `item_type`/`type`, so legacy catalog entries are not silently dropped.
- Watchlist Buyorder enrichment is cache-backed and only refreshed during explicit CSFloat sync execution (not on every watchlist view load).
- If no local CSFloat buyorder cache snapshot exists, desktop watchlist triggers one live fetch and persists the snapshot; subsequent reads stay cache-first.
- The sidecar requests CSFloat `me/buy-orders` with a max page size of 50 and `order=desc` (the endpoint returns HTTP 500 for the larger sizes that `me/trades` tolerates); the controller's pagination end-of-data check is aligned to that 50 cap so orders past the first page are not dropped.
- If CSFloat `buy-orders` returns a temporary upstream failure such as 429/500/503, the desktop sidecar falls back to the trades endpoint before reporting no buyorders. A successful-but-empty buy-orders response is **not** a failure and does not trigger the fallback. When the fallback runs, the original buy-orders error is preserved in the response metadata (`buyOrdersError`) and surfaced in the debug line as `boError=<code>(<status>)` so the swallowed cause stays visible.
- Desktop can mirror the user's CSFloat watchlist into the local watchlist (`GET /api/v1/csfloat/watchlist` → sidecar reads `me/watchlist`). The import is **add-only** (one-way): items are matched by name against the existing local watchlist and only new ones are added via the proven add-by-name batch path (`createWatchlistItemsBatchData`); nothing is removed. It is opt-in via the `csfloatWatchlistAutoImport` portfolio preference (booleans persist as `"true"`/`"false"` strings in the desktop meta store) — when enabled it runs at the start of each watchlist load, self-throttled (60s cooldown) and only forcing a sync when new names are found. A manual "Jetzt importieren" button in Settings runs it on demand (`force`).
- CSFloat buy order items can be imported as watchlist items via `importCsFloatBuyOrdersAsWatchlistData()` (`dataSource.js`): add-only, dedup by name, 60 s cooldown, opt-in via `csfloatBuyOrderAutoImport` portfolio pref. Source is `summaryByMarketHashName` from the existing buy orders endpoint.
- Both CSFloat imports (watchlist + buy orders) resolve candidate names against the server item catalog via the watchlist search endpoint (`resolveWatchlistCandidatesFromCatalog`) before adding. Desktop must not create catalog items and server sync rejects unknown names (`findOrCreateItem` is find-or-throw), so only exact catalog matches are added — with the canonical name (so sync resolves `item_id` → price/history) and the catalog icon (image). Catalog-unknown names are skipped (`notInCatalog`); on search failure (no server) items fall back to name-only adds. `upsertWatchlistItem` honours a directly supplied image.
- Desktop watchlist detail renders Buyorders directly item-scoped under the price-history panel (mini table: price/orders/quantity) instead of a global buyorder summary card.
- Desktop watchlist detail exposes a compact debug line (client source, upstream source, pages fetched, raw rows, summary rows, cache/error indicators plus first upstream error code/status) to diagnose CSFloat buyorder mismatches quickly.
- If desktop sidecar proxy returns a `syncLive` fallback payload without upstream metrics/history, desktop watchlist performs one follow-up upstream read with `syncLive=false` to preserve visible price history/change metrics.
- `WatchlistOverview` uses in-memory snapshots with TTL `120s`.
- The `Watchlist` tab stays mounted via `forceMount`, so a watchlist mutation (add/batch-add) from another surface (global search, search tab, CSFloat import) signals it to refetch through `watchlistMutationBus`: `dataSource.js` create/batch helpers call `notifyWatchlistMutated()` and `Watchlist.jsx` subscribes via `subscribeWatchlistMutation`. Without this the already-mounted view shows stale data until a full page reload (snapshot invalidation alone cannot re-render a live `forceMount`ed component).
- `useCsUpdatesFeed` uses in-memory snapshots with TTL `120s`.
- Web runtime app shell uses a fixed viewport container (`h-[100dvh]`) and a flex-constrained `<main>` scroll area (`flex-1 min-h-0 overflow-y-auto`) to avoid mobile scroll-lock regressions.
- `PortfolioPage` no longer uses horizontal swipe tab switching on mobile; tab changes are explicit to avoid accidental gesture-triggered navigation.
- Server sync item resolution (`SyncEntityService::resolveItemIdForSync`) is a pure relational chain: `item_id` (FK to `items`) → `market_hash_name` (item natural key, UNIQUE) → error. Trust a valid payload `itemId`, else resolve by natural key via `resolveExistingItemId` (find-or-throw, never create — catalog is server-owned/read-only here). Image URL is an attribute, not a key: no image-based resolution exists. Removed fuzzy image-token `LIKE` fallback, exact-image-URL fallback, and "canonical-by-image" redirect all cross-linked different skins sharing image-token prefixes (Dreams & Nightmares Case → Stiletto knife `item_id`).
- Desktop sync push processes the oldest 200 pending `operations_log` ops per run. Unclaimable ops — payload user scope missing or purely numeric (desktop scopes are `steam-<steamId>`; legacy `"1"` is migrated on access) — and ops with unmappable entity types are retired (marked applied) instead of skipped; when a whole window was retired the next window is fetched immediately. Without this, ≥200 unclaimable legacy ops permanently occupy the oldest-first push window and silently stall all pushes.
- Desktop CSFloat trade import keeps stable identity on re-import: a matched existing investment is updated under its existing `id`/`externalTradeId` and keeps its user-chosen `bucket`; only new rows receive the `csfloatImportBucket` default. After import the Steam↔CSFloat matching refresh runs (parity with the SkinBaron import path).
- Sync pull import for `investments` and `watchlist_items` reconciles by `server_id` as canonical identity: before each upsert it hard-deletes any other local row that already holds the incoming `server_id` under a different local `id`. Without this, a server that re-emits a fresh local id for an existing server-side row (e.g. a watchlist re-add) would make the `INSERT … ON CONFLICT(id)` violate `UNIQUE(server_id)` and abort the entire pull. A soft delete does not release the constraint (a tombstoned row still occupies the unique index), so the delete is hard.
- Steam↔CSFloat matching persists a per-match `score_breakdown` (each contributing signal's points plus the actual measured deviation — float delta, price gap %, day gap, name overlap %) in the local `steam_csfloat_matches.score_breakdown` column, so the confidence value is fully traceable in the Matching UI. `listSteamCsfloatMatches` lazily backfills the breakdown for matches created before the column existed — including confirmed/auto-linked rows that are otherwise blocked from re-matching — by recomputing from retained local data (`steam_inventory_state.payload` + the CSFloat investment row) and writing only `score_breakdown`, never status/score/confidence.
- Desktop supports SkinBaron import preview/execute flow in Management; import writes locally and then re-runs Steam-vs-external matching so duplicates can be auto-resolved like the existing CSFloat flow. The matching candidate set includes both CSFloat and SkinBaron rows (platform/id-prefix filter in `syncSteamInventory`); match rows are stored in `steam_csfloat_matches` for either platform.
- Match resolution is quantity-aware: external rows with quantity > 1 (stackables like patch packs) can match up to `quantity` Steam pieces (capacity-counted pairing instead of one-shot assignment), and on resolve the STEAM piece is excluded with the unit buy price copied for reference — the quantity position stays active as the ledger. Unit rows keep the original direction (external excluded, price copied to the Steam row).
- Portfolio groups carry a derived `bucket` (inventory only when ALL members are inventory-bucketed); the inventory view filters groups by scope, and the detail panel's bucket toggle moves every member via `updateInvestmentBucket`'s batch path (`sourceInvestmentIds` from the group selection).
- SkinBaron purchase prices are EUR (`price` field — the AdditionalCurrency=USD automation affects only SkinBaron's secondary display currency, not the purchases payload). The desktop sidecar preview converts EUR→USD via `ExchangeRateClient` for `buyPriceUsd`; the external-trade-id fingerprint stays on the raw EUR price so ids are stable across rate changes.
- Portfolio investments API rows expose `clientId` (desktop-local entity id from the sync payload); name-aggregated rows expose index-aligned `sourceInvestmentIds`/`sourceClientIds`. Portfolio-group `memberInvestmentIds` may reference either id namespace, so group resolution and grouped-member filtering match across all id aliases (id/clientId/serverId); on web, group resolution falls back to the enriched server rows as raw source.
- Watchlist view state lives in a 60-minute module snapshot (`packages/shared/src/lib/watchlistViewSnapshot.js`, stale-while-revalidate). PortfolioPage prefetches it during browser idle after the initial dashboard load; within the freshness window the tab opens with zero network round-trips. CSFloat watchlist/buyorder auto-imports run fire-and-forget and rely on the mutation bus to refresh the view when they add items.
- Watchlist tab reads are **cache-only against the server** (`syncLive=false`): prices come from `item_live_cache`, refreshed solely by the cron. The `syncLive=true` path (server-side per-item `getLivePriceSnapshot` + 200ms sleep per item, potentially hitting CSFloat) is reserved for explicit sync actions and is no longer part of the view load or prefetch.
- `backend/sync-price-queue-worker.php` sets `ITEMS_CATALOG_WRITE_SCOPE=cron` (like `sync-prices.php`): the per-item queue path is also the catalog-metadata backfill (image/type/wear via Steam Market lookup). Without the scope, `persistCatalogEntry` silently skips the write and image-less catalog rows stay image-less while the Steam lookup repeats every cycle.
- SkinBaron desktop preview now uses `GET https://skinbaron.de/api/v2/Purchases` (session-authenticated), filters to `SUCCEEDED` purchase groups, flattens `purchaseItems`, and builds stable external trade ids per purchase item.
- Settings in desktop runtime provide only a SkinBaron browser-connect/session-cookie flow that opens a login window, captures `AUTHID` from Electron cookies, and stores it encrypted for Purchases import.
- SkinBaron desktop browser-connect and Purchases web requests now consistently use `/en/profile/purchases` referer + `Accept-Language: en-US` to avoid accidental German-localized import payloads.
- `CurrencyContext` persists selected display currency server-side via settings API and still keeps local fallback in `localStorage`.
- Currency popularity ranking in Settings is sourced from anonymized server aggregates (no user identifiers in `currency_usage_stats`).
- Portfolio groups are loaded from server settings with local fallback; existing local-only groups are auto-migrated to server when the remote payload is empty.
- Desktop sidecar `PUT /api/v1/settings/portfolio-groups` degrades to a `desktop-local-fallback` success (not a hard `502`) when every upstream candidate fails (CF Access lapse, server down, 5xx). The renderer has already persisted the groups locally and the GET handler auto-migrates them once upstream is reachable, so the write is never lost — mirroring the GET handler's fallback. `upstreamAttempts` (the per-candidate HTTP codes) is returned in `meta` for diagnosis.
- Desktop sidecar upstream proxy now tries additional `index.php` + `?route=` candidate patterns and classifies Cloudflare Access login HTML as access denial hints instead of route-not-found noise.
- Desktop sidecar **write** proxies (PUT/POST: settings currency/price-source/portfolio-groups, `portfolio/prices/refresh-stale`, `watchlist/batch`) go through a shared `$proxyUpstreamSend` helper that mirrors the GET proxy's TLS handling — including the insecure-TLS retry on certificate/connect errors (`UPSTREAM_INSECURE_TLS_FALLBACK`, default on). The host's system PHP on Windows often has no configured curl CA bundle, so HTTPS verification fails with curl code `0`; previously only the GET proxy retried insecurely, so **every write silently failed and was swallowed as a `desktop-local-fallback` success** (observed: portfolio groups never reaching the server, `upstreamAttempts=[0,0,…]`). All write handlers now share the same TLS-tolerant sender.
- Desktop sidecar upstream proxy authenticates through the Cloudflare Zero Trust tunnel by forwarding the renderer's CF Access cookie. The Electron header bridge (`apps/desktop/main/sidecar.js`) injects the cookie as `X-Upstream-Cf-Cookie` on every renderer→sidecar request; `backend/desktop/index.php` promotes that header into `UPSTREAM_COOKIE_HEADER` per request so `$proxyUpstreamGet` sends it as the upstream `Cookie:` header. The cookie cache is read from `defaultSession` (authoritative store) and seeded both at startup (`refreshUpstreamCfCookieFromSession`) and right after a CF login. Without this, every proxied read (prices via investments, history, watchlist/search, composition enrichment) got the CF login HTML and failed silently.
- When the CF cookie is missing/expired the proxy now returns `meta.upstreamHint.code = "CLOUDFLARE_ACCESS_LOGIN_REQUIRED"` (detected via the curl effective URL landing on `*.cloudflareaccess.com` / `/cdn-cgi/access/`); the renderer (`packages/shared/src/lib/api/core.js`) reacts by prompting one CF re-login and retrying the request once (coalesced across concurrent reads).
- Desktop Cloudflare Access detection (`hasCloudflareAccessIdentity`) treats a `404` or a `get-identity` body error of `no app token set` as "Access not active" and proceeds without a login window. Only `401/403` (or a valid identity that is absent) triggers the login flow, preventing an endless login-popup + sidecar-restart loop when no Access application is configured in front of the host.
- Search-to-watchlist add checks in `PortfolioPage`/`ItemSearch` use watchlist entries only (not inventory/investment presence), so web runtime can add watchlist items independently.
- `ItemSearch` mobile controls use larger touch targets (>=44px) for pagination/actions to improve finger usability.
- Electron app updates are user-confirmed: update checks can report availability, but downloads start only after explicit user action (`Jetzt updaten`), not automatically in background.
- Electron updater download requests self-heal missing in-memory update metadata by running `checkForUpdates()` before prompting download, and return structured failure reasons to renderer/UI when download cannot start.
- Update notifications surface **only through the in-app notification bell** (persisted system notifications, `category=app_update`, created in `apps/desktop/main/updater.js`) plus the "Über die App" card in Settings ("Nach Updates suchen" button + live status). The former floating in-app update toast (`apps/web/src/App.jsx`) and the native OS toast were removed — update availability must not raise a separate popup. Auto-check runs ~15s after launch and every 10 minutes (check-only; download/install stay user-confirmed). Installs that cannot replace themselves (AppImage without `APPIMAGE`, Snap, unpacked build) are detected via `resolveSelfUpdateSupport()`/`isUpdaterActive()`; they fall back to a direct GitHub-release-feed check that reports `state="manual"` and links to the releases page, and updater errors/failed downloads carry the same `url`. Renderer-side handling lives once in `packages/shared/src/lib/appUpdateActions.js` (`runAppUpdateAction`, `openAppReleasesPage`). The bell being the only channel makes the write scope load-bearing: the updater resolves the active `steam-<steamId>` scope (renderer-reported via `setActiveNotificationUserId`, else `resolveActiveLocalUserId()` from the local DB) instead of the legacy numeric `1`, which the notification centre never reads. That write goes through the **live store instance** (`setLocalStoreRefs(() => localStore, …)` in `main/index.js`) — handing it the async module loader `getLocalStore` yields a Promise without `createNotification` and silently drops every update notification. Because `app-updater-status` is a fire-and-forget IPC push with no replay, the main process also keeps the last status and exposes it via `app-updater-last-status` / `updater.getLastStatus()`; renderer surfaces pull it once on mount (a live push that races the pull wins) so the ~15s startup check is not lost when no listener was mounted yet. Download progress is the single exception to "the bell shows persisted rows": `DesktopSidebarRail` builds an **ephemeral** progress entry (`buildDownloadProgressEntry`) from the live `state="downloading"` push, since `download-progress` fires many times per second and persisting it would both hammer SQLite and leave an orphan row if the app dies mid-download. The entry carries the version (added to the progress payload in `updater.js`, which electron-updater omits), disappears on any other state, and triggers an immediate notification reload so the persisted "Update bereit" entry replaces it without waiting for the 30s poll.
- Desktop portfolio preferences include per-category notification settings: system-notification toggles + impact-level thresholds for ban waves, CS2 updates, and Steam sync (`notifyBanWaveDesktop`, `notifyCsUpdatesDesktop`, `notifySteamSyncDesktop`). Booleans stored as `"true"`/`"false"` strings; levels validated against `IMPACT_LEVELS = ["none","low","medium","high"]`. Preference normalization is defined in three places that must stay in sync: `packages/shared/src/lib/portfolioPreferences.js`, `apps/desktop/src/localStore/utils.js`, and `apps/desktop/src/localStore/settings.js`.
- **Web-push notification preferences are server-owned**, because the server decides which subscriptions to wake. They live in `user_notification_preferences` (`UserNotificationPreferenceRepository`, per-user: `notify_cs_updates_web_push` default ON, `cs_updates_web_push_min_level` default `high`) and are exposed via `GET|PUT /api/v1/settings/notifications` (`SettingsController`). The frontend reads/writes them through `get/updateWebPushNotificationPreferences()` in `portfolioPreferences.js` (server on web/PWA, localStore mirror on desktop) — the web-push section only renders on web (`!isElectronRuntime`). CS-updates web push is the only wired channel; ban-wave web push has no send path and is intentionally not shown.
- Web-push CS-update wakeups are fired from a **single authoritative site**, `CsUpdatesAiRatingService::notifyWebPushSubscribers`, *after* the AI impact rating lands, so the per-user min-level filter can be applied (unknown-impact entries at RSS-ingest time cannot be thresholded). The ingest-time blast in `CsUpdatesIngestService` was removed (it also double-notified). The service worker (`apps/web/public/sw.js`) still renders whatever wakeup it receives; the eligibility gate is server-side.
- Desktop app runtime is globally gated by Secret Vault status in `App.jsx`: while locked/not configured, shared routes are blocked by an unlock/setup screen and sensitive IPC paths (`backend-base-url`, local-store IPC, secret mutations) stay denied.
- **Steam login comes before the vault gate.** The gate only renders once a desktop Steam session exists (`resolveSteamIdFromUser` over `electronAPI.getSession()` in `App.jsx`). Without a session the routes render and `PortfolioPage` shows `SteamLoginPrompt`; the unlock/setup screen follows afterwards. Rationale: after logout the vault stays configured but is locked again on restart, so "App entsperren" would otherwise be the first screen for an account that is not even connected. Because the login runs inside the route and does not notify `App`, the session is re-read every 3s (and on window focus) until it appears.
- The Secret Vault setup/unlock screen now embeds welcome/onboarding context inside the same `steam-startup-shell`, using avatar-derived Steam palette variables (`--steam-shell-color-a` ... `--steam-shell-color-d`) with fallback colors.
- Passive portfolio reads (`investments`, `summary`, composition donut) are **cache-only**: `PortfolioService::getEnrichedInvestments` defaults to `allowLiveRefresh=false`, so they serve the last known price from `item_live_cache` immediately (stale is marked, never blocks on a CSFloat fetch). For web users the cron (`backend/sync-prices.php`) is the sole price updater.
- The **web frontend issues zero external price calls.** A former `PortfolioPage` effect auto-called the `refresh-stale` endpoint (a synchronous CSFloat lookup) whenever it detected stale prices; that auto-trigger and the `refreshPortfolioStalePrices*` client wrappers were removed. The `POST /api/v1/portfolio/prices/refresh-stale` route still exists server-side but is no longer invoked by the web app — price freshness is cron-owned. (Desktop write-client and the CLI queue worker retain their own deliberate live-fetch paths.)
- Cache-only means **no external call of any kind** on a passive read — not just prices. `PricingService::getCatalogEntry` also honors `allowLiveRefresh`: when off it serves the existing catalog row (even if stale/partial) rather than calling `SteamMarketClient::findExactItem` per item. A stale/incomplete catalog previously triggered one synchronous Steam Market lookup per item (~N×latency, the dominant cost on large portfolios); catalog metadata is now backfilled solely by the cron.
- Interactive pricing requests apply a capped CSFloat lookup budget per request (`MAX_INTERACTIVE_CSFLOAT_LOOKUPS`), while CLI workers remain uncapped.
- `CsFloatClient::fetchLowestListingResult()` uses `GET /api/v1/listings/price-list` as primary bulk source (90s in-memory cache), with per-item listing lookup as fallback.
- Search observability includes `domain.watchlist.search.*` events and a debug aggregation endpoint `GET /api/v1/debug/watchlist-search-stats` (server + desktop sidecar proxy).
- Frontend stale handling calls `POST /api/v1/portfolio/prices/refresh-stale` (cooldown 120s) to refresh stale portfolio prices in background.
- Portfolio fetch path uses two backend requests (`investments`, `history`) and computes summary client-side from rows.
- **The metrics-scope toggle (`investments` ↔ `all`) is a local recompute, not a refetch.** `usePortfolio` always fetches rows with `rowScope: "all"`, so the same rows are valid for every scope — the scope only selects `calculatePortfolioSummary(filterRowsByScope(rows, scope))`. While the rows are priced the hook derives `stats` from them via `useMemo` instead of using the payload's summary (identical maths, same pure functions), so the KPI cards switch instantly and the cache-key change no longer forces a loading state or a local-snapshot read. Previously the toggle changed the cache key, missed the cache, and left the old scope's numbers on screen for the seconds until sync + upstream returned — reading as a switch that did nothing.
- Desktop portfolio/dashboard hydrates first from local SQLite investments + local snapshots, but that local-only payload is never cached; the follow-up live refresh waits for desktop sync before reading upstream pricing/history.
- **The local-only payload has no prices at all.** `clusterDesktopInvestments` has no live/display price to work with, so every value-bearing summary field (`totalValue`, `totalProfitEuro`, price ages) is `0` until the upstream enrichment lands — that zero means "price unknown", not "worth nothing". The desktop data source states this explicitly as `rows.meta.livePricing` (`false` for the local snapshot and the `desktop-local-fallback` case, `true` once upstream rows merged, `true` for an empty portfolio which has nothing to price). Consumers must not treat those zeros as values:
  - `usePortfolio` never lets an unpriced payload overwrite rows or stats it already holds from a priced one, and exposes `statsPending` for "no priced values yet, load still running". It settles to `false` when the load finishes, so an upstream that never returns prices shows the real zeros plus the existing warning instead of an endless skeleton. Both "known values" claims are tagged with what they belong to — the stats with the cache key, the rows with the user segment — because values for one scope or account must never be presented as another's.
  - The overview KPI cards (`StatCard`, `PortfolioHeaderCard`) render skeletons on `statsPending`. Rendering `stats.totalValue` unguarded is what made a dashboard remount show a confident `0 €` for the seconds until sync + upstream returned.
- `getCachedPortfolioPreferences()` (`portfolioPreferences.js`) returns the last known preferences synchronously (module cache + `localStorage`, tagged with the user scope it was written for). `PortfolioPage` seeds `portfolioPreferences`/`selectedMetricsScope` from it because `metricsScope` feeds the `usePortfolio` cache key: seeding from the static default and switching one tick later (when the async IPC read resolves) changed the cache key and cost a second full portfolio load on every mount. It is a first-paint hint only — the async read always follows and overwrites it.
- **Overview composition is derived, not fetched.** `PortfolioPage` computes the donut with `buildPortfolioCompositionFromRows(enrichedInvestments, { scope: metricsScope })` in a `useMemo`; `compositionLoading` is just `statsPending`. The dedicated data path (`fetchPortfolioCompositionData`, the `usePortfolioComposition` hook, and the `fetchPortfolioComposition` API client) is removed — it re-fetched the identical `investments` payload `usePortfolio` was already loading, so every dashboard mount sent two identical upstream requests, and the hook had no cache at all. It existed because local-first rows without live pricing would collapse the donut; `statsPending` now covers that (skeleton until priced rows arrive). The server route `GET /api/v1/portfolio/composition` still exists but has no frontend caller.
- Deriving the donut also **fixed it ignoring the `all` scope**: the old path scoped its rows first and then called `buildPortfolioCompositionFromRows` *without* options, whose `filterRowsByScope` default is `investments` — so inventory-bucket rows were filtered out a second time and the donut showed investments-only even in "Alles" mode.
- Non-overview dashboard tabs (`inventory`, `watchlist`, `search`) and sync modals are lazy-loaded so their UI code does not block the initial overview bundle.
- Ancillary portfolio side-loads (management rows, group settings, search watchlist preload, watchlist movers) are deferred until the related tab or overlay is active; overview mover data is idle-scheduled but still performs a live watchlist sync with a read-only fallback.
- Desktop auto Steam inventory sync is deferred until the first portfolio load has finished and then scheduled during browser idle, so it no longer competes with the initial dashboard paint.
- For `metricsScope=all`, frontend normalizes history/KPI fallback inputs against the active summary values when the newest history snapshot diverges significantly, so `Gesamt Zuwachs` and chart stay scope-consistent.
- CSFloat rate-limit handling uses a circuit-breaker file backoff and respects upstream `Retry-After` when present.
- **Year Wrapped (`/wrapped`) reads raw local rows, not the portfolio view model.** `YearWrappedPage` calls `localStore.listInvestments()` / `listWatchlist()` directly, because both clustering paths (`clusterDesktopInvestments` client-side, `aggregateInvestmentsByName` server-side) collapse rows by item name and drop the per-purchase `purchasedAt` every buy-related statistic depends on. `usePortfolio()` is still used, but only for `portfolioHistory` (daily USD values) and `enrichedInvestments` (current ROI). This is also why Wrapped is desktop-only: the web API returns aggregated rows without purchase dates. Stats live in `packages/shared/src/lib/yearWrapped.js` as pure functions; the purchase date falls back `purchasedAt || importedAt || createdAt`, and rows with none are excluded from buy stats but counted as `undatedCount`. Every stat block carries an `available` flag so slides without data are dropped rather than rendered empty. Realized P&L is **not** part of Wrapped — no exit model exists (the exclusion flag carries neither timestamp nor sell price).
- **Wrapped filters excluded positions.** Raw local rows still carry them (that is the cost of bypassing the filtered view model), so `buildYearWrappedStats` drops `isExcludedRow` matches before any purchase statistic. Without this, positions the user has taken out of the portfolio inflate every spend figure and can win "most expensive purchase". A year whose only rows are excluded therefore has no data at all; `YearWrappedPage` detects that (only intro+outro remain) and renders a dedicated empty state instead of an empty story.
- Wrapped auto-advances every 20s, pauses on `visibilitychange` when the document is hidden, and stops on the final slide rather than looping. Numbers animate via `useCountUp` (`packages/shared/src/hooks/useCountUp.js`), which carries a `setTimeout` safety net because `requestAnimationFrame` does not run in a hidden or occluded window — without it a counter would sit at its start value and display `0`, a wrong number rather than a missing animation.
- **UI sounds are global** (`packages/shared/src/lib/uiSounds.js`): short tones synthesized with the Web Audio API, no audio assets and therefore no licensing or bundling concern, and compatible with the `script-src 'self'` CSP. The enabled flag and volume live in `localStorage` (like the theme) rather than in `portfolioPreferences`, so a pure client-side UI toggle does not force three preference-normalization sites to stay in sync. `SoundSettingsSection` (Settings) and the Wrapped header both drive the same module and mirror it via `subscribeUiSounds`. Playback is best-effort: a suspended AudioContext (autoplay policy) degrades to silence, and `primeUiSounds()` must be called from a real user gesture to unlock it.
- App-wide click feedback comes from **one delegated listener**, `useGlobalUiSounds` (`packages/shared/src/hooks/useGlobalUiSounds.js`), mounted once in `apps/web/src/App.jsx`. A per-component sound call across three rail copies, modals and settings sections would guarantee drift and missed spots. It listens on `pointerdown` in the capture phase (so `stopPropagation` handlers are still observed) and doubles as the gesture that unlocks the AudioContext. Controls that carry their own *semantic* sound (Wrapped slide navigation, the sound toggles) opt out with `data-no-sound`, which is also honored on ancestors — without it those controls would play the generic click on top of their own tone.
- **Chart marks must not use `--steam-shell-color-*` directly.** Those variables bake in a 0.11-0.20 alpha because they are background washes; a donut filled with them renders at ~15% opacity and reads as empty. `packages/shared/src/lib/steamChartPalette.js` (`buildChartPaletteVars`) derives opaque `--wrapped-chart-a…d` siblings that keep the avatar-derived hue but clamp saturation/lightness into a legible band, so the palette rule still holds.
- The Year Wrapped entry point is a seasonal, dismissible banner in the dashboard overview (`PortfolioOverviewSection`), gated by `resolveWrappedSeason()`: 15-31 Dec shows the ending year, all of January shows the year just ended. Dismissal is a year-scoped `localStorage` key (`year-wrapped:dismissed:<year>`) so the next season shows the banner again. The route itself stays reachable year-round by URL.

### 6.4 Price tables and write policy

- **Canonical price tables (source-aware, cron-written only):**
  - `item_live_cache` — current price per `(item_id, price_source)`.
  - `price_history_hourly` — hourly USD snapshots per `(item_id, bucket_start, price_source)`; regular InnoDB table (no partitioning) for MariaDB foreign-key compatibility.
  These are read by all price consumers (investments, summary, composition, watchlist, and the catalog/watchlist search price JOIN in `ItemRepository`).
- **Writers are cron-only:** `backend/sync-prices.php` runs a bulk CSFloat price-list import (`PriceListBulkImportService`) to upsert all items into `items`, `item_live_cache`, and `price_history_hourly`, plus the CLI price-refresh queue worker for per-item top-ups. With `price-list` as bulk source, hourly runs update all tracked queue items without per-item external lookups in the common case.
- `backend/sync-prices.php` is the only write-enabled process for `items` and sets `ITEMS_CATALOG_WRITE_SCOPE=cron` explicitly before catalog upserts.
- **Reads never live-fetch** (see §6.1): passive page reads serve from `item_live_cache`; only the cron and the explicit `refresh-stale` action contact CSFloat.
- The previous dormant "scaling" mirror tables (`item_price_latest`, `item_price_history_hourly`) and the flag-gated `ScalingShadowReadService` were retired (migration `2026_06_11_001`). The future user-scaling read-model still builds on `user_positions` / `position_events` / `portfolio_snapshots_daily`, which remain.
- **Price-history read responses expose USD as the source of truth.** `PriceHistoryRepository::findHistoryByItemId` / `findHistoryMapByItemIds` and `PortfolioService::getHistory` return `priceUsd`/`wert` in USD (`priceEur` retained only for back-compat). The frontend `PortfolioChart` is currency-aware: it reads the USD field and converts to the user's display currency at runtime via `CurrencyContext` (`formatPrice(…,{useUsd:true})`) — it never assumes EUR. `WatchlistService::enrichHistoryWithGrowthPercent` keys on `priceUsd` and preserves the raw entry fields. This matches the global rule "persist USD, compute display currency at runtime".

### 6.5 Ban-stats ingest and ban-wave detection

- `sync-ban-stats.php` runs hourly via supervisord. Fetches daily VAC ban counts from two sources: `csstats.gg/bans` (CS2-specific, primary trigger) and `api.vac-ban.com/api/stats` (all Steam games, corroboration). Each source stored independently in `cs_ban_stats` keyed by `(stat_date, source)`.
- **Source roles:** `csstats_gg` is preferred for wave detection because it tracks CS2-specific bans; `vac_ban_api` is the fallback trigger (used when CS2 source lacks sufficient history) and always provides corroboration context.
- Detection runs only on completed days (`stat_date < today UTC`) to avoid injecting feed entries with partial-day counts (which would be frozen by the idempotency lock).
- Algorithm: median baseline over the last 14 completed rows from the active source; wave if `ratio >= BAN_WAVE_THRESHOLD` (default 2.5) AND `ban_count >= BAN_WAVE_MIN_COUNT` (default 200). Median is used instead of mean to avoid historical waves inflating the baseline.
- After a wave is detected, `buildCorroborationContext()` checks the other source for the same date and includes the result in `summary_raw` (corroboration phrase drives confidence in auto-rating): confirmed / elevated / no spike / not available. Ratio and threshold are displayed as percentages (e.g. `250% des Medians`).
- Ban-wave entries appear in `cs_updates_feed` with `source='ban_wave_detected'` and `external_id='banwave_YYYY-MM-DD'`. **Ban waves are auto-rated by `CsUpdatesAiRatingService::autoRateBanWave()` without a Gemini call** — impact/urgency/confidence are derived deterministically from the ratio parsed out of `summary_raw`. No re-injection on subsequent runs (idempotent via `findByExternalId`).
- When `sync-cs-updates-ai-rating.php` rates non-ban-wave entries, `CsUpdatesFeedRepository::findRecentBanWaves(14)` injects a 14-day ban-wave context block into the Gemini prompt so the AI can factor in recent wave activity when assessing update market impact.
- ENV: `BAN_WAVE_THRESHOLD` (float, default 2.5, clamped [0.1, 10.0]), `BAN_WAVE_MIN_COUNT` (int, default 200).

### 6.2 CS updates feed behavior

- default query window: last `7` days,
- incremental history via `before` cursor,
- explicit UI action `Load older` for older entries.
- `cs_updates_feed` table (including AI rating columns) is initialized via `CsUpdatesFeedRepository::ensureTable()` at server startup in `backend/public/index.php`. Wrapped in a try-catch so a migration failure does not crash all API endpoints.
- Desktop Electron preload is `apps/desktop/preload.cjs` (CommonJS, `.cjs` extension required because root `package.json` has `"type": "module"`).

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
| `docs/devops.md` | FINAL | CURRENT | Build/packaging/CI/release (DevOps). |
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
| `plans/codebase-optimization-findings.md` | IN PROGRESS | CURRENT | Codebase optimization analysis findings. |
| `plans/codebase-optimization-plan.md` | IN PROGRESS | CURRENT | Codebase optimization implementation plan. |
| `old_agents.md` | ARCHIVED | HISTORICAL | Previous German AGENTS.md (preserved as reference). |
| `.kilocode/rules-architect/AGENTS.md` | ACTIVE | CURRENT | Kilo Code architect mode instructions. |
| `.kilocode/rules-ask/AGENTS.md` | ACTIVE | CURRENT | Kilo Code ask mode instructions. |
| `.kilocode/rules-code/AGENTS.md` | ACTIVE | CURRENT | Kilo Code code mode instructions. |
| `.kilocode/rules-debug/AGENTS.md` | ACTIVE | CURRENT | Kilo Code debug mode instructions. |
| `CLAUDE.md` | ACTIVE | CURRENT | Claude Code session instructions. |

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
- Build/CI/packaging changes are DevOps and belong in `docs/devops.md` (+ `AGENTS.md`), not here. `docs-guard.mjs` routes triggers by category.
- Run `npm run docs:guard` before push for global changes.
- Keep architecture content out of `README.md`.
- Do not add new architecture markdown files without AGENTS table entry.
