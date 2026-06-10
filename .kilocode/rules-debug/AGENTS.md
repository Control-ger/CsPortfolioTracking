# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Debug (Non-Obvious)

- **Sidecar `X-Desktop-Sidecar-Secret` required** on all desktop sidecar routes except `GET /api/v1/auth/steam/callback`. Missing/incorrect secret → `503` or `401`. The secret is generated per-start in Electron `main.js`, never stored or logged.
- **Log paths** — PHP backend writes to `/var/www/html/logs/app.log` (file) AND `php://stderr` (Docker). See [`Logger::logLegacy()`](backend/src/Shared/Logger.php:74-98). The file sink is the fallback path; the observability service is primary.
- **Frontend telemetry** — disabled by default in [`App.jsx`](apps/web/src/App.jsx). Only enabled if `getSetting('telemetryEnabled')` is truthy. Hard-disabled in debug/dev.
- **Electron IPC gating** — `window.electronAPI.localStore` is only available in the Electron renderer. In the web app, `getDesktopLocalStore()` returns `null` — [`dataSource.js`](packages/shared/src/lib/dataSource.js:39-49). Always guard with the null check before calling any local store function.
- **Steam callback is public** — only route that bypasses both auth and sidecar secret checks. If debugging auth flows, check that the browser redirect reaches the sidecar (not the server) since desktop routes are on `127.0.0.1`.
- **Silent failures** — `Logger::logLegacy()` uses `@file_put_contents` (error suppression). If logs appear empty, the log directory may be unwritable. Check `php://stderr` output in Docker logs.
- **No error display in PHP** — `display_errors` is off in production. All errors go to the observability sink or stderr. Debug via `app_bootstrap_diagnostics()` ([`bootstrap.php`](backend/src/bootstrap.php:81-98)) to verify autoloader and env loading.
