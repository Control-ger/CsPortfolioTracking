# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Architecture (Non-Obvious)

- **PHP sidecar is permanent, never transitional** — the desktop runs a PHP sidecar (`backend/desktop/index.php`) on `127.0.0.1` for local operations. This is by design, not a temporary migration artifact. No plans to port its logic to Node.js/Electron.
- **No PHP→JS migration path** — PHP business logic stays in `backend/src/`. `packages/shared/src/lib/dataSource.js` only selects runtime and URL, never implements business logic. The frontend never duplicates PHP calculations.
- **`items` table is server-cron-only write** — `backend/sync-prices.php` (CLI cron) is the only process that writes to the `items` catalog table, guarded by `ITEMS_CATALOG_WRITE_SCOPE=cron`. Normal API requests read-only via repositories.
- **Two PHP front controllers sharing one `backend/src/`** — [`backend/public/index.php`](backend/public/index.php) (MySQL, full API) and [`backend/desktop/index.php`](backend/desktop/index.php) (SQLite via Electron IPC) both `require` the same [`bootstrap.php`](backend/src/bootstrap.php). DI wiring is duplicated in both; keep them in sync.
- **`operations_log` for idempotent sync** — every local write to SQLite must fill `operations_log` entries. The sync push mechanism uses this log for idempotent replay to the server. Missing `operations_log` entry = data never syncs.
- **`dataSource.js` selects runtime, never implements logic** — it's the gateway that decides web API vs desktop IPC, then merges results. All calculation (portfolio summary, clustering) happens client-side in `dataSource.js` helper functions like `calculatePortfolioSummary()` and `clusterDesktopInvestments()` — but never duplicates backend domain logic.
- **`@shared/*` and `@/*` are the same target** — both resolve to `packages/shared/src/`. The dual alias exists for legacy compatibility. New imports can use either.
- **Secret Vault architecture** — API keys (CSFloat, SkinBaron) live only in Electron main process RAM, gated by app password. Never in `.env`, SQLite, or the server. The sidecar receives them via `X-Desktop-Sidecar-Secret`-protected IPC.
