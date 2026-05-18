CREATE TABLE IF NOT EXISTS cs_updates_feed (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    source VARCHAR(32) NOT NULL,
    external_id VARCHAR(191) NOT NULL,
    title VARCHAR(512) NOT NULL,
    url VARCHAR(1024) NOT NULL,
    summary_raw TEXT NULL,
    published_at DATETIME NOT NULL,
    changelist_id BIGINT NULL,
    build_id BIGINT NULL,
    branch VARCHAR(64) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY ux_cs_updates_external_id (external_id),
    KEY ix_cs_updates_published_at (published_at),
    KEY ix_cs_updates_changelist_id (changelist_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
