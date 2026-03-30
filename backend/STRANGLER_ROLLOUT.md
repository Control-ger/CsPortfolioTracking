# Strangler Rollout Guide

## Goal
Migrate from script-style PHP endpoints to strict MVC routes without breaking the running frontend.

## Completed in this iteration
1. Added front controller: `backend/public/index.php`
2. Added API router and versioned routes under `/api/v1`
3. Added OOP layers:
   - Controllers
   - Services
   - Repositories
   - DTOs
   - External API adapters
4. Switched React data access to the new API contract.

## Parallel Run (Legacy + MVC)
- Legacy files remain available:
  - `backend/getPortfolioData.php`
  - `backend/getPortfolioHistory.php`
  - `backend/manage_watchlist.php`
  - `backend/get_watchlist_data.php`
  - `backend/savePortfolioValue.php`
- New routes run through:
  - `backend/index.php` -> `backend/public/index.php`

## Risk Controls
- Keep payload compatibility (`wert` in history) for existing chart component behavior.
- Keep legacy endpoints untouched during transition.
- Centralize response schema to reduce frontend branching.
- Use server-side upsert logic to avoid duplicate daily entries.

## Cutover Criteria
- All frontend calls use `/api/v1` only.
- No React component contains domain calculations or external-price decisions.
- No runtime table creation calls from frontend flows.
- Monitoring shows stable response times and no elevated 4xx/5xx rates.

## Final Cleanup
1. Remove dead frontend services (`csfloatService.js`, `currencyService.js`) if no longer imported.
2. Deprecate and remove legacy PHP scripts after one stable release cycle.
3. Move `CREATE TABLE IF NOT EXISTS` from runtime repositories to proper DB migrations.
