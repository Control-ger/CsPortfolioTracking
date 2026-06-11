-- 2026_06_11_001_retire_scaling_price_tables.sql
-- Retires the dormant scaling PRICE tables after the pricing-layer consolidation.
--
-- Decision: the legacy tables `item_live_cache` (PK item_id, price_source) and
-- `price_history_hourly` (PK item_id, bucket_start, price_source) are the canonical,
-- source-aware, cron-written price stack. The scaling mirror tables below were only
-- populated by the now-removed `mirrorScalablePriceTables()` step and read solely by
-- the now-removed `ScalingShadowReadService` (gated behind off-by-default flags).
--
-- IMPORTANT ordering: apply this ONLY after the code release that stops reading/writing
-- these tables (mirror step removed, ScalingShadowReadService deleted, ItemRepository
-- price JOIN repointed to item_live_cache). No backfill is required because the legacy
-- tables are already current and cron-written.
--
-- NOT dropped here: user_positions, position_events, portfolio_snapshots_daily remain as
-- the foundation for the future portfolio read-model (user-scaling) stage.

START TRANSACTION;

DROP TABLE IF EXISTS item_price_history_hourly;
DROP TABLE IF EXISTS item_price_latest;

COMMIT;
