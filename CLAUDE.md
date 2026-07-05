# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Start of Every Session

1. Read `docs/architecture-overview.md` — it is the single authoritative architecture reference.
2. For backend changes, inspect `backend/public/index.php` and the relevant Service/Repository files first.

## Commands

```bash
npm run dev           # Vite watch + Electron (primary dev command)
npm run electron      # Run Electron only (no Vite rebuild)
npm run build         # clean + vite build + electron-builder (NSIS installer → release/)
npm run build:web     # Web-only Vite build
npm run lint          # ESLint 9 flat config (JS/JSX only)
npm run docs:guard    # Documentation governance check — REQUIRED before every push
npm run preview       # Vite preview server
```

No test suite is configured. Playwright is a devDep but there is no `test` script.

## Monorepo Structure

| Package | Path | Description |
|---|---|---|
| Root | `.` | Electron build config, shared tooling |
| Shared | `packages/shared/src/` | React components, hooks, contexts, lib, pages |
| Web App | `apps/web/src/` | SPA/PWA entry (`main.jsx`, `App.jsx`) |
| Desktop | `apps/desktop/` | Electron `main.js`, `preload.js`, SQLite localStore |
| Backend | `backend/` | PHP — two front controllers + shared `src/` |

**Import aliases** (Vite + jsconfig):
- `@shared/*` and `@/*` both resolve to `packages/shared/src/*`

**Two PHP entry points:**
- `backend/public/index.php` — Server (web, sync, public API)
- `backend/desktop/index.php` — Desktop Sidecar (127.0.0.1, no MySQL required)

PHP autoloader (`backend/src/bootstrap.php`): PSR-4-style, maps `App\` → `backend/src/`. No Composer, no framework — custom Router and DI container.

## Architecture

**Desktop Runtime (primary write client)**
- Electron main process spawns a PHP sidecar on `127.0.0.1` (dynamic port).
- All sidecar requests require the per-start `X-Desktop-Sidecar-Secret` header. Exception: `GET /api/v1/auth/steam/callback` (external browser redirect).
- SQLite (`cs-investor-hub.sqlite`) at Electron `userData`. Renderer accesses it only via `window.electronAPI.localStore` IPC — never directly.
- CSFloat/SkinBaron API keys live exclusively in the password-gated Secret Vault (Electron main process RAM after unlock). Never in `.env`, SQLite, or on the server.

**Web Runtime** — server APIs only, no desktop-local secrets.

**Data Ownership**

| Domain | Write Owner | Storage |
|---|---|---|
| Investments / Watchlist | Desktop | SQLite + synced to server |
| Prices | Server cron (`sync-prices.php`) | MySQL |
| Import triggers | Desktop-initiated | Desktop |

**Frontend lib layer** (`packages/shared/src/lib/`):
- `dataSource.js` — runtime gateway: selects desktop vs web path, merges local + upstream. Contains no business logic.
- `apiClient.js` — domain-split API barrel (investments, watchlist, settings, sync, auth).
- `localCache.js` — 120-second TTL in-memory snapshot cache, user-scoped to prevent account-switch leaks.
- `desktopSync.js` / `desktopDataMerge.js` — sync orchestration and local+upstream enrichment.
- `portfolioCalculations.js` — summary, clustering, filtering, composition (pure functions).

## Critical Rules

### Data Persistence
- **Currency**: persist USD; compute EUR at runtime. Never store `price_eur` columns.
- **Item references**: always use `item_id`, never string-based names.
- **History tables**: no precomputed aggregates — compute values in Services.
- **Exchange rates**: reference `exchange_rate_id`, never redundant price columns.
- **`items` catalog**: server-owned and read-only except for the CLI cron price path — `backend/sync-prices.php` and `backend/sync-price-queue-worker.php` (both require `ITEMS_CATALOG_WRITE_SCOPE=cron`; the worker also backfills catalog metadata like images).

### Desktop Local-First
- Desktop is the sole write client for investments and watchlist.
- All local writes must populate `operations_log` for idempotent sync push.
- User scope is always `steam-<steamId>`. The legacy scope `"1"` is auto-merged on first access — do not use it.

### Auth / User Scope
- Server enforces `userId`/`steamId` in every request matches the authenticated Steam session (`RequestUserScopeResolver`). Foreign scopes → `401/403`.

### Frontend Visual Rule
All color gradients (shells, sidebar, hero, panels) must use the avatar-derived Steam palette:
- Source: `packages/shared/src/components/SteamLoginPrompt.jsx` (`deriveSteamPaletteFromUser`)
- CSS variables: `--steam-shell-color-a` through `--steam-shell-color-d`
- Static fallback gradients only when avatar data is unavailable.

### No PHP→JS Migration
PHP business logic stays in `backend/src/`. `dataSource.js` only selects runtime/URL, never reimplements logic.

### README.md Governance
`README.md` must only contain: install/setup, `npm run` commands, screenshots, disclaimer.
Never add architecture, sync strategies, DB schemas, roadmaps, or technical decisions to it.

## Structural Changes Require Same-Commit Updates

When any of the following change, update both `AGENTS.md` and `docs/architecture-overview.md` in the same commit:
- Top-level structure or central directories
- Service/Repository/Controller boundaries
- Data model rules
- Auth/session strategy

New `.md` files must be registered in the Active Docs table in `docs/architecture-overview.md`.

Run `npm run docs:guard` before every push. CI enforces this via `.github/workflows/docs-governance.yml`.

## Release Workflow

1. Commit feature changes.
2. Clean working tree.
3. Bump `package.json` version + `package-lock.json`.
4. Commit: `release: vX.Y.Z` (version bump only).
5. Create tag `vX.Y.Z` (must match `package.json`).
6. Push branch + tag → triggers `.github/workflows/desktop-release.yml` (NSIS installer build).

## Key Reference Docs

| File | Purpose |
|---|---|
| `docs/architecture-overview.md` | Central architecture + doc navigator |
| `docs/local-db-schema.md` | SQLite schema |
| `backend/MVC_API_CONTRACT.md` | Backend API contract |
| `docs/sync-api.md` | Sync protocol |
