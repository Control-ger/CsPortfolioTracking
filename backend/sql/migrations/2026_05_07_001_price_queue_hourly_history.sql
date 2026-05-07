-- Queue-based hourly price history refresh foundation

SET @has_price_history := (
    SELECT COUNT(*)
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'price_history'
);
SET @alter_price_history_sql := IF(
    @has_price_history > 0,
    'ALTER TABLE price_history MODIFY COLUMN date DATETIME NOT NULL',
    'SELECT 1'
);
PREPARE stmt_price_history FROM @alter_price_history_sql;
EXECUTE stmt_price_history;
DEALLOCATE PREPARE stmt_price_history;

CREATE TABLE IF NOT EXISTS item_price_refresh_queue (
    item_id INT NOT NULL,
    priority TINYINT UNSIGNED NOT NULL DEFAULT 3,
    next_attempt_at DATETIME NOT NULL,
    last_planned_at DATETIME NOT NULL,
    last_attempt_at DATETIME NULL,
    locked_until DATETIME NULL,
    attempts INT NOT NULL DEFAULT 0,
    last_status VARCHAR(32) NULL,
    last_error TEXT NULL,
    last_price_source VARCHAR(64) NULL,
    last_fetched_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (item_id),
    INDEX idx_queue_due (priority, next_attempt_at),
    INDEX idx_queue_locked (locked_until),
    CONSTRAINT fk_queue_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
