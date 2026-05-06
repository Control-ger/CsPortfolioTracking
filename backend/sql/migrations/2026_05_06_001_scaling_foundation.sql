-- 2026_05_06_001_scaling_foundation.sql
-- Additive migration: creates scalable pricing + positions foundation.

START TRANSACTION;

CREATE TABLE IF NOT EXISTS item_price_latest (
    item_id BIGINT NOT NULL,
    price_usd DECIMAL(12,4) NOT NULL,
    exchange_rate_id BIGINT NOT NULL,
    price_source VARCHAR(64) NOT NULL,
    provider_timestamp DATETIME NULL,
    fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (item_id),
    INDEX idx_ipl_fetched_at (fetched_at),
    INDEX idx_ipl_source (price_source),
    CONSTRAINT fk_ipl_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
    CONSTRAINT fk_ipl_exchange_rate FOREIGN KEY (exchange_rate_id) REFERENCES exchange_rates(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS item_price_history_hourly (
    id BIGINT NOT NULL AUTO_INCREMENT,
    item_id BIGINT NOT NULL,
    bucket_start DATETIME NOT NULL,
    price_usd DECIMAL(12,4) NOT NULL,
    exchange_rate_id BIGINT NOT NULL,
    price_source VARCHAR(64) NOT NULL,
    provider_timestamp DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_iph_item_bucket (item_id, bucket_start),
    INDEX idx_iph_bucket (bucket_start),
    INDEX idx_iph_item_bucket_desc (item_id, bucket_start),
    CONSTRAINT fk_iph_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
    CONSTRAINT fk_iph_exchange_rate FOREIGN KEY (exchange_rate_id) REFERENCES exchange_rates(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_positions (
    user_id BIGINT NOT NULL,
    item_id BIGINT NOT NULL,
    quantity_open BIGINT NOT NULL,
    avg_buy_price_usd DECIMAL(12,4) NOT NULL,
    total_cost_usd DECIMAL(18,4) NOT NULL,
    first_acquired_at DATETIME NULL,
    last_acquired_at DATETIME NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, item_id),
    INDEX idx_up_item_user (item_id, user_id),
    INDEX idx_up_updated_at (updated_at),
    CONSTRAINT fk_up_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_up_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS position_events (
    id BIGINT NOT NULL AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    item_id BIGINT NOT NULL,
    event_type ENUM('buy','sell','import','adjustment') NOT NULL,
    quantity_delta BIGINT NOT NULL,
    unit_price_usd DECIMAL(12,4) NOT NULL,
    total_delta_usd DECIMAL(18,4) NOT NULL,
    event_occurred_at DATETIME NOT NULL,
    external_ref VARCHAR(255) NULL,
    payload_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_pe_user_time (user_id, event_occurred_at),
    INDEX idx_pe_item_time (item_id, event_occurred_at),
    INDEX idx_pe_external_ref (external_ref),
    CONSTRAINT fk_pe_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_pe_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portfolio_snapshots_daily (
    user_id BIGINT NOT NULL,
    snapshot_date DATE NOT NULL,
    total_value_usd DECIMAL(18,4) NOT NULL,
    invested_value_usd DECIMAL(18,4) NOT NULL,
    pnl_usd DECIMAL(18,4) NOT NULL,
    total_positions BIGINT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, snapshot_date),
    INDEX idx_psd_snapshot_date (snapshot_date),
    CONSTRAINT fk_psd_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

COMMIT;
