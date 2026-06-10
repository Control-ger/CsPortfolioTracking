# Codebase Optimization & Dead Code Analysis

## Priority 1 — Dead Code to Remove

| File | Size | Reason |
|------|------|--------|
| `packages/shared/src/hooks/ajax.jsx` | 284 B | Never imported anywhere; calls non-existent `/api/getPortfolioData.php` |
| `packages/shared/src/components/ItemDetailModal.jsx` | 8.8 KB | Never imported anywhere (confusingly named like `ItemDetailsModal.jsx` which IS used) |
| `packages/shared/src/pages/ItemBrowserPage.jsx` | 3.6 KB | Exported from barrel but never routed in App.jsx |
| `packages/shared/src/pages/DebugDashboardPage.jsx` | 30 KB | Exported from barrel but never routed in App.jsx |

## Priority 2 — Broken Feature: Missing Overpay Route

**The overpay feature on Desktop is broken.** The chain is:
1. `apiClient.js` calls `PUT /api/v1/portfolio/investments/{id}/overpay`
2. This route is **NOT registered** in either front controller:
   - `backend/public/index.php` (server) — missing
   - `backend/desktop/index.php` (desktop sidecar) — missing
3. The controller method **does exist** at `PortfolioController::updateInvestmentOverpay()` — it just needs route registration

**Fix:** Add `$router->register('PUT', '/api/v1/portfolio/investments/{id}/overpay', [$portfolioController, 'updateInvestmentOverpay']);` to both `backend/public/index.php` and `backend/desktop/index.php`.

## Priority 3 — Monster Files (Split Recommended)

These files are excessively large and should be refactored into smaller modules:

| File | Size | Suggested Action |
|------|------|------------------|
| `packages/shared/src/pages/PortfolioPage.jsx` | **324 KB** | Split into multiple components/pages (management, search, overview sections) |
| `packages/shared/src/pages/SettingsPage.jsx` | **67 KB** | Split settings tabs into separate components |
| `packages/shared/src/lib/apiClient.js` | **57 KB** (43 exports) | Split by domain (investments, watchlist, settings, auth) |
| `packages/shared/src/lib/dataSource.js` | **41 KB** | Split clustering logic from data merging |
| `apps/desktop/main.js` | **88 KB** | Split Electron main process handlers |
| `apps/desktop/src/localStore/index.js` | **73 KB** | Split by domain (investments, watchlist, sync) |
| `backend/src/Application/Service/PricingService.php` | **63 KB** | Split price presentation from search logic |
| `backend/src/Application/Service/PortfolioService.php` | **52 KB** | Split aggregation from mutation methods |
| `backend/src/Application/Service/SyncService.php` | **50 KB** | Split entity-specific merge logic |
| `backend/src/Application/Service/CsFloatTradeSyncService.php` | **45 KB** | Split preview from execute logic |

## Priority 4 — Architecture: DI Duplication

`backend/public/index.php` and `backend/desktop/index.php` both `require` the same `bootstrap.php` but each independently wires up the DI container. This has already diverged (missing overpay route is one symptom). Consider extracting the shared route registration into a separate file.

## Priority 5 — Unused Barrel Exports

These barrel files export items that are never imported:

- `packages/shared/src/pages/index.js` exports `ItemBrowserPage` and `DebugDashboardPage` — both unused in App.jsx
- `packages/shared/src/lib/index.js` does NOT export `portfolioGroups.js` or `desktopSync.js` — these are imported directly, which suggests the barrel is incomplete
