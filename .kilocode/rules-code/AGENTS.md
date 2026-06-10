# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## PHP Backend (Non-Obvious)

- **`declare(strict_types=1)` required** at top of every `backend/src/` file — visible in [`bootstrap.php`](backend/src/bootstrap.php:2), every Service, Controller, Repository.
- **Final classes by convention** — every Service, Controller, Repository, and DTO is `final class` (no extension). See [`PricingService`](backend/src/Application/Service/PricingService.php), [`PortfolioController`](backend/src/Http/Controller/PortfolioController.php), [`JsonResponseFactory`](backend/src/Shared/Http/JsonResponseFactory.php).
- **`JsonResponseFactory::success()`/`error()`** — the only way to return JSON from controllers. Never `echo json_encode(...)` directly. Uses custom envelope format `{data, meta}` / `{error}`.
- **DTOs must implement `toArray()`** — e.g. [`PortfolioSummaryDto`](backend/src/Shared/Dto/PortfolioSummaryDto.php), [`WatchlistItemDto`](backend/src/Shared/Dto/WatchlistItemDto.php). Used by `JsonResponseFactory` for serialization.
- **`Logger::event()` as primary API** — not `Logger::info()`. Call signature: `Logger::event($level, $category, $event, $message, $context)`. The convenience methods (`info`, `error`, `debug`, `warning`) exist but forward to event-based observability when available.
- **Custom PSR-4-like autoloader** — [`bootstrap.php`](backend/src/bootstrap.php:57-72) maps `App\` → `backend/src/`. No Composer autoloader, no `vendor/` directory.
- **No Composer. No framework.** Custom Router, DI, Logger. No Laravel/Symfony packages in `backend/`.
- **Two PHP entry points, same `backend/src/` namespace**: [`backend/public/index.php`](backend/public/index.php) (server, MySQL) + [`backend/desktop/index.php`](backend/desktop/index.php) (sidecar, SQLite via IPC). Both require `bootstrap.php` from different relative paths.
- **No barrel exports in PHP** — each file `require_once`s only what it needs. Unlike the frontend convention.

## Frontend (Non-Obvious)

- **`@shared/*` and `@/*` map to the same target** — both resolve to `packages/shared/src/`. Configured in [`vite.config.js`](vite.config.js), [`jsconfig.json`](jsconfig.json), `apps/web/vite.config.js`.
- **No barrel export (`index.js`)** in `packages/shared/src/`. Each file imports directly from its source module path.
- **`dataSource.js` is the single data gateway** — never import `apiClient.js` or `localStore` directly from components. [`dataSource.js`](packages/shared/src/lib/dataSource.js) selects runtime (desktop vs web) and merges local + upstream data.
- **120s cache TTL** in [`localCache.js`](packages/shared/src/lib/localCache.js) for portfolio data. `CsFloatBuyOrders` has its own key `cache:csfloat:buyorders`.
- **Portfolio composition is always USD** — all `buyPrice` columns store USD. EUR is computed at runtime via exchange rate lookup.

## ESLint

- **ESLint 9 flat config** — [`eslint.config.js`](eslint.config.js). JS/JSX only. Ignores `apps/web/dist/`, `node_modules/`, `.git/`, `*.mjs`.
- **`no-unused-vars` exempts UPPER_CASE** — pattern `"^_[a-zA-Z0-9]*$"` and variables starting with `_` are ignored.
