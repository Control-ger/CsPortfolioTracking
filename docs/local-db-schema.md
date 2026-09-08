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
- `sales`
- `sale_allocations`

### 2.1 Sell tracking (`sales`, `sale_allocations`)

Schema version 5. Written by `apps/desktop/src/localStore/sales.js`.

**A sale consumes purchase rows; it never rewrites them.** `sale_allocations`
records which `investments` rows a sale drew from and how much of each, so:

- purchase rows stay immutable, which matters for sync — a lot that is re-priced
  later must not silently restate a realised gain;
- the remaining holding is **derived**: `investments.quantity` minus what
  allocations consumed (`listConsumedQuantities`), in line with the "no
  precomputed aggregates" rule;
- realised P&L stays traceable to the exact lot, because `sale_allocations`
  copies `buy_price_usd` at allocation time.

Allocation is **FIFO over the oldest unsold rows**. The schema is already
lot-level — a Steam sync writes one row per physical item with its own price and
purchase date — so FIFO is a sort and a walk, not a split. Rationale and the
measurements behind the choice: `docs/wallet-cost-basis-plan.md` §4.

Two behaviours worth knowing:

- **Over-selling is recorded, not refused.** A sale of more units than the
  portfolio holds is stored and reports the unallocated remainder. A user may
  sell something the portfolio never captured, and dropping the proceeds over a
  bookkeeping gap would lose the figure the wallet factor needs.
- **`external_trade_id` deduplicates importer re-reads**, scoped per user and
  platform.

`SALE_SYNC_ENABLED` in `sales.js` is **on**: the server accepts the `sales` table
and `mapOperationToSyncChange` maps `sale` → `sales`. It was off while only the
local half existed, because `mapOperationToSyncChange` *retires* (discards) any
entity type it cannot map. Rows written in that window carry `dirty = 1` and no
operation, so `enqueueDirtySaleOperations` runs once at the start of every push
and picks them up — a no-op once none are left.

Pull applies sales through `importSales`, which is **silent**: it writes no
operation, because a pull that re-logged what it just received would push the
same rows straight back. Allocations come from the payload rather than being
re-derived, so a pulled sale reproduces the originating device's split exactly.

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
- `title_key` (nullable)
- `message_key` (nullable)
- `params_json` (nullable, json as text)

Read-state behavior:
- single notification can be marked read
- category-wide or global "mark all as read" is supported

### 3.1 Localised notification text

Rows are persisted, so their text outlives the language it was written in. A
writer therefore stores **both**: the catalogue key (`title_key`,
`message_key`) plus its interpolation values (`params_json`), *and* the
rendered `title`/`message`.

- `resolveNotificationText` (`packages/shared/src/lib/notificationText.js`)
  prefers the key, so a language switch retranslates the whole history instead
  of leaving every row in whichever language happened to be active when it was
  written.
- `title`/`message` stay populated as the fallback. That is what rows written
  before these columns existed carry, and it is why the columns are additive
  rather than a replacement.
- **Dedupe keys on `title_key`/`message_key` + `params_json` when a key is
  present**, on `title`/`message` otherwise. Matching on the rendered text
  alone would treat the same notification written before and after a language
  switch as two different ones.

The columns are added by `ensureColumn` in `apps/desktop/src/localStore/index.js`,
so an existing database picks them up on the next start.

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
- `sales` / `sale_allocations` are **local-only for now** — see §2.1. The server
  does not carry the entity yet, so these rows do not leave the device.
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
