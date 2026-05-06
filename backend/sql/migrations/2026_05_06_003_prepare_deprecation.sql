-- 2026_05_06_003_prepare_deprecation.sql
-- Prepare legacy-table deprecation once read path switches to new tables.
-- This migration is intentionally non-destructive.

START TRANSACTION;

-- 1) Add explicit deprecation marker table for operational visibility.
CREATE TABLE IF NOT EXISTS schema_deprecations (
    table_name VARCHAR(128) NOT NULL PRIMARY KEY,
    deprecation_phase ENUM('planned','dual_write','read_cutover','drop_ready') NOT NULL,
    note VARCHAR(512) NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_deprecations (table_name, deprecation_phase, note)
VALUES
    ('item_catalog', 'planned', 'Metadata should be consolidated into items'),
    ('item_live_cache', 'planned', 'Replaced by item_price_latest'),
    ('position_history', 'planned', 'Potentially replaced by portfolio_snapshots_daily + position_events')
ON DUPLICATE KEY UPDATE
    deprecation_phase = VALUES(deprecation_phase),
    note = VALUES(note);

-- 2) Optional helper indexes for legacy reads during transition.
ALTER TABLE watchlist
    ADD INDEX idx_watchlist_user_added (user_id, added_at);

ALTER TABLE investments
    ADD INDEX idx_investments_user_purchased (user_id, purchased_at);

COMMIT;
