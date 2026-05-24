# Strangler Rollout Status

Status: IN PROGRESS
Updated: 2026-05-23

## 1. Original Goal

Migrate from script-style PHP endpoints to versioned MVC routing without frontend breakage.

## 2. Current Cutover State (cross-checked)

### 2.1 MVC front controller is active

- Canonical entry: `backend/public/index.php`
- Compatibility wrapper remains: `backend/index.php` -> `backend/public/index.php`

### 2.2 Versioned routes are active

- API contract runs under `/api/v1/...`
- Portfolio, watchlist, sync, settings, auth, cs-updates, push, debug, observability routes are registered in `backend/public/index.php`

### 2.3 Legacy script endpoints from early migration docs are no longer present

The following files are not present in current repo root anymore:
- `backend/getPortfolioData.php`
- `backend/getPortfolioHistory.php`
- `backend/manage_watchlist.php`
- `backend/get_watchlist_data.php`
- `backend/savePortfolioValue.php`

## 3. Residual Cleanup Items

1. Remove dead frontend legacy helper:
- `packages/shared/src/hooks/ajax.jsx` still references `/api/getPortfolioData.php` but is not used.

2. Align overpay endpoint contract:
- frontend `apiClient` contains `/api/v1/portfolio/investments/{id}/overpay`
- route is currently not registered in `backend/public/index.php`
- either add backend route or remove client call path.

3. Decide whether `backend/index.php` compatibility wrapper should remain permanently or be retired after deployment policy confirms no direct dependency.

## 4. Done Criteria for this document

This rollout can be marked DONE when:
1. no dead legacy endpoint references remain in shared/frontend code,
2. API contract and registered routes are fully aligned,
3. compatibility wrapper decision (`backend/index.php`) is explicitly finalized.
