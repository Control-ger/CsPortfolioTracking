-- 2026_05_06_002_backfill_foundation.sql
-- Backfill new tables from existing schema.
-- Safe to rerun due to upsert patterns.

START TRANSACTION;

-- 1) Backfill user_positions from investments.
INSERT INTO user_positions (
    user_id,
    item_id,
    quantity_open,
    avg_buy_price_usd,
    total_cost_usd,
    first_acquired_at,
    last_acquired_at
)
SELECT
    i.user_id,
    i.item_id,
    SUM(i.quantity) AS quantity_open,
    CASE WHEN SUM(i.quantity) > 0
        THEN SUM(i.buy_price_usd * i.quantity) / SUM(i.quantity)
        ELSE 0
    END AS avg_buy_price_usd,
    SUM(i.buy_price_usd * i.quantity) AS total_cost_usd,
    MIN(i.purchased_at) AS first_acquired_at,
    MAX(i.purchased_at) AS last_acquired_at
FROM investments i
GROUP BY i.user_id, i.item_id
ON DUPLICATE KEY UPDATE
    quantity_open = VALUES(quantity_open),
    avg_buy_price_usd = VALUES(avg_buy_price_usd),
    total_cost_usd = VALUES(total_cost_usd),
    first_acquired_at = VALUES(first_acquired_at),
    last_acquired_at = VALUES(last_acquired_at);

-- 2) Backfill item_price_latest from newest historical row per item.
INSERT INTO item_price_latest (
    item_id,
    price_usd,
    exchange_rate_id,
    price_source,
    provider_timestamp,
    fetched_at
)
SELECT
    ph.item_id,
    ph.price_usd,
    ph.exchange_rate_id,
    COALESCE(ph.price_source, 'unknown') AS price_source,
    CAST(ph.date AS DATETIME) AS provider_timestamp,
    NOW() AS fetched_at
FROM price_history ph
INNER JOIN (
    SELECT item_id, MAX(date) AS max_date
    FROM price_history
    GROUP BY item_id
) latest
    ON latest.item_id = ph.item_id
   AND latest.max_date = ph.date
ON DUPLICATE KEY UPDATE
    price_usd = VALUES(price_usd),
    exchange_rate_id = VALUES(exchange_rate_id),
    price_source = VALUES(price_source),
    provider_timestamp = VALUES(provider_timestamp),
    fetched_at = VALUES(fetched_at);

-- 3) Backfill hourly history table from old daily table.
-- Existing price_history.date is DATE in current schema, so we normalize to midnight buckets.
INSERT INTO item_price_history_hourly (
    item_id,
    bucket_start,
    price_usd,
    exchange_rate_id,
    price_source,
    provider_timestamp
)
SELECT
    ph.item_id,
    CAST(CONCAT(ph.date, ' 00:00:00') AS DATETIME) AS bucket_start,
    ph.price_usd,
    ph.exchange_rate_id,
    COALESCE(ph.price_source, 'unknown') AS price_source,
    CAST(CONCAT(ph.date, ' 00:00:00') AS DATETIME) AS provider_timestamp
FROM price_history ph
ON DUPLICATE KEY UPDATE
    price_usd = VALUES(price_usd),
    exchange_rate_id = VALUES(exchange_rate_id),
    price_source = VALUES(price_source),
    provider_timestamp = VALUES(provider_timestamp);

COMMIT;
