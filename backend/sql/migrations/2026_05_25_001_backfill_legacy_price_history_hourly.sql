-- 2026_05_25_001_backfill_legacy_price_history_hourly.sql
-- Backfill legacy `price_history` rows into runtime table `price_history_hourly`.
-- Idempotent: safe to rerun due to ON DUPLICATE KEY update semantics.

START TRANSACTION;

SET @has_legacy_price_history := (
    SELECT COUNT(*)
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'price_history'
);

SET @backfill_price_history_hourly_sql := IF(
    @has_legacy_price_history > 0,
    'INSERT INTO price_history_hourly (
        item_id,
        bucket_start,
        price_usd,
        exchange_rate_id,
        price_source
    )
    SELECT
        ph.item_id,
        DATE_FORMAT(CAST(ph.date AS DATETIME), ''%Y-%m-%d %H:00:00'') AS bucket_start,
        ph.price_usd,
        ph.exchange_rate_id,
        COALESCE(NULLIF(TRIM(ph.price_source), ''''), ''csfloat'') AS price_source
    FROM price_history ph
    WHERE ph.item_id IS NOT NULL
      AND ph.exchange_rate_id IS NOT NULL
      AND ph.price_usd IS NOT NULL
      AND ph.price_usd > 0
    ON DUPLICATE KEY UPDATE
        price_usd = VALUES(price_usd),
        exchange_rate_id = VALUES(exchange_rate_id),
        price_source = VALUES(price_source)',
    'SELECT 1'
);

PREPARE stmt_backfill_price_history_hourly FROM @backfill_price_history_hourly_sql;
EXECUTE stmt_backfill_price_history_hourly;
DEALLOCATE PREPARE stmt_backfill_price_history_hourly;

COMMIT;
