# Codebase Optimization & Dead Code Analysis

## Priority 1 — Dead Code to Remove

The original 4 candidates (`hooks/ajax.jsx`, `components/ItemDetailModal.jsx`,
`pages/ItemBrowserPage.jsx`, `pages/DebugDashboardPage.jsx`) were already deleted on
2026-06-10 (commits `ba073fd` / `cca1f4b`).

A fresh repo-wide scan (2026-06-22) found 6 new dead files in `packages/shared`, each
verified at 100% (incl. dynamic/lazy-import check). **Currently commented out / neutralized;
hard deletion to follow after a green build is confirmed.**

| File | Evidence |
|------|----------|
| `packages/shared/src/components/PortfolioGroupsPanel.jsx` | Not in barrel, zero importers |
| `packages/shared/src/components/ui/alert.jsx` | Not in barrel, zero importers (≠ `alert-dialog.jsx`, which is live) |
| `packages/shared/src/components/DebugPanel.jsx` | In barrel (`components/index.js:12`) but never consumed; no lazy/dynamic route |
| `packages/shared/src/components/CacheMaintenancePanel.jsx` | In barrel (`components/index.js:7`), only imported by the dead `DebugPanel` (transitive) |
| `packages/shared/src/CurrencyContext.jsx` | Root re-export shim, zero importers (all use `@shared/contexts/CurrencyContext`) |
| `packages/shared/src/ModalContext.jsx` | Root re-export shim, zero importers |

Note: `packages/shared/src/ThemeContext.jsx` is the third root shim but is **live** —
`ThemeToggle.jsx` imports it via `'../ThemeContext'`. Deletable only after migrating
`ThemeToggle` to `@shared/contexts/ThemeContext` (deferred; touches a live import).

## Priority 2 — Monster Files (Split Recommended)

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

## Priority 3 — Architecture: DI Duplication

`backend/public/index.php` and `backend/desktop/index.php` both `require` the same `bootstrap.php` but each independently wires up the DI container. The two containers can drift independently without a compile-time check. Consider extracting the shared route registration into a separate file.

## Priority 4 — Unused Barrel Exports (resolved / stale)

Both original findings no longer hold:

- `packages/shared/src/pages/index.js` does **not** export `ItemBrowserPage` /
  `DebugDashboardPage` — those files were deleted (see Priority 1).
- `packages/shared/src/lib/index.js` **does** export `portfolioGroups.js` (line 27) and
  `desktopSync.js` (line 36). The barrel is complete; some consumers additionally import
  these modules by direct path, which is a style inconsistency, not a missing export.
