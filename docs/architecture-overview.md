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
- The upstream server (incl. `/api`) sits behind a Cloudflare Zero Trust tunnel; all traffic must be authenticated. The sidecar's upstream curl proxy therefore forwards the renderer's per-user CF Access cookie (`X-Upstream-Cf-Cookie` → `UPSTREAM_COOKIE_HEADER`), owned by `apps/desktop/main/cloudflare-access.js`. No shared service token is used — each user authenticates with their own CF identity. See §6.1 for the cookie plumbing and expiry/re-login flow.
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

### 4.1 Portfolio group fields

A portfolio group carries `id`, `name`, `thesis`, `color` and `memberInvestmentIds`.
`color` is one of `success | info | warn | danger | muted` — a token key, not a raw
colour value, so each theme resolves it against its own palette. The vocabulary is
defined twice and the two must stay in lockstep: `PORTFOLIO_GROUP_COLORS` in
`packages/shared/src/lib/portfolioGroups.js` and `GROUP_COLORS` in
`backend/src/Infrastructure/Persistence/Repository/UserPortfolioGroupsRepository.php`.
Both normalise an unknown value to `success` rather than storing it.

Groups round-trip through `PUT /api/v1/settings/portfolio-groups`, whose response is
adopted as authoritative. A server that predates the `color` whitelist echoes every
other field but drops this one, which would reset the colour on every save — so
`preservePortfolioGroupColors` re-applies the locally known colour wherever the echo
omits it, on both the save and the load/merge path. Fields the server does know still
win; only a *missing* colour falls back to the local value. This guard stays correct
once the backend ships and can be removed then.

## 5. Frontend Route Map (current)

From `apps/web/src/App.jsx`:
- `/` -> `PortfolioPage` (`initialTab=overview`)
- `/inventory` -> `PortfolioPage` (`initialTab=inventory`)
- `/watchlist` -> `PortfolioPage` (`initialTab=watchlist`)
- `/search` -> `PortfolioPage` (`initialTab=search`)
- `/cs-updates` -> `CsUpdatesPage`
- `/settings` -> `SettingsPage`
- `/wrapped` -> `YearWrappedPage` (Year Wrapped, lazy) — **deliberately not registered in `DesktopSidebarRail`, the page-local rail copies, or `MobileTopbar`.** Reached via the seasonal dashboard banner (15 Dec - 31 Jan, see §6.1) or directly by URL (`#/wrapped?year=YYYY`). Desktop-only: on web the page immediately redirects to `/`.
- Message blocks across all routes come from the shared primitives rather than per-screen markup: `Callout` (rounded block with prose), `SettingsBanner` (full-bleed strip inside a settings card) and `EmptyState` (standalone empty block). See `docs/design-system.md`.
- `/design` -> `DesignSystemPage` (design-system catalogue, lazy) — like `/wrapped`, **deliberately not registered in `DesktopSidebarRail`, the page-local rail copies, or `MobileTopbar`.** It is a builder's tool reached by URL (`#/design`) while writing a new view: every `ui/` primitive with all variants, sizes and tones, plus the token swatches, rendered against the real tokens in both themes. Its own light/dark toggle drives the `dark` class on the root element rather than a scoped preview wrapper — several primitives carry `dark:` variants that only respond to the root class, so a scoped preview would show the light treatment in both positions and hide exactly the regressions the page exists to catch. Lazy-loaded, so it stays out of the dashboard bundle. Reference: `docs/design-system.md`.
- Electron/Desktop uses a shared app-level rail shell (`DesktopSidebarRail`) so cross-route navigation does not remount page-local sidebars.
- **Below `md` the shell is `MobileTopbar`** (`packages/shared/src/components/MobileTopbar.jsx`), rendered once by `App.jsx` above the routed view: a 52px `--sidebar` bar carrying the hamburger, the route-derived screen title and the global-search field, plus the left drawer it opens (250px, `--sidebar`, overlay `black/50`, 44px nav rows). It **replaced `BottomNavigation`** — the mobile design navigates through a drawer, and six destinations (Dashboard, Inventar, Watchlist, Suche, Verwaltung, Einstellungen, Updates) do not fit a dock, which is why the dock's profile button had to double as the settings entry. `ThemeToggle`, `NotificationBell` and `UserMenu` moved into the drawer foot for the same reason — the bell is the app's only channel for update availability and sync actions, so it cannot simply be dropped on mobile. It was extracted out of `DesktopSidebarRail` into `NotificationBell` rather than hand-copied a third time (`PortfolioPage`'s page-local rail still holds its own copy). Title and active row both derive from the route (`resolveActiveKey`), so no screen owns its own chrome; `Verwaltung` is a tab on `/`, not a route, and stays desktop-runtime-only. The drawer closes in the nav row's own click handler rather than on a route effect, because navigating to the screen you are already on fires no route change. Consequence for pages: the former `pb-[calc(8.5rem+…)]` dock clearance shrank to `1.5rem`, and `PortfolioPage`'s sticky mobile search bar is now `hidden md:block` — below `md` the topbar owns global search, and the tablet band (no topbar, no rail) still needs it.
- The same shared app-level rail shell is used consistently across runtime paths so sidebar active-state/layout does not diverge between Dashboard, Settings, and Updates.

### 5.0 Desktop dashboard (from `sm`)

`PortfolioOverviewSection` follows the chart-hero handoff (`design_handoff_desktop_dashboard/Dashboard Desktop.dc.html`): head row (scope segment + price freshness) → hero + chart → KPI band → a `1.3fr / 1fr` band of allocation + movers on the left, activity + watchlist alarms on the right.

- **The hero lives in `PortfolioChart`'s new `headerSlot` prop**, not above the card. The range pills belong on the hero's label line, next to the value they re-scale; rendering the hero outside the card pushed them a row down. When a `headerSlot` is present the card footer is hidden — it printed the same range delta a second time. Other `PortfolioChart` mounts (item/group detail) pass no slot and are unchanged. The dashboard mount is `flat`: the design has no card around hero and chart.
- **The chart's `Area` fills from `baseValue="dataMin"`, not from zero.** In percent mode a portfolio that spent the whole range under its start has only negative values, and the default zero baseline sits above the visible domain — the band then rendered *over* the line and filled the top of the plot. This is a change to `PortfolioChart` itself, so it applies to every mount.
- **The "Portfolio Zusammensetzung" donut is no longer on the dashboard.** It answered the same question as the allocation bar directly above it, two blocks apart. `PortfolioCompositionChart` itself is untouched and still mounted in the item/group detail panel.
- **The scope switch moved out of the chart header into the head row.** One control per breakpoint: the chart's own switch and a second one on the page would disagree about which is authoritative.
- **The stat-card row and the Price-Sync card are gone.** Three of the four cards restated the hero (portfolio value) or a KPI; price freshness became the head row's "Preise vor Xm aktualisiert". The KPI band carries Gesamt-ROI, Gesamt Zuwachs, Positionen and Bestes Item.
  - The design's "Tages-P&L" has **no source** — the app keeps no intraday baseline — so it is not built. The hero's delta is the chart's range delta and carries the range label, exactly as on mobile (§5.1).
- **The "Watchlist Mover" panel is gone**, replaced by the design's right column. It was a second, differently-sourced mover list beside the portfolio movers; watchlist movers stay on the Watchlist tab.
- **The allocation ramp bottoms out at 0.42 opacity, not the design's 0.22.** The mock steps down over six evenly sized categories; a real portfolio is top-heavy, so the tail entries are already hairline slivers — at 0.22 the sliver and its legend dot both vanished, on exactly the rows that need a marker to be findable.
- **Allocation values format without `useUsd`.** `buildPortfolioAllocationByType` sums the rows' `currentValue`, which is already display currency — the same field every inventory surface formats plainly. The hero delta is the opposite case (USD, see §5.1.2).
- **Watchlist alarms count only rows that carry a target price** (`resolveWatchlistTarget`, §5.3.1), reached ones first, then by distance. The widget claims "N aktiv"; counting targetless rows would make that number the watchlist's size. No targets → no widget.
- The activity timeline (desktop-local `operations_log`, §5.1) expands 4 → 8 entries; the toggle only renders when there is a fifth entry to reveal.

### 5.1 Mobile dashboard (below `sm`)

`PortfolioOverviewSection` renders a second, mobile-only arrangement of the same data — scope switch, hero value, chart, KPI row, allocation bar, movers — while the desktop stat cards, watchlist-mover panel and composition donut become `hidden sm:…`. Three points are load-bearing:

- **The hero delta pairs `roiGainEuro` with `deltaPercent`, never `deltaValue`.** `PortfolioChart`'s `trendStats` computes `deltaValue` as the raw value change and `roiGainEuro` as the profit change; only the latter matches `deltaPercent`, because a deposit moves value and invested in lockstep and cancels out of the profit figure but not the value delta. `onTrendChange` therefore emits `roiGainEuro` too. Both are **USD** — see §5.1.2 for which figures on this page are and which are not.
- **Allocation uses `buildPortfolioAllocationByType`, not `buildPortfolioCompositionFromRows`.** The donut groups by item, which renders as thousands of hairline slivers in an 11px bar; the mobile bar groups by category.
- **Categories come from the catalogue, never from the row's own `type`** — `resolveItemCategory` / `resolveItemCategorySingular` (`portfolioCalculations.js`), shared by the allocation bar, the inventory type chip and the inventory category filter so the three cannot disagree about what an item is. `investments.type` is written by whichever importer created the row and defaults to `"skin"` (`localStore/investments.js`, `PortfolioService::mapInvestment`); one real portfolio held `"skin"` for Fever Case and `"case"` for Kilowatt Case, rendered 94 % containers as **"Skins · 100 %"**, badged every sticker "skin", and offered a category filter whose single "Skin" entry swallowed everything.
  - Preference order is authority order: **`catalogItemType`** (the `MarketItemClassifier` key — `skin`, `case`, `sticker_capsule`, `souvenir_package`, `agent`, …, newly exposed on the enriched row by `PortfolioService::getEnrichedInvestments` and carried through `desktopDataMerge`), then **`marketTypeLabel`** (the Steam market type already on every row), then the importer's `type` as a last resort.
  - The `marketTypeLabel` fallback is deliberately coarser: Steam types cases, capsules and souvenir packages all as "Container", so that path cannot separate them and calls all three "Cases". Until a server carrying `catalogItemType` is deployed, that is what the app shows.
  - **Categories are item kinds, not weapon classes.** Every weapon skin is one "Skins" bucket. Splitting it into Rifles / SMGs / Pistolen / Snipers answers no question the dashboard asks and fragments the bar; the earlier note that the design's legend (Messer, Rifles, Handschuhe) was unbuildable because "rows carry no weapon class" was wrong — `marketTypeLabel` does carry it — but the granularity was rejected on its own merits.
  - The tail beyond `ALLOCATION_MAX_CATEGORIES` (6) folds into one "Sonstige" slice. A real portfolio produces a dozen sub-percent kinds, each an invisible sliver with its own legend row.
  - Segments size by `flex: <value> 1 0`, not by a `flex-basis` percentage: rounded shares can sum past 100, and a fixed basis with no shrink overflows the `overflow-hidden` track and clips the last slice.
  - `formatAllocationShare` prints `<0,1 %` for a non-zero sliver rather than "0,0 %", and refuses to print "100 %" while other categories are listed.
- **Movers come from held positions (`selectPortfolioMovers` over `change7dPercent`), not the watchlist panel.** Rows without a `change7dPercent` are dropped rather than treated as flat — a missing history and a 0 % week are different, and conflating them buries real movers under ties.

The "Letzte Aktivität" timeline reads `operations_log` through `listOperations` (`localStore/sync.js` → IPC `local-store-list-operations` → preload → `PortfolioPage`). Three constraints shape what it may claim (details in `docs/local-db-schema.md` §7):

- **Desktop-only.** The server keeps no per-user operation log, so on web the block is absent, not rendered empty.
- **Newest row per entity.** Alert passes and edits each append another `upsert`; the raw log repeats one item a dozen times and buries everything else.
- **Manual edits only.** Imports and sync-apply deliberately write no operations, and `upsert` does not distinguish create from update — hence "hinzugefügt oder bearbeitet" rather than a claim the log cannot support.

### 5.1.1 Item names on mobile lists

Canonical names pack three things into one string (`★ StatTrak™ Karambit | Doppler (Factory New)`) and truncated to a phone row they lose the end, which is where the wear lives. `parseItemName` (`lib/itemName.js`) splits off the variant prefix and the wear; `ItemName` (`ui/item-name.jsx`) renders them as chips around a truncating name. Used by the dashboard movers, the inventory `PositionCard`, the watchlist card and `GroupWeightingList` — mobile surfaces only; desktop tables have the width for the full name.

The chips are `shrink-0` and the name truncates, deliberately: a portfolio routinely holds one skin in several conditions, so the wear distinguishes more per pixel than the tail of the skin name. The full canonical name stays available as the element's `title`.

Three guards in the parser, all because the name is not a reliable grammar:

- `Souvenir` is only a prefix at the **start** of the string — "Budapest 2025 Train Souvenir Package" is a container that merely contains the word.
- A trailing parenthesis is only a wear when it is one of the five real wears. Stickers and graffiti carry `(Glitter)`, `(Holo)`, `(Foil)` in the same position, and those are identity, not condition.
- The leading segment before `|` is dropped only when it names the item's **kind** (`KIND_PREFIXES`: Sticker, Patch, Music Kit, Sealed Graffiti, …), never when it names a weapon. "Sticker | Boom Blast" beside a "Sticker" chip says it twice; "USP-S | Alpine Camo" without the weapon is unidentifiable.

`parseItemName` therefore returns both `base` (kind kept) and `short` (kind dropped), and `ItemName` picks between them via `dropKindPrefix` — enabled on `PositionCard`, whose first meta chip is already the category, and off everywhere the category is not shown. The mobile "Bestes Item" KPI tile uses `short` directly: it is a third of a phone wide, and the variant prefix plus wear are exactly what pushed the name out of view.

### 5.1.2 Currency: rows are EUR, the chart is USD

The dashboard prints figures from two sources that are **not in the same currency**, and no field name reliably says which. Format by provenance:

| Source | Currency | Formatter | Fields |
|---|---|---|---|
| Enriched investment rows | **EUR** | `formatPrice(x)` | `livePrice`, `baseLivePrice`, `displayPrice`, `currentValue`, `buyPrice`, `totalInvested`, `profitEuro`, `breakEvenPrice(Net)`, `breakEvenDeltaEuro`, `costBasisTotal/Unit`, `netPositionValue`, `netProfitEuro`, `change24h\|7d\|30dEuro` — and everything summed from them: all of `calculatePortfolioSummary`'s `stats.*`, `allocationByType[].value`, the `portfolioGroups.js` group/cluster aggregates and their `ItemDetailPanel` aliases |
| Portfolio history / chart | **USD** | `formatPrice(x, { useUsd: true, buyPriceUsd: x })` | `portfolioHistory.wert`/`invested`, `chartTrendData.deltaValue`/`roiGainEuro`, the `onHoverChange` payload's `wert`/`profitEuro` |
| Direct USD columns | **USD** | same as above | `buyPriceUsd`, `buyOrderBestPriceUsd`, `alertPriceUsd`, `alertAnchorPriceUsd` |

The row side is EUR because every price descends from `PricingService`'s `priceEur` (`priceUsd * usdToEurRate`), including the change baselines (`PriceHistoryRepository::findLatestPriceMapByItemIds` multiplies before returning) and `buyPrice` (`buy_price_usd * usdToEurRate`). The chart side is USD because `PortfolioService::getHistory` reads `portfolio_history.total_value_usd` and says so at the source.

**Both naming conventions lie, in opposite directions**: `stats.totalProfitEuro` and the row `profitEuro` really are EUR; `chartTrendData.roiGainEuro` is USD. Never infer the currency from the suffix.

Consequences that are easy to get wrong:

- **The hero is the one place both meet.** `headerPortfolioValue` is the hover payload's `wert` (USD) or `stats.totalValue` (EUR); `headerProfitEuro` walks a four-branch chain that lands on history (USD), `stats.totalProfitEuro` (EUR) or the chart's range delta (USD). `PortfolioPage` therefore carries `headerPortfolioValueIsUsd` / `headerProfitIsUsd` alongside the values, and the formatter follows the flag. Formatting the page as one currency is what printed a 1.329 € hero beside an allocation legend summing to 1.538 € — the same portfolio, one side divided by the USD rate a second time.
- **Never subtract across the boundary.** The hero's hover fallback (`value − stats.totalInvested`) lifts the invested side into the value's currency first; a difference between two currencies is wrong in both.
- **`PortfolioOverviewSection` exposes exactly two helpers**, `formatChartUsd` and `formatRowEur`, so each call site has to state which source it is printing.

Two places used to mix the currencies **arithmetically**, where no formatter flag can help. Both are closed, and the shape of the fixes is the rule to follow:

- `scopedPortfolioHistory`'s `"all"`-scope factor is now an EUR/EUR ratio of live rows (`liveScopeScaleFactors`), so it is **dimensionless** and can be applied to the USD series without mixing anything. The earlier `stats.totalValue / lastSnapshotValue` divided EUR by USD — the currency gap alone cleared the 3 % guard, so the curve was rescaled in that scope every time.
- `buildDesktopPortfolioLocalSnapshot`'s history seed only fires when the rows carry a price, which local rows do not — so the EUR `summary.totalValue` no longer reaches the USD `wert` field.

The rule both follow: **cross the boundary with a ratio or not at all.** Where a USD and an EUR figure genuinely have to meet (the hero's hover fallback), convert one side explicitly first.

The structural fix that would remove the boundary altogether is to convert `portfolioHistory` to display currency **once** at load and drop `useUsd` from the chart path; that touches `PortfolioChart`, Year Wrapped and the `portfolio-view-snapshot:*` cache keys, so it stays a separate change.

### 5.6 Internationalisation (i18n)

Two languages: **English is the source, German is a translation of it.** The
fallback chain is `de → en`, so a missing German key yields a complete English
string rather than a raw key path.

- **Catalogues are bundled, never fetched** (`import.meta.glob` in
  `packages/shared/src/lib/i18n/index.js`). The desktop runtime loads from
  `file://` and must work with no network, which rules out an HTTP backend.
  Consequence: adding a new locale JSON file needs a dev-server restart, since
  the glob is resolved at transform time.
- **Namespaces mirror the surfaces in this document** — `common`, `dashboard`,
  `portfolio`, `management`, `inventory`, `watchlist`, `search`, `settings`,
  `updates`, `wrapped` — so a catalogue file maps onto one screen.
- **Two readers, and the difference matters.** Components use
  `useTranslation(ns)`, which subscribes and re-renders on a switch.
  Module-level pure functions (`formatAge`, `resolveItemCategory`,
  `buildMetaLine`, the `deriveMarketImpact` tables) have no context to read
  from and use `translate("ns:key")`, which does **not** subscribe. That is why
  `translate` is safe in helpers called *from* a translated component and wrong
  as a component's only translation call.
- `LanguageProvider` owns persistence (`localStorage` `preferred_language`),
  navigator auto-detect and the document's `lang` attribute. It is the
  outermost app provider, above `AppErrorBoundary`, whose own copy is
  translated too.

**Formatting follows the UI language, not the OS.** `getActiveIntlLocale()` is
the single source for every `Intl.*` call. It keeps the user's own region when
that region agrees with the chosen language (`en-GB` dates for a British user
reading English) and falls back to the language default otherwise. Before this
existed, `CurrencyContext` resolved its locale from `navigator.language` while
all 30+ date and sort sites were hardcoded `de-DE`, so an English-locale user
already saw English numbers next to German dates. `CurrencyProvider` takes
`locale` from the context rather than calling the module reader, because a
memoised formatter has to be invalidated when the language changes.

Three rules that are easy to get wrong, each of which was a real defect:

- **Never `toFixed().replace(".", ",")`.** That swap was applied
  unconditionally in eight places and printed German commas into English copy.
  `formatNumber` / `formatPercent` / `formatSignedPercent` in
  `portfolioHelpers.js` are the locale-aware replacements.
- **Never key state or grouping on a translated label.** The inventory and
  watchlist category filters keyed on `resolveItemCategory(item).toLowerCase()`
  — a language-dependent grouping key, so the active filter would reset on a
  switch. `resolveItemCategoryKey` returns the stable id; `resolveItemCategory`
  and `resolveItemCategorySingular` translate it. The singular form used to be
  a map keyed by the *German plural* ("Skins" → "Skin"), which would have
  silently fallen back to the plural in every other language.
- **Never lowercase a noun into a sentence.** The desktop movers list built
  `Keine ${label.toLowerCase()} im …`, which is wrong in German — nouns are
  capitalised. Sentences that embed a label need their own key per case.

What the platform already knows is not translated: month abbreviations come
from `Intl.DateTimeFormat(locale, { month: "short" })` (`getMonthLabels()`),
and currency/region names from `Intl.DisplayNames`. Brand names (CSFloat,
SkinBaron, Steam) and acronym expansions (`ABBREVIATIONS.short`/`.full`) stay
literal.

Persisted notification text is a separate problem with its own contract — see
`docs/local-db-schema.md` §3.1.

`DesignSystemPage.jsx` and `csUpdatesFeed.mock.js` are deliberately
untranslated: the first is a builder's tool reached only by URL, the second is
fixtures.

### 5.2 Mobile inventory (below `md`)

`InventoryTable` already carried a card list below `md`; it now renders the design's position card (`ui/position-card.jsx`) instead of `ItemListRow` — thumb, name with optional GRUPPE badge, meta chips (type, quantity, average buy) and a right column of live value plus ROI pill. `ItemListRow` stays as-is: it is the watchlist/search shape and is shared by three surfaces, so folding both into one component would mean a prop per screen.

- **The category filter is duplicated into `PortfolioInventorySection` below `lg`.** It lives in `FilterSidebar`, which is desktop-only — without the inline chip row it was simply unreachable on mobile.
- **The mobile sort is one cycling button, not a chip strip.** Four sorts as chips ate a full row on a 380px screen.
- **Wallet / Cash-In chips are rendered disabled and `SoonBadge`-marked.** Rows carry a `fundingMode`, but no surface filters on it yet.
- **Positions and groups are counted separately** (`unfilteredItemCount` next to `unfilteredCount`): `sortedRows` holds both kinds, and one combined figure contradicted the section header's own "39 Positionen · 1 Gruppe".

The design's detail bottom sheet needed no work — `ItemDetailsModal` on `BaseModal` already docks to the bottom with a grab handle below `BREAKPOINTS.MOBILE`. Two things inside it did:

- **A group's `Cluster-Gewichtung` renders as a ranked bar list below `sm`, as a donut from `sm`** (`GroupWeightingList`, mounted next to `PortfolioCompositionChart` in `ItemDetailPanel`). Both read the same `item.clusters`; neither derives anything the other does not. The donut is the same failure mode as the dashboard allocation bar — a 21-cluster group at 380px is hairline slivers — and the bar row additionally carries the euro value and the per-cluster ROI, which a donut cannot show at once. The list shows the top 5 by value, collapses the tail into one "Rest" row and expands to a scroll box on demand: a 40-cluster group otherwise buries the toggle under a full screen of 6px bars. Shares come from the precomputed `sharePercent` (`portfolioGroups.js`), not from re-summing `totalValue`, so unpriced clusters cannot make the rows add up to more than the group. The rows are **clusters, not positions** — the noun matters, because the same card header prints a much larger position count ("21 CLUSTER · 90 POSITIONEN").
- **Exclusion is confirmed on mobile too**, through the existing `ExcludeInvestmentDialog` the desktop inspector already uses, rather than firing on the button press. Exclusion silently removes the position from portfolio value, ROI and every evaluation, and on a phone that button sits under a thumb that is already scrolling. Reusing the desktop dialog rather than building the design's bespoke sheet keeps one wording for one decision.

### 5.2.1 Mobile screens still blocked on data

One element from `Mobile Final.dc.html` is still deliberately rendered inert and `SoonBadge`-marked rather than built, because no read path exists for it. It is not an oversight and must not be filled with invented rows:

- the search filter sheet's "Nur Items im Bestand" toggle, which needs an ownership join the search endpoint does not offer (see §5.4).

The dashboard's "Letzte Aktivität" timeline (§5.1) and the filter sheet's price range (§5.4) were built out and are no longer placeholders.

### 5.3 Mobile watchlist (below `md`)

Category text and the category filter chips go through `resolveItemCategory` like the inventory's, but the watchlist reaches it by a different route and lands in a weaker fallback. `WatchlistRepository::findAll` joins `items` and selected only the legacy `it.type` column, which carries the same defect as `investments.type` (it holds `'skin'` for most containers, `'other'` for plenty of skins). It now also selects `it.item_type` / `it.market_type_label`, which `WatchlistService` passes into `WatchlistItemDto` as `catalogItemType` / `marketTypeLabel` (both nullable with defaults, so existing positional construction is unaffected).

**Until a server carrying those fields is deployed the watchlist still miscategorises**, because — unlike the enriched investment rows — a watchlist row has no `marketTypeLabel` to fall back to and drops all the way to `type`. The desktop merge needs no change: it spreads the upstream row over the local one, so the fields appear on their own once the server sends them.

The card list drops `ItemListRow` for the design's watch card: thumb, name, type, and a right column of live price, sparkline and a 7-day delta pill. Category and Zeitraum chips are duplicated inline, since both live in the desktop-only `FilterSidebar`, and the sort becomes one cycling button (skipping `soon` options, so cycling cannot land on a sort that will not run).

- **The delta pill is always `d7` and is labelled "7T".** The Zeitraum chips govern the sparkline window only — the same split the desktop Verlauf column uses — and there is no `d90` field, so a pill quietly falling back to `d7` under a "90 Tage" chip would claim a window it is not showing.
- **The card's target-price half is live** — target, remaining distance and progress bar — as are the "Mit Alarm" scope and the "Abstand zum Ziel" sort. See §5.3.1.

#### 5.3.1 Zielpreis (target price)

A watchlist target is four fields that are only meaningful together: `alertPriceUsd`, `alertDirection` (`below` = buy target, `above` = sell target), `alertAnchorPriceUsd` and `alertTriggeredAt`. They live in the desktop `watchlist_items.payload` blob (no DDL, like the investment overpay fields) and, server-side, in `watchlist.alert_price_usd` plus a new `alert_meta_json` column. Five points are load-bearing:

- **`alert_price_usd` used to be written as a literal `NULL`** on insert *and* re-applied through `ON DUPLICATE KEY UPDATE`, so any value from another path was wiped on the next sync. `SyncEntityService::applyWatchlistChange` now reads the payload, and `mergeTargetFieldsForWatchlistSync` carries existing values forward when the incoming payload omits them — the same contract as `mergeExcludedFlagsForInvestmentSync`. Without that merge, one push from a client that predates the feature clears a target set on another device.
- **The direction is stored, not derived.** It is *defaulted* from the price relation at save time (`suggestTargetDirection`), but deriving it at evaluation time would silently flip a sell target into a buy target as soon as the price crossed it.
- **The anchor is the progress bar's denominator.** "How far has the price travelled" is only answerable against where it started, so the live price is captured once at save time. Without an anchor the bar renders empty (`progressPercent: null`) rather than at 0 % — zero is a claim about the price, null is the absence of one.
- **Comparisons are USD, and never against `currentPrice`.** That field is already EUR (`PriceHistoryRepository` multiplies `price_usd` by `usd_to_eur`), so `resolveWatchlistLivePriceUsd` takes the live price from the USD price history instead. Mixing the two would fire every alert roughly 8 % early. Input is in display currency and converted with `convertToUsd` at the boundary, like the manual buy-price field.
- **`enrichDesktopWatchlistWithUpstreamMetrics` needs an explicit local-wins line.** It spreads upstream over local, and a server that predates the field sends `alertPriceUsd: null` — that would clear the user's target on every watchlist load. Same guard as `preservePortfolioGroupColors` (§4.1).

Alerts are evaluated in the desktop branch of `fetchWatchlistData` after the upstream merge (the decision lives in `lib/watchlistTargets.js`; the gateway only persists the outcome) and file a `price_target` notification into `sync_notifications`. **Only transitions are written**: `upsertWatchlistItem` flips `dirty=1` and appends to `operations_log`, so writing on every load would generate sync traffic for an unchanged portfolio — and `createNotification`'s dedupe cannot absorb the repeats, because it keys on title+message and the message carries the ever-changing price.

### 5.4 Mobile search (below `sm`)

`ItemSearch` already had the design's grid/list switch, chip filters and pagination; the mobile work was overflow, not structure.

- **The toolbar and the category chips scroll sideways instead of wrapping.** Ten chips wrapped to four rows at 380px and the toolbar to three, so the first result sat below the fold.
- **The view switch stays outside that scroller, pinned right.** Scrolled out of sight it reads as missing, and it is the only route to the list view.
- **List rows stack below `sm`.** The four fixed columns (`120px 140px 150px`) overflow a 380px screen: the name column collapsed to nothing and the action button was clipped off the right edge. The column header is hidden there, since it labels columns that no longer exist, and the condition moves into the sub-line — but `sm:hidden`, or it prints twice next to the Condition column on desktop.

- **The filter bottom sheet (mobile only) carries all four of the design's groups**, reusing `BaseModal` — which already docks to the bottom with a grab handle below `sm`, so no second sheet implementation exists. Kategorie, Zustand and **Preis in €** act; only **Nur Items im Bestand** stays disabled and `SoonBadge`-marked, since it needs an ownership join the endpoint does not offer. The filter badge counts only the filters that can narrow a request, so the disabled group cannot inflate it. From `sm` the sheet is gone and the chip row plus Condition select are inline — one route to each control per breakpoint, never two.
- **The price range is debounced before it reaches the request**, since the two bounds are free-text inputs; without it every keystroke fires a search. Bounds are entered in EUR and converted to USD server-side (contract details in `backend/MVC_API_CONTRACT.md`); a bounded search drops items with no cached price, which the sheet states rather than leaving the narrower result unexplained. `backend/desktop/index.php` proxies search upstream through a **param whitelist** — a new query param must be added there too or the desktop app silently discards it.

### 5.5 Mobile settings (below `lg`)

`SettingsPage` is two-staged on mobile — category list, then detail — instead of stacking the full list above the active panel, which meant scrolling past six entries to reach the one just tapped.

**The stage is derived from the URL, not from component state**: `searchParams.has("cat")` decides it. `selectCategory` already wrote `?cat=`, so the back control, a deep link (`#/settings?cat=conn`) and the browser's own Back button cannot disagree about which stage is showing — a separate `useState` would have desynced from all three.

From `lg` both panes render as before; the back control is `lg:hidden`. The header's action row (`StatusPill` + save + discard) wraps below `sm`, where it used to run off the right edge and cut "Verwerfen" in half.

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
- Manual Steam↔external linking exists alongside the scorer: `createManualSteamCsfloatMatch` writes a `manual_confirmed` row (reason `manual_link`, score 0) through the same UNIQUE-key upsert and `applySteamCsfloatMatchLink` resolution as automatic matches, so manual and automatic links converge on one representation. It is reachable from the Matching tab's "Manuelles Matching" overlay, which offers only positions not already in a resolved match.
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
- **Cloudflare Access has exactly two owners**: `apps/desktop/main/cloudflare-access.js` (cookie jar, identity, login window, IPC `cloudflare-access-login`) and `packages/shared/src/lib/cloudflareAccess.js` (challenge detection, coalescing, `fetchWithCloudflareAccess`). `auth.js`, `desktopSync.js` and `api/core.js` are callers only. They previously each carried their own detector and login call, which is what produced the popup loop: `auth.js` classified *any* `text/html` + `server: cloudflare` response as a challenge with no status check, so a plain HTML 404/502 from the origin opened a login window — and that window clears the Access cookies before it loads.
- Desktop sidecar upstream proxy authenticates through the Cloudflare Zero Trust tunnel by forwarding the renderer's CF Access cookie. The Electron header bridge (`apps/desktop/main/sidecar.js`) injects the cookie as `X-Upstream-Cf-Cookie` on every renderer→sidecar request; `backend/desktop/index.php` promotes that header into `UPSTREAM_COOKIE_HEADER` per request so `$proxyUpstreamGet` sends it as the upstream `Cookie:` header.
- **That forwarded copy tracks `defaultSession`, it is not a snapshot.** `trackCloudflareAccessServer(serverUrl)` primes it at startup (and on a server-URL change) and subscribes to `cookies.on("changed")`, so a Cloudflare rotation of `CF_Session` during normal renderer traffic reaches the sidecar too. As a one-shot snapshot the copy went stale on the first rotation, every proxied read then got the CF login HTML, and the renderer prompted a login for a session that was still valid.
- When the CF cookie is missing/expired the proxy returns `meta.upstreamHint.code = "CLOUDFLARE_ACCESS_LOGIN_REQUIRED"` (detected via the curl effective URL landing on `*.cloudflareaccess.com` / `/cdn-cgi/access/`). The renderer escalates in **two steps**: a silent `ensureCloudflareAccessLogin()` (main re-reads the jar, republishes it, and returns without a window when a valid identity exists) plus one retry, and only if the hint survives that, a `{force: true}` login window plus a final retry. A forced attempt arms a 60s cooldown, cleared as soon as a response comes back without a challenge.
- The login window is destructive by design — `clearStaleCloudflareAccessCookies` runs before it loads, because a stale `CF_Authorization` would otherwise let the poll "succeed" instantly. That is exactly why it must be the *last* resort: opening it on a false-positive challenge logs the user out of Cloudflare, and the silent SSO that follows (the IdP cookie on `*.cloudflareaccess.com` is deliberately preserved) re-mints the token in under a second — the window visibly flashes open and shut.
- `hasCloudflareAccessIdentity` reads the jar directly: a non-expired `CF_Authorization`/`cf-access-*` for the origin, and no *expired* `CF_Session` alongside it (that pair is what surfaces as "Invalid login session" on every request). `cf_clearance` and `__cflb` are not identity — CF sets them on the first page load, before authentication. The former renderer-side `/cdn-cgi/access/get-identity` preflight is gone: it ran before every sync request, returned `true` for nearly every outcome, and challenge detection covers the same ground for free.
- Cloudflare cookies are **not** written to `desktop-session.json`. That file is the Steam session store (`session-store` IPC), whose `set` action overwrites it wholesale — the CF entry was write-only and was dropped on the next Steam login anyway.
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

- **The inventory sparkline is a separate, day-bucketed read.** `findDailyPriceSeriesMapByItemIds` collapses `price_history_hourly` to one AVG per item per day **in SQL**, because the existing `findHistoryMapByItemIds` returns raw hourly rows — a 30-day window over a 50-item portfolio is ~36k rows to ship and re-bucket in PHP on every portfolio load, for a curve that draws ~30 points. It is exposed as `priceSparkline` on the enriched row (`null` below two samples: one point renders as a flat line and reads as "price unchanged").
  - **USD, deliberately not FX-converted.** The series is normalised against its own min/max at render time, so it plots *shape*, not magnitude — a per-row exchange-rate join would change nothing on screen. This is the one intentional exception to formatting by provenance (§5.1.2), and it holds only because the value is never printed.
  - **The window is 30 days, matching the item detail chart's default range.** A 90-day sparkline would show a different curve shape than the chart that opens directly beside it.

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
| `docs/design-system.md` | FINAL | CURRENT | UI token/primitive library + the tokens-only colour rule. |
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
