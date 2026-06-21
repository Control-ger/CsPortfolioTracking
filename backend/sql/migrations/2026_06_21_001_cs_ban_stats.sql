-- 2026_06_21_001_cs_ban_stats.sql
-- Stores raw daily VAC ban counts fetched from external sources.
-- Sources: 'vac_ban_api' (api.vac-ban.com), 'csstats_gg' (csstats.gg/bans)
-- Schema truth: BanStatsRepository::ensureTable() must match this exactly.

CREATE TABLE IF NOT EXISTS cs_ban_stats (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    stat_date DATE NOT NULL,
    source VARCHAR(32) NOT NULL,
    ban_count INT UNSIGNED NOT NULL,
    fetched_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY ux_ban_stats_date_source (stat_date, source),
    KEY ix_ban_stats_date (stat_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
