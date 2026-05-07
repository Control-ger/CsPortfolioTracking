# SQL Migrations (Server Scale)

Execution order:

1. `2026_05_06_001_scaling_foundation.sql`
2. `2026_05_06_002_backfill_foundation.sql`
3. `2026_05_06_003_prepare_deprecation.sql`
4. `2026_05_06_004_retention_controls.sql`
5. `2026_05_07_001_price_queue_hourly_history.sql`

Notes:

- Run on staging first.
- Validate row counts before and after backfill.
- Keep legacy read path active until dual-write validation is complete.
- Do not drop legacy tables before at least one stable release cycle.
