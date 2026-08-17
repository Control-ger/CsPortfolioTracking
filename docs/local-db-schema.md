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
- `watchlist_items.payload` carries the target price as four fields that are only
  meaningful together: `alertPriceUsd` (USD), `alertDirection` (`below`|`above`),
  `alertAnchorPriceUsd` (live price when the target was set — the progress bar's
  denominator) and `alertTriggeredAt` (crossing timestamp, cleared when the price
  falls back). No DDL: they ride in the existing JSON blob, like the investment
  overpay fields. Normalization lives in
  `apps/desktop/src/localStore/utils.js` (`normalizeWatchlistTargetFields`), a
  deliberate duplicate of `packages/shared/src/lib/watchlistTargets.js` — the
  Electron main process has no `@shared` alias. Clearing the price clears the
  other three, so a stale anchor cannot re-arm the alert.

## 5. Current Read Path (cross-checked)

- Runtime source selection happens in `packages/shared/src/lib/dataSource.js`.
- Desktop portfolio/watchlist reads come from local store first.
- If local data is empty, desktop currently returns empty state with reason metadata.
- There is no automatic server seeding path in current desktop read flow.

## 6. Sync Relationship

- `operations_log` stores pending local mutations for `/api/v1/sync/push`.
- Pull results from `/api/v1/sync/pull` are merged back into local SQLite.
- Imports and sync apply paths avoid recursive re-logging of the same records.

## 7. Operations Log as Activity Feed

`operations_log` is also read back, by `listOperations` in
`apps/desktop/src/localStore/sync.js`, to feed the "Letzte Aktivität" block on
the portfolio overview. Consequences of that second role:

- The table carries a `user_id` column. It was added additively (`ensureColumn`
  in `apps/desktop/src/localStore/index.js`) and backfilled from
  `payload.userId`. Scope must not be read out of the payload: `delete` ops
  never carried a `userId` there, and JSON extraction cannot use an index.
  `appendOperation` (`apps/desktop/src/localStore/utils.js`) writes the column;
  delete call sites read the owner off the row being deleted.
- Index `idx_operations_user_created(user_id, created_at DESC)` serves the feed.
  The older `idx_operations_pending(applied_at, created_at)` serves the push
  queue and does not fit this query.
- Rows are never deleted, only marked via `applied_at`, so the log is durable
  history — but it grows without bound and every read must pass a `LIMIT`.
- The feed shows the newest row per entity. Alert passes and edits each append
  another `upsert`, so the raw log repeats one item many times over.
- `upsert` does not distinguish create from update, and imports/sync-apply write
  no operations at all. The feed therefore covers manual edits only, and its
  wording must not claim more than that.
- Web has no equivalent: the server keeps no per-user operation log, so the
  block is desktop-only rather than rendered empty.
