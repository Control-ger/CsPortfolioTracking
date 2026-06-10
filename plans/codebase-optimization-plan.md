# Codebase Optimization Plan

## Phase 1: Remove Dead Code

### Task 1.1 — Delete `packages/shared/src/hooks/ajax.jsx`
- **File:** [`packages/shared/src/hooks/ajax.jsx`](packages/shared/src/hooks/ajax.jsx) (284 B)
- **Why:** Never imported anywhere, calls non-existent `/api/getPortfolioData.php`
- **Action:** Delete file
- **Risk:** None — no imports reference it, not in [`hooks/index.js`](packages/shared/src/hooks/index.js) barrel

### Task 1.2 — Delete `packages/shared/src/components/ItemDetailModal.jsx`
- **File:** [`packages/shared/src/components/ItemDetailModal.jsx`](packages/shared/src/components/ItemDetailModal.jsx) (8.8 KB)
- **Why:** Never imported anywhere. Confusingly similar to the used `ItemDetailsModal.jsx` (note: `Modal` vs `Modal**s**`)
- **Action:** Delete file. Remove its export from [`components/index.js`](packages/shared/src/components/index.js)
- **Risk:** None

### Task 1.3 — Delete `packages/shared/src/pages/ItemBrowserPage.jsx`
- **File:** [`packages/shared/src/pages/ItemBrowserPage.jsx`](packages/shared/src/pages/ItemBrowserPage.jsx) (3.6 KB)
- **Why:** Exported from [`pages/index.js`](packages/shared/src/pages/index.js) but never routed in [`App.jsx`](apps/web/src/App.jsx)
- **Action:** Delete file. Remove `export { default as ItemBrowserPage }` from barrel
- **Risk:** None

### Task 1.4 — Delete `packages/shared/src/pages/DebugDashboardPage.jsx`
- **File:** [`packages/shared/src/pages/DebugDashboardPage.jsx`](packages/shared/src/pages/DebugDashboardPage.jsx) (30 KB)
- **Why:** Exported from [`pages/index.js`](packages/shared/src/pages/index.js) but never routed in [`App.jsx`](apps/web/src/App.jsx)
- **Action:** Delete file. Remove `export { DebugDashboardPage }` from barrel
- **Risk:** None

---

## Phase 2: Fix Broken Overpay Route (Web)

### Task 2.1 — Register overpay route in `backend/public/index.php`
- **File:** [`backend/public/index.php`](backend/public/index.php)
- **Problem:** [`apiClient.js`](packages/shared/src/lib/apiClient.js:1756) calls `PUT /api/v1/portfolio/investments/{id}/overpay`, but route is not registered in the server front controller
- **Evidence:** [`PortfolioController::updateInvestmentOverpay()`](backend/src/Http/Controller/PortfolioController.php:386) exists and is fully implemented, but no `$router->register(...)` call references it in either front controller
- **Desktop note:** Desktop works through local SQLite store + sync mechanism (lines 1687-1752 of apiClient.js). Only the web path (line 1756) hits the missing route.
- **Action:** Add after existing exclude/bucket routes (~line 734):
  ```php
  $router->register('PUT', '/api/v1/portfolio/investments/{id}/overpay', [$portfolioController, 'updateInvestmentOverpay']);
  ```
- **Risk:** Low — method exists, function fully implemented

---

## Phase 3: Refactor Monster Files (Split)

### Task 3.1 — Split `PortfolioPage.jsx` (324 KB)
- **File:** [`packages/shared/src/pages/PortfolioPage.jsx`](packages/shared/src/pages/PortfolioPage.jsx)
- **Why:** Largest file in the project. Handles: overview, inventory, watchlist, search, management — all in one component
- **Action:** Extract these sections into separate components in `packages/shared/src/components/`:
  - `PortfolioOverviewSection.jsx` — dashboard overview tab
  - `PortfolioInventorySection.jsx` — inventory tab
  - `PortfolioWatchlistSection.jsx` — watchlist tab
  - `PortfolioSearchSection.jsx` — item search tab
  - `PortfolioManagementSection.jsx` — management/grouping tab
- **Approach:** Each section is already behind tab rendering — extract corresponding JSX blocks; move section-specific hooks into extracted component; keep shared state via existing hooks (`usePortfolio`)

### Task 3.2 — Split `SettingsPage.jsx` (67 KB)
- **File:** [`packages/shared/src/pages/SettingsPage.jsx`](packages/shared/src/pages/SettingsPage.jsx)
- **Action:** Extract tab contents into: `FeeSettingsSection`, `PriceSourceSettingsSection`, `CurrencySettingsSection`, `CsFloatApiKeySection`, `SkinBaronApiKeySection`, `PortfolioGroupsSettingsSection`, `WebPushSettingsSection`

### Task 3.3 — Split `apiClient.js` (57 KB, 43 exports)
- **File:** [`packages/shared/src/lib/apiClient.js`](packages/shared/src/lib/apiClient.js)
- **Action:** Split by domain into `api/investments.js`, `api/watchlist.js`, `api/settings.js`, `api/sync.js`, `api/auth.js`; keep `apiClient.js` as thin re-export barrel

### Task 3.4 — Split `dataSource.js` (41 KB)
- **File:** [`packages/shared/src/lib/dataSource.js`](packages/shared/src/lib/dataSource.js)
- **Action:** Extract `lib/portfolioCalculations.js` and `lib/desktopDataMerge.js`; keep `dataSource.js` as thin gateway

### Task 3.5 — Split `apps/desktop/main.js` (88 KB)
- **File:** [`apps/desktop/main.js`](apps/desktop/main.js)
- **Action:** Split into: `main/index.js`, `main/ipc-handlers.js`, `main/sidecar.js`, `main/secret-vault.js`, `main/window.js`

### Task 3.6 — Split `apps/desktop/src/localStore/index.js` (73 KB)
- **File:** [`apps/desktop/src/localStore/index.js`](apps/desktop/src/localStore/index.js)
- **Action:** Split into: `localStore/index.js` (factory), `investments.js`, `watchlist.js`, `sync.js`, `settings.js`

### Task 3.7 — Split large PHP services
- **Files:** [`PricingService.php`](backend/src/Application/Service/PricingService.php) (63 KB), [`PortfolioService.php`](backend/src/Application/Service/PortfolioService.php) (52 KB), [`SyncService.php`](backend/src/Application/Service/SyncService.php) (50 KB), [`CsFloatTradeSyncService.php`](backend/src/Application/Service/CsFloatTradeSyncService.php) (45 KB)
- **Action:** Extract private helpers into dedicated service classes; split aggregation from mutation; split entity-specific merge logic

---

## Phase 4: Architecture — Reduce DI Duplication

### Task 4.1 — Document and align route registrations
- **Files:** [`backend/public/index.php`](backend/public/index.php), [`backend/desktop/index.php`](backend/desktop/index.php)
- **Problem:** Both front controllers independently wire DI and register routes; they've diverged (missing overpay route is one symptom)
- **Action:** Create `backend/src/routes.php` for routes shared by both controllers; each front controller `require`s shared routes and adds its own

---

## Phase 5: Clean Up Barrel Exports

### Task 5.1 — Add missing exports to `lib/index.js`
- **File:** [`packages/shared/src/lib/index.js`](packages/shared/src/lib/index.js)
- **Missing:** `portfolioGroups.js`, `desktopSync.js`, `localStoreResult.js` are imported directly but not re-exported
- **Action:** Add the missing exports so consumers can use `@shared/lib` consistently

---

## Execution Order

```
Phase 1 (Dead Code) ──→ Phase 2 (Bug Fix) ──→ Phase 5 (Barrel) ──→ Phase 3 (Splits) ──→ Phase 4 (Architecture)
   Low risk, fast          Single route           Simple             High effort           Complex
   Immediate value         Fixes feature          Small change        Best after phase 5    Needs careful design
```

Each phase is independent. Starting with Phase 1 gives quick wins with zero risk.
