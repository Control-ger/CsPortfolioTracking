# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Quickstart
1. Read `docs/architecture-overview.md` first — it is the central architecture reference.
2. Keep architecture/plans out of `README.md` (setup/screenshots only).
3. Before push: run `npm run docs:guard`.

## Commands
```bash
npm run dev           # Vite build watch + Electron
npm run build         # clean + vite build + electron-builder
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
- Sidecar starts on `127.0.0.1` with per-start secret (`X-Desktop-Sidecar-Secret` header required). Exception: `GET /api/v1/auth/steam/callback` is public (external browser redirect).
- Sidecar uses the host system PHP and requires the `mbstring`, `curl`, `json` extensions; `backend/desktop/index.php` returns a `PHP_EXTENSION_MISSING` error at startup if any are missing.
- User scope: `steam-<steamId>`, never legacy `"1"`. Legacy data auto-merged on first access.
- Secrets (CSFloat/SkinBaron keys) live only in the app-password-gated Secret Vault (Electron main process RAM after unlock). Never in `.env`, SQLite, or server.

### Auth/User Scope
- Server enforces that `userId`/`steamId` in requests MUST match the authenticated Steam session (`RequestUserScopeResolver`). Foreign scopes → `401/403`.
- Desktop sidecar forwards `Authorization`/`X-Auth-Token` to server upstreams so scope checks remain effective.

### Data Ownership Layers
| Layer | Writes | Reads |
|---|---|---|
| Investments/Watchlist | Desktop only | Desktop + Web (via sync) |
| Prices | Server cron only | Desktop (via sidecar) + Web |
| Import triggers | Desktop-initiated | Desktop |

### Pricing Rules
- Canonical, source-aware price tables: `item_live_cache` (`PK item_id, price_source`) and `price_history_hourly` (`PK item_id, bucket_start, price_source`). Written **only** by the cron (`backend/sync-prices.php` bulk import + CLI queue worker).
- Passive reads never live-fetch: `PortfolioService::getEnrichedInvestments` defaults to `allowLiveRefresh=false`; investments/summary/composition/watchlist serve the last known price immediately. The cron is the sole price updater for web users.
- The web frontend makes **zero** external price calls: the old `PortfolioPage` auto-trigger that called `refresh-stale` (→ CSFloat) on stale prices was removed, along with the `refreshPortfolioStalePrices*` client wrappers. Do not reintroduce a web-initiated live price fetch — price freshness is cron-owned. (The desktop write-client and the CLI queue worker keep their own live-fetch paths.)
- Passive reads also skip the Steam Market catalog metadata fetch: `PricingService::getCatalogEntry` honors `allowLiveRefresh` and, when off, serves the existing (possibly stale/partial) catalog row instead of calling `SteamMarketClient::findExactItem` per item. Catalog metadata (image/labels) is backfilled solely by the cron — a passive page read must never make a synchronous external call.
- The dormant "scaling" price mirror (`item_price_latest`, `item_price_history_hourly`, `ScalingShadowReadService`, `SCALING_*_READ_ENABLED` flags) was retired; `user_positions`/`position_events`/`portfolio_snapshots_daily` remain for the future read-model.

## Release Workflow
"Release" means Electron release (not just git push):
1. Commit feature changes with descriptive messages.
2. Clean working tree.
3. Bump `package.json` version + `package-lock.json`.
4. Commit: `release: vX.Y.Z` (version bump only, features already committed).
5. Create tag `vX.Y.Z` (must match `package.json`).
6. Push branch + tag → triggers `.github/workflows/desktop-release.yml`.

## Documentation Governance
Global changes require same-commit updates to both `AGENTS.md` and `docs/architecture-overview.md`.
Run `npm run docs:guard` before push. CI enforces via `.github/workflows/docs-governance.yml`.
No new `.md` files without entry in the Active Docs table (see `docs/architecture-overview.md` §7).

## Aktive Docs
| File | Status | Purpose |
|---|---|---|
| `docs/architecture-overview.md` | FINAL | Central architecture + doc navigator |
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
