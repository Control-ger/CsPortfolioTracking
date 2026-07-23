# MVC API Contract (v1)

Status: FINAL  
Updated: 2026-06-09

## 1. Base Routing

Canonical route prefix:
- `/api/v1`

Deployment/mount variants:
- Server (web): typically `https://<host>/api/index.php/api/v1`
- Desktop sidecar: `http://127.0.0.1:<dynamic-port>/api/v1`

Important:
- Frontend `apiClient` normalizes base URLs and always appends `/api/v1/...` paths.
- Contract is defined by route paths, not by one fixed hostname.

## 2. Response Envelope

- Success: `{ "data": ..., "meta": ... }`
- Error: `{ "error": { "code": "STRING_CODE", "message": "Human readable", "details": {} } }`
- Some endpoints include warning hints in `meta.warnings[]`.

## 3. User Scoping

- `userId` can be resolved from:
  - headers: `x-user-id` / `user-id`
  - query/body: `userId` / `user_id`
- Fallback user is `1`.

## 4. Portfolio Endpoints

### `GET /portfolio/investments`

Query:
- `scope?: "investments" | "all"` (default: `investments`)

Returns enriched rows with backend calculations (fees, freshness, change windows, etc.).

Key `data[]` fields:
- `id`
- `itemId`
- `name`
- `type`
- `bucket` (`investment` | `inventory`)
- `imageUrl`
- `buyPrice`
- `buyPriceUsd`
- `quantity`
- `baseLivePrice`
- `livePrice`
- `displayPrice`
- `priceSource` (`csfloat` | `steam` | `null`)
- `priceScope` (`item` | `instance`)
- `priceStrategy`
- `priceConfidence`
- `sampleSize`
- `roi`
- `isLive`
- `pricingStatus`
- `totalInvested`
- `currentValue`
- `profitEuro`
- `breakEvenPrice`
- `fundingMode` (`cash_in` | `wallet_funded`)
- `costBasisTotal`
- `costBasisUnit`
- `netPositionValue`
- `netProfitEuro`
- `netRoiPercent`
- `breakEvenPriceNet`
- `appliedFees`
- `change24hEuro`, `change24hPercent`
- `change7dEuro`, `change7dPercent`
- `change30dEuro`, `change30dPercent`
- `lastPriceUpdateAt`
- `priceAgeSeconds`
- `freshnessStatus`
- `freshnessLabel`

Meta:
- `warnings[]`
- `scope`
- `readPath` (always `legacy`; cache-only read from `item_live_cache`)

### `GET /portfolio/summary`

Query:
- `scope?: "investments" | "all"`

Key `data` fields:
- `totalValue`
- `totalInvested`
- `totalQuantity`
- `totalProfitEuro`
- `totalRoiPercent`
- `totalNetValue`
- `totalNetProfitEuro`
- `totalNetRoiPercent`
- `isPositive`
- `chartColor`
- `liveItemsCount`
- `staleLiveItemsCount`
- `staleLiveItemsRatioPercent`
- `freshestDataAgeSeconds`
- `oldestDataAgeSeconds`

Meta may include:
- `warnings[]`
- `scope`
- `readPath` (always `legacy`; cache-only read from `item_live_cache`)

### `GET /portfolio/history`

Returns chart timeline rows:
- `id`
- `date`
- `wert`
- `invested`
- `growthPercent`

### `GET /portfolio/composition`

Query:
- `scope?: "investments" | "all"`

Returns portfolio composition dataset for charting.

### `GET /portfolio/investments/{id}/history`

Returns position history for one investment item id.

### `GET /items/{id}/price-history`

Query:
- `fromDate?: ISO/DATETIME`

Returns historical price points for one global item id.

### `PUT /portfolio/daily-value`

Body:
- `totalValue?: float`

Returns:
- `date`
- `totalValue`
- `growthPercent`

### `PUT /portfolio/investments/{id}/exclude`

Body:
- `exclude: boolean`

Returns:
- `success`
- `investmentId`
- `excluded`

### `PUT /portfolio/investments/{id}/bucket`

Body:
- `bucket: "investment" | "inventory"`

Returns:
- `success`
- `investmentId`
- `bucket`

### `PUT /portfolio/investments/{id}/overpay`

Body:
- `overpayEnabled` / `isOverpayCandidate`: boolean (enables/disables overpay)
- `overpayFloorEur`: float|null (minimum EUR floor, clamped to >= 0)
- `overpayNote`: string|null (optional note about the overpay)

Returns:
- `success`
- `investmentId`
- `overpayEnabled`
- `overpayFloorEur`
- `overpayNote`

Errors:
- `INVALID_OVERPAY_FLOOR` (400) — `overpayFloorEur` is not numeric
- `INVESTMENT_NOT_FOUND` (404) — investment does not exist

## 5. Sync Endpoints

### `GET /sync/pull`

Query:
- `since?: ISO timestamp`
- `limit?: int` (service caps apply)
- optional `userId`

Returns sync payload with:
- `serverTime`
- `changes[]`
- additional counters/metadata (service-dependent)

### `POST /sync/push`

Body:
- `changes: array` (required)
- optional `userId`

Each change contains (contract level):
- `op`
- `table`
- `id`
- `payload`
- `clientRevision`
- `idempotencyKey`
- `ts`

Returns per-change apply status from sync service.

## 6. Watchlist Endpoints

### `GET /watchlist`

Query:
- `syncLive?: 1|true` (attempt live sync before response)

Returns rows with price/trend fields and optional `meta.warnings[]`.

### `GET /watchlist/search`

Query:
- `query?: string`
- `itemType?: string`
- `wear?: string`
- `sortBy?: string`
- `limit?: int`
- `page?: int`

Returns paged catalog/search result with `items[]`.

### `POST /watchlist`

Body:
- `name: string` (required)
- `type?: string`

### `POST /watchlist/batch`

Body:
- `items: array`

### `DELETE /watchlist/{id}`

Deletes one watchlist row.

### `POST /watchlist/prices/refresh`

Triggers server-side watchlist price refresh.

## 7. Settings Endpoints

### `GET /settings/fees`

Returns:
- `fxFeePercent`
- `sellerFeePercent`
- `withdrawalFeePercent`
- `depositFeePercent`
- `depositFeeFixedEur`
- `source` (`db` | `defaults`)

### `PUT /settings/fees`

Accepted body keys (camelCase and snake_case):
- `fxFeePercent` / `fx_fee_percent`
- `sellerFeePercent` / `seller_fee_percent`
- `withdrawalFeePercent` / `withdrawal_fee_percent`
- `depositFeePercent` / `deposit_fee_percent`
- `depositFeeFixedEur` / `deposit_fee_fixed_eur`

Validation:
- percentages `0..100`
- fixed fee `>= 0`

### `GET /settings/price-source`

Returns user preference mode (`auto` | `csfloat` | `steam`).

### `PUT /settings/price-source`

Body:
- `mode: "auto" | "csfloat" | "steam"`

### `GET /settings/currency`

Returns:
- `userId`
- `currency` (ISO 4217, e.g. `EUR`)
- `updatedAt`
- `source` (`db` | `defaults`)
- `popularCurrencies[]` (anonymized aggregate rows)
  - `currency`
  - `activeUsers`
  - `selectionEvents`
  - `lastSelectedAt`

### `PUT /settings/currency`

Body:
- `currency: string` (ISO 4217 code)

Returns same payload shape as `GET /settings/currency` including `popularCurrencies[]`.
`popularCurrencies[]` is anonymized aggregate data and contains no user identifiers.

### `GET /settings/notifications`

Returns server-owned web-push notification preferences (per-user):
- `userId`
- `notifyCsUpdatesWebPush` (bool; default `true`)
- `notifyCsUpdatesWebPushMinLevel` (`none` | `low` | `medium` | `high`; default `high`)
- `updatedAt`
- `source` (`db` | `defaults`)

Only web-push preferences live here — desktop system-notification toggles are stored client-side in the Electron SQLite preference blob. The CS-updates web-push send-path (`CsUpdatesAiRatingService`) reads these to decide which subscriptions to wake.

### `PUT /settings/notifications`

Body (partial patch; only provided keys are written):
- `notifyCsUpdatesWebPush: bool`
- `notifyCsUpdatesWebPushMinLevel: "none" | "low" | "medium" | "high"`

Returns the same payload shape as `GET /settings/notifications`.

### `GET /settings/csfloat-api-key`

Returns key status (`configured`, `lastFour`).

### `POST /settings/csfloat-api-key`

Server API expects encrypted payload (`encryptedKey`).
Desktop app primarily writes CSFloat keys via Electron safe-storage IPC.

## 8. CS Updates + Push Endpoints

### `GET /cs-updates`

Query:
- `limit?: int` (default 30, max 100)
- `before?: date string`
- `since?: date string`

Returns:
- `data.items[]` with feed + AI rating fields
- `meta`: `fetchedAt`, `sourceMode`, `nextBefore`, `hasMore`, `defaultWindowDays`, `staleAfterSeconds`, `bannerVisibleHours`, `isStale`

### `GET /push/public-key`

Returns web-push VAPID public key status.

### `POST /push/subscribe`

Body:
- `userId`
- `subscription` (PushSubscription JSON)

### `POST /push/unsubscribe`

Body:
- `userId`
- `endpoint`

## 9. Frontend Mapping (View-only Boundaries)

- `packages/shared/src/lib/dataSource.js`
  - chooses runtime data source (desktop local store vs API), no backend business logic duplication.
- `packages/shared/src/hooks/usePortfolio.jsx`
  - orchestrates portfolio loading and caching only.
- `packages/shared/src/components/ItemDetailPanel.jsx`
  - renders server-provided item fields.
- `packages/shared/src/components/Watchlist.jsx`
  - renders watchlist DTOs, requests optional live sync via query flag.
- `packages/shared/src/components/WatchlistOverview.jsx`
  - presentation-only watchlist overview.
- `packages/shared/src/components/CsUpdatesFeed.jsx`
  - feed rendering, refresh/load-older actions, realtime state handling via hook.
- `packages/shared/src/pages/SettingsPage.jsx`
  - settings forms calling `/settings/*` and `/push/*` APIs.
