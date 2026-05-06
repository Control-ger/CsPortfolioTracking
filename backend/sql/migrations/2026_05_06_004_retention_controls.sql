-- 2026_05_06_004_retention_controls.sql
-- Operational retention controls for large-scale environments.

START TRANSACTION;

CREATE TABLE IF NOT EXISTS retention_policies (
    policy_key VARCHAR(128) NOT NULL PRIMARY KEY,
    retention_days INT NOT NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    note VARCHAR(512) NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO retention_policies (policy_key, retention_days, enabled, note)
VALUES
    ('observability_events', 14, 1, 'High volume event log'),
    ('sync_idempotency', 30, 1, 'Idempotency replay window'),
    ('cache_maintenance_logs', 90, 1, 'Operational trend window')
ON DUPLICATE KEY UPDATE
    retention_days = VALUES(retention_days),
    enabled = VALUES(enabled),
    note = VALUES(note);

-- Future partition candidates (manual rollout):
-- - item_price_history_hourly by month on bucket_start
-- - observability_events by week/month on timestamp_utc

COMMIT;
