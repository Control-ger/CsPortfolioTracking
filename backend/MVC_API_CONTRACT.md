# MVC API Contract (v1)

## Base Path
- `http://localhost/cs-api/index.php/api/v1`

## Response Schema
- Success: `{ "data": ..., "meta": ... }`
- Error: `{ "error": { "code": "STRING_CODE", "message": "Human readable", "details": {} } }`

## Portfolio Endpoints

### `GET /***REMOVED***/investments`
- Returns enriched investments with backend-calculated metrics.
- `data[]` fields:
  - `id: int`
  - `name: string`
  - `type: string`
  - `buyPrice: float`
  - `quantity: int`
  - `livePrice: float|null`
  - `displayPrice: float`
  - `roi: float`
  - `isLive: bool`

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
- `data[]` fields:
  - `id: int`
  - `name: string`
  - `type: string`
  - `currentPrice: float|null`
  - `priceChange: float|null`
  - `priceChangePercent: float|null`
  - `priceHistory: { date: YYYY-MM-DD, wert: float }[]`
  - `trend: "up"|"down"|null`
  - `changeLabel: string`

### `POST /watchlist`
- Body:
  - `name: string` (required)
  - `type?: string` (default: `skin`)
- Returns:
  - `id: int`
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
- `src/components/ItemSearch.jsx`: no external validation logic; submit only.
- `src/components/Watchlist.jsx`: no table init / SQL-shape assumptions; consumes API DTO only.
- `src/components/WatchlistOverview.jsx`: no business calculations; formatting only.
