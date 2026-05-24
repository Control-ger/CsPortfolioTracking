# Desktop Local DB Schema

Status: FINAL
Updated: 2026-05-23

Goal: Desktop remains local-first. Portfolio and watchlist writes are persisted to local SQLite first, then synced.

## 1. Storage Location and Access Boundary

- SQLite file: `Electron app.getPath("userData") + "/cs-investor-hub.sqlite"`
- DB access: only Electron main process
- Renderer access: only via `window.electronAPI.localStore` IPC bridge

## 2. Local Tables (current implementation)

Implemented in `apps/desktop/src/localStore/index.js`:
- `meta`
- `items`
- `investments`
- `watchlist_items`
- `item_prices`
- `price_history`
- `portfolio_snapshots`
- `operations_log`
- `steam_inventory_state`
- `steam_csfloat_matches`
- `sync_notifications`

## 3. Notification Persistence

Table: `sync_notifications`

Purpose:
- persistent desktop notifications for sync/import flows
- read state survives restart

Relevant fields:
- `id`
- `user_id`
- `category`
- `title`
- `message`
- `payload` (json as text)
- `created_at`
- `read_at` (nullable)

Read-state behavior:
- single notification can be marked read
- category-wide or global "mark all as read" is supported

## 4. Core Rules

- Renderer never opens SQLite directly.
- Local writes produce `operations_log` entries for sync push.
- Entity links use stable local ids; server ids stay optional.
- Deletes are soft where needed for sync reconciliation.
- `investments.payload.bucket` is mandatory domain classification (`investment` or `inventory`).

## 5. Current Read Path (cross-checked)

- Runtime source selection happens in `packages/shared/src/lib/dataSource.js`.
- Desktop portfolio/watchlist reads come from local store first.
- If local data is empty, desktop currently returns empty state with reason metadata.
- There is no automatic server seeding path in current desktop read flow.

## 6. Sync Relationship

- `operations_log` stores pending local mutations for `/api/v1/sync/push`.
- Pull results from `/api/v1/sync/pull` are merged back into local SQLite.
- Imports and sync apply paths avoid recursive re-logging of the same records.
