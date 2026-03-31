# MVC API Contract (v1)

## Base Path
- `http://localhost/cs-api/index.php/api/v1`

## Response Schema
- Success: `{ "data": ..., "meta": ... }`
- Error: `{ "error": { "code": "STRING_CODE", "message": "Human readable", "details": {} } }`
- `meta.warnings[]` can contain external API warnings, e.g. CSFloat HTTP errors with fallback usage

## Portfolio Endpoints

### `GET /***REMOVED***/investments`
- Returns enriched investments with backend-calculated metrics.
- `data[]` fields:
  - `id: int`
  - `name: string`
  - `type: string`
  - `imageUrl: string|null`
  - `buyPrice: float`
  - `quantity: int`
  - `livePrice: float|null`
  - `priceSource: "csfloat"|"steam"|null`
  - `displayPrice: float`
  - `roi: float`
  - `isLive: bool`
  - `pricingStatus: "csfloat"|"steam"|"fallback"`

### `GET /***REMOVED***/summary`
- Returns aggregate KPIs for cards/charts.
- `data` fields:
  - `totalValue: float`
  - `totalInvested: float`
  - `totalQuantity: int`
  - `totalProfitEuro: float`
  - `totalRoiPercent: float`
  - `isPositive: bool`
  - `chartColor: string`

### `GET /***REMOVED***/history`
- Returns timeline for charting.
- `data[]` fields:
  - `id: int`
  - `date: YYYY-MM-DD`
  - `wert: float`

### `PUT /***REMOVED***/daily-value`
- Body:
  - `totalValue?: float`
- Upserts the daily value; if omitted, backend computes from investments.
- Returns:
  - `date: YYYY-MM-DD`
  - `totalValue: float`

## Watchlist Endpoints

### `GET /watchlist`
- Returns watchlist items with backend-calculated trend data.
- Query:
  - `syncLive?: 1|true` updates live prices from CSFloat before responding
- `data[]` fields:
  - `id: int`
  - `name: string`
  - `type: string`
  - `imageUrl: string|null`
  - `currentPrice: float|null`
  - `priceSource: "csfloat"|"steam"|null`
  - `priceChange: float|null`
  - `priceChangePercent: float|null`
  - `priceHistory: { date: YYYY-MM-DD, wert: float }[]`
  - `trend: "up"|"down"|null`
  - `changeLabel: string`

### `GET /watchlist/search`
- Query:
  - `query?: string` (min. 2 chars when provided)
  - `limit?: int` (default `6`, max `12`)
  - `page?: int` (default `1`)
  - `sortBy?: string` (`relevance`, `name_asc`, `name_desc`, `price_asc`, `price_desc`)
  - `itemType?: string` (`all`, `skin`, `case`, `souvenir_package`, `sticker_capsule`, `sticker`, `patch`, `music_kit`, `agent`, `key`, `terminal`, `charm`, `graffiti`, `tool`, `container`, `other`)
  - `wear?: string` (`all`, `factory_new`, `minimal_wear`, `field_tested`, `well_worn`, `battle_scarred`) only effective for `itemType=skin`
- Backend flow:
  - candidate lookup via Steam Market search
  - exact live-price validation via CSFloat
  - Steam fallback if CSFloat is unavailable or returns an API error
  - backend classification for all supported CS item categories
- Special behavior:
  - with empty `query` and a concrete `itemType`, endpoint switches to browse mode
- `data` fields:
  - `items: []`
  - `page: int`
  - `limit: int`
  - `totalItems: int`
  - `totalPages: int`
  - `sortBy: string`
  - `browseMode: bool`
- `data.items[]` fields:
  - `marketHashName: string`
  - `displayName: string`
  - `itemType: string`
  - `itemTypeLabel: string`
  - `marketTypeLabel: string`
  - `wear: string|null`
  - `wearLabel: string|null`
  - `iconUrl: string|null`
  - `priceSource: "csfloat"|"steam"|null`
  - `livePriceEur: float`
  - `livePriceUsd: float`

### `POST /watchlist`
- Body:
  - `name: string` (required)
  - `type?: string` (default: `skin`)
- Returns:
  - `id: int`
  - `currentPrice: float|null`
  - `isLiveSynced: bool`
- Errors:
  - `409 WATCHLIST_CONFLICT` for duplicates
  - `400 WATCHLIST_CREATE_FAILED` for invalid payload

### `DELETE /watchlist/{id}`
- Returns:
  - `deleted: true`
- Errors:
  - `404 WATCHLIST_NOT_FOUND`

### `POST /watchlist/prices/refresh`
- Triggers server-side refresh from external APIs.
- Returns:
  - `updated: int`
  - `totalItems: int`

## React View-only Mapping
- `src/hooks/usePortfolio.jsx`: only orchestrates endpoint calls and stores response state.
- `src/components/ItemDetailPanel.jsx`: no live-price fetching; shows provided `item`.
- `src/components/ItemSearch.jsx`: no pricing/search rules; only renders API search results and selection state.
- `src/components/Watchlist.jsx`: no table init / SQL-shape assumptions; consumes API DTO only and can request live-sync via query flag.
- `src/components/WatchlistOverview.jsx`: no business calculations; formatting only.
