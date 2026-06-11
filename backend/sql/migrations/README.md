# SQL Migrations (Server Scale)

Execution order:

1. `2026_05_06_001_scaling_foundation.sql`
2. `2026_05_06_002_backfill_foundation.sql`
3. `2026_05_06_003_prepare_deprecation.sql`
4. `2026_05_06_004_retention_controls.sql`
5. `2026_05_07_001_price_queue_hourly_history.sql`
6. `2026_05_25_001_backfill_legacy_price_history_hourly.sql`
7. `2026_06_11_001_retire_scaling_price_tables.sql`

Notes:

- Run on staging first.
- Validate row counts before and after backfill.
- `2026_06_11_001`: the pricing layer was consolidated onto the legacy tables
  (`item_live_cache` + `price_history_hourly`), which are canonical and source-aware.
  The scaling price mirror tables (`item_price_latest`, `item_price_history_hourly`) are
  dropped. Apply ONLY after deploying the code release that removes the mirror step and
  `ScalingShadowReadService` and repoints `ItemRepository`'s price JOIN to `item_live_cache`.
  `user_positions` / `position_events` / `portfolio_snapshots_daily` are intentionally kept.
