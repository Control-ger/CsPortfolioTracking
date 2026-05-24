# Desktop Local-First Sync Plan

Status: IN PROGRESS
Updated: 2026-05-23

## 1. Goal

Keep desktop as primary write client with local-first UX and reliable bidirectional sync against server APIs.

## 2. Current Architecture (verified)

### 2.1 Desktop runtime boundary

- Electron main process starts local PHP sidecar (`backend/desktop/index.php`) on `127.0.0.1` with dynamic port.
- Sidecar access is protected by per-start secret (`X-Desktop-Sidecar-Secret`) validated in sidecar runtime.
- Renderer talks to backend via sidecar base URL from preload bridge.

### 2.2 Local persistence

Local SQLite lives in Electron `userData` and is accessed only through `window.electronAPI.localStore`.

Core local tables:
- `investments`, `watchlist_items`
- `operations_log` (pending mutations)
- `sync_notifications` (persistent read/unread notifications)
- price/history and metadata tables (see `docs/local-db-schema.md`)

### 2.3 Sync engine

Shared desktop sync client:
- `packages/shared/src/lib/desktopSync.js`

Server endpoints:
- `POST /api/v1/sync/push`
- `GET /api/v1/sync/pull`

Behavior:
- push pending `operations_log` entries
- apply pull changes into local store
- mark successful/conflict-applied local operations as applied
- cooldown and background auto-sync (`runDesktopSyncNowIfDue`, `startDesktopAutoSync`)

### 2.4 Secret handling

- CSFloat key and session/encryption artifacts use Electron `safeStorage` in desktop main process.
- No key persistence in web build.
- No `keytar` dependency in current production path.

## 3. Current UX Rules

- Desktop pages should render from local cache/store first, then refresh in background.
- Notification center uses persistent local `sync_notifications` and supports:
  - mark single read
  - mark all read
  - unread filtering by `read_at`

## 4. Remaining Work

1. Add stronger sync observability metrics for push/pull outcomes and queue depth.
2. Add integration tests for sync conflict and idempotency flows.
3. Document and enforce cache TTL policy per data-heavy page (preload + bounded cache + background refresh).
4. Keep API contract and local schema docs in lockstep with each sync change.

## 5. Done Criteria

This plan is DONE when:
1. sync reliability and conflict handling are covered by automated integration tests,
2. cache/preload policy is consistently applied across all heavy pages,
3. observability for sync health is available in operations tooling.
