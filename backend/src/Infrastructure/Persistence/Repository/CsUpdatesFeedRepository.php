<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class CsUpdatesFeedRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS cs_updates_feed (
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
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            $this->ensureAiRatingColumns();
            RepositoryObservability::schemaEnsured(self::class, 'cs_updates_feed');
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['table' => 'cs_updates_feed']
            );
            throw $exception;
        }
    }

    /**
     * @param array<string,mixed> $row
     */
    public function upsert(array $row): bool
    {
        $sql = "INSERT INTO cs_updates_feed (
                    source, external_id, title, url, summary_raw, published_at, changelist_id, build_id, branch
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    title = VALUES(title),
                    url = VALUES(url),
                    summary_raw = VALUES(summary_raw),
                    published_at = VALUES(published_at),
                    changelist_id = VALUES(changelist_id),
                    build_id = VALUES(build_id),
                    branch = VALUES(branch),
                    ai_rating_status = CASE
                        WHEN NOT (title <=> VALUES(title))
                          OR NOT (summary_raw <=> VALUES(summary_raw))
                          OR NOT (published_at <=> VALUES(published_at))
                        THEN 'pending'
                        ELSE ai_rating_status
                    END,
                    ai_impact_level = CASE
                        WHEN NOT (title <=> VALUES(title))
                          OR NOT (summary_raw <=> VALUES(summary_raw))
                          OR NOT (published_at <=> VALUES(published_at))
                        THEN NULL
                        ELSE ai_impact_level
                    END,
                    ai_impact_score = CASE
                        WHEN NOT (title <=> VALUES(title))
                          OR NOT (summary_raw <=> VALUES(summary_raw))
                          OR NOT (published_at <=> VALUES(published_at))
                        THEN NULL
                        ELSE ai_impact_score
                    END,
                    ai_urgency = CASE
                        WHEN NOT (title <=> VALUES(title))
                          OR NOT (summary_raw <=> VALUES(summary_raw))
                          OR NOT (published_at <=> VALUES(published_at))
                        THEN NULL
                        ELSE ai_urgency
                    END,
                    ai_recommended_action = CASE
                        WHEN NOT (title <=> VALUES(title))
                          OR NOT (summary_raw <=> VALUES(summary_raw))
                          OR NOT (published_at <=> VALUES(published_at))
                        THEN NULL
                        ELSE ai_recommended_action
                    END,
                    ai_reasoning = CASE
                        WHEN NOT (title <=> VALUES(title))
                          OR NOT (summary_raw <=> VALUES(summary_raw))
                          OR NOT (published_at <=> VALUES(published_at))
                        THEN NULL
                        ELSE ai_reasoning
                    END,
                    ai_confidence = CASE
                        WHEN NOT (title <=> VALUES(title))
                          OR NOT (summary_raw <=> VALUES(summary_raw))
                          OR NOT (published_at <=> VALUES(published_at))
                        THEN NULL
                        ELSE ai_confidence
                    END,
                    ai_model = CASE
                        WHEN NOT (title <=> VALUES(title))
                          OR NOT (summary_raw <=> VALUES(summary_raw))
                          OR NOT (published_at <=> VALUES(published_at))
                        THEN NULL
                        ELSE ai_model
                    END,
                    ai_rated_at = CASE
                        WHEN NOT (title <=> VALUES(title))
                          OR NOT (summary_raw <=> VALUES(summary_raw))
                          OR NOT (published_at <=> VALUES(published_at))
                        THEN NULL
                        ELSE ai_rated_at
                    END,
                    ai_error = CASE
                        WHEN NOT (title <=> VALUES(title))
                          OR NOT (summary_raw <=> VALUES(summary_raw))
                          OR NOT (published_at <=> VALUES(published_at))
                        THEN NULL
                        ELSE ai_error
                    END,
                    updated_at = CURRENT_TIMESTAMP";

        $params = [
            (string) ($row['source'] ?? 'steamdb_rss'),
            (string) ($row['external_id'] ?? ''),
            (string) ($row['title'] ?? ''),
            (string) ($row['url'] ?? ''),
            isset($row['summary_raw']) ? (string) $row['summary_raw'] : null,
            (string) ($row['published_at'] ?? gmdate('Y-m-d H:i:s')),
            isset($row['changelist_id']) ? (int) $row['changelist_id'] : null,
            isset($row['build_id']) ? (int) $row['build_id'] : null,
            isset($row['branch']) ? (string) $row['branch'] : null,
        ];

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            return $stmt->rowCount() === 1;
        } catch (Throwable $exception) {
            RepositoryObservability::upsertFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['externalId' => (string) ($row['external_id'] ?? '')]
            );
            throw $exception;
        }
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public function listLatest(int $limit = 50, ?string $beforeUtc = null, ?string $sinceUtc = null): array
    {
        $resolvedLimit = max(1, min(200, $limit));
        $params = [];
        $sql = "SELECT
                    id,
                    source,
                    external_id,
                    title,
                    url,
                    summary_raw,
                    published_at,
                    changelist_id,
                    build_id,
                    branch,
                    ai_rating_status,
                    ai_impact_level,
                    ai_impact_score,
                    ai_urgency,
                    ai_recommended_action,
                    ai_reasoning,
                    ai_confidence,
                    ai_model,
                    ai_rated_at,
                    ai_error,
                    created_at,
                    updated_at
                FROM cs_updates_feed";

        $whereParts = [];
        if ($beforeUtc !== null && trim($beforeUtc) !== '') {
            $whereParts[] = 'published_at < ?';
            $params[] = $beforeUtc;
        }
        if ($sinceUtc !== null && trim($sinceUtc) !== '') {
            $whereParts[] = 'published_at >= ?';
            $params[] = $sinceUtc;
        }
        if ($whereParts !== []) {
            $sql .= ' WHERE ' . implode(' AND ', $whereParts);
        }

        $sql .= ' ORDER BY published_at DESC, id DESC LIMIT ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            foreach ($params as $index => $value) {
                $stmt->bindValue($index + 1, $value, PDO::PARAM_STR);
            }
            $stmt->bindValue(count($params) + 1, $resolvedLimit, PDO::PARAM_INT);
            $stmt->execute();

            return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['limit' => $resolvedLimit, 'beforeUtc' => $beforeUtc, 'sinceUtc' => $sinceUtc]
            );
            throw $exception;
        }
    }

    /**
     * @return array<string,mixed>|null
     */
    public function findByExternalId(string $externalId): ?array
    {
        $sql = "SELECT
                    id,
                    source,
                    external_id,
                    title,
                    url,
                    summary_raw,
                    published_at,
                    changelist_id,
                    build_id,
                    branch,
                    ai_rating_status,
                    ai_impact_level,
                    ai_impact_score,
                    ai_urgency,
                    ai_recommended_action,
                    ai_reasoning,
                    ai_confidence,
                    ai_model,
                    ai_rated_at,
                    ai_error,
                    created_at,
                    updated_at
                FROM cs_updates_feed
                WHERE external_id = ?
                LIMIT 1";

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$externalId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return is_array($row) ? $row : null;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['externalId' => $externalId]
            );
            throw $exception;
        }
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public function listPendingAiRatings(int $limit = 20, int $minAgeSeconds = 60): array
    {
        $resolvedLimit = max(1, min(100, $limit));
        $resolvedAgeSeconds = max(0, $minAgeSeconds);
        $cutoff = gmdate('Y-m-d H:i:s', time() - $resolvedAgeSeconds);

        $sql = "SELECT
                    id,
                    source,
                    external_id,
                    title,
                    url,
                    summary_raw,
                    published_at,
                    changelist_id,
                    build_id,
                    branch
                FROM cs_updates_feed
                WHERE ai_rating_status = 'pending'
                  AND published_at <= ?
                ORDER BY published_at DESC, id DESC
                LIMIT ?";

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->bindValue(1, $cutoff, PDO::PARAM_STR);
            $stmt->bindValue(2, $resolvedLimit, PDO::PARAM_INT);
            $stmt->execute();
            return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['limit' => $resolvedLimit, 'cutoff' => $cutoff]
            );
            throw $exception;
        }
    }

    /**
     * @param array<string,mixed> $rating
     */
    public function saveAiRating(int $id, array $rating): void
    {
        $sql = "UPDATE cs_updates_feed
                SET
                    ai_rating_status = 'rated',
                    ai_impact_level = ?,
                    ai_impact_score = ?,
                    ai_urgency = ?,
                    ai_recommended_action = ?,
                    ai_reasoning = ?,
                    ai_confidence = ?,
                    ai_model = ?,
                    ai_rated_at = UTC_TIMESTAMP(),
                    ai_error = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?";

        $params = [
            isset($rating['impact_level']) ? (string) $rating['impact_level'] : null,
            isset($rating['impact_score']) ? (int) $rating['impact_score'] : null,
            isset($rating['urgency']) ? (string) $rating['urgency'] : null,
            isset($rating['recommended_action']) ? (string) $rating['recommended_action'] : null,
            isset($rating['reasoning']) ? (string) $rating['reasoning'] : null,
            isset($rating['confidence']) ? (string) $rating['confidence'] : null,
            isset($rating['model']) ? (string) $rating['model'] : null,
            $id,
        ];

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['id' => $id]
            );
            throw $exception;
        }
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public function findRecentBanWaves(int $days = 7): array
    {
        $days = max(1, min(90, $days));
        $since = gmdate('Y-m-d H:i:s', time() - $days * 86400);
        $sql = "SELECT id, title, published_at, summary_raw
                FROM cs_updates_feed
                WHERE source = 'ban_wave_detected'
                  AND published_at >= ?
                ORDER BY published_at DESC
                LIMIT 10";

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$since]);
            return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['days' => $days]
            );
            throw $exception;
        }
    }

    public function markAiRatingFailed(int $id, string $error): void
    {
        $sql = "UPDATE cs_updates_feed
                SET
                    ai_rating_status = 'failed',
                    ai_error = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?";

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$error, $id]);
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['id' => $id]
            );
            throw $exception;
        }
    }

    private function ensureAiRatingColumns(): void
    {
        $columns = [
            'ai_rating_status' => "ALTER TABLE cs_updates_feed ADD COLUMN ai_rating_status VARCHAR(24) NOT NULL DEFAULT 'pending' AFTER branch",
            'ai_impact_level' => "ALTER TABLE cs_updates_feed ADD COLUMN ai_impact_level VARCHAR(16) NULL AFTER ai_rating_status",
            'ai_impact_score' => "ALTER TABLE cs_updates_feed ADD COLUMN ai_impact_score TINYINT UNSIGNED NULL AFTER ai_impact_level",
            'ai_urgency' => "ALTER TABLE cs_updates_feed ADD COLUMN ai_urgency VARCHAR(24) NULL AFTER ai_impact_score",
            'ai_recommended_action' => "ALTER TABLE cs_updates_feed ADD COLUMN ai_recommended_action VARCHAR(191) NULL AFTER ai_urgency",
            'ai_reasoning' => "ALTER TABLE cs_updates_feed ADD COLUMN ai_reasoning TEXT NULL AFTER ai_recommended_action",
            'ai_confidence' => "ALTER TABLE cs_updates_feed ADD COLUMN ai_confidence VARCHAR(16) NULL AFTER ai_reasoning",
            'ai_model' => "ALTER TABLE cs_updates_feed ADD COLUMN ai_model VARCHAR(64) NULL AFTER ai_confidence",
            'ai_rated_at' => "ALTER TABLE cs_updates_feed ADD COLUMN ai_rated_at DATETIME NULL AFTER ai_model",
            'ai_error' => "ALTER TABLE cs_updates_feed ADD COLUMN ai_error TEXT NULL AFTER ai_rated_at",
        ];

        foreach ($columns as $name => $alterSql) {
            if ($this->columnExists($name)) {
                continue;
            }
            try {
                $this->pdo->exec($alterSql);
                RepositoryObservability::migrationColumnAdded(self::class, 'cs_updates_feed', $name);
            } catch (Throwable $exception) {
                RepositoryObservability::queryFailed(
                    self::class,
                    __FUNCTION__,
                    $alterSql,
                    $exception,
                    ['table' => 'cs_updates_feed', 'column' => $name]
                );
                throw $exception;
            }
        }
    }

    private function columnExists(string $column): bool
    {
        $sql = "SELECT COUNT(*)
                FROM information_schema.COLUMNS
                WHERE table_schema = DATABASE()
                  AND table_name = 'cs_updates_feed'
                  AND column_name = ?";

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([$column]);
        return (int) $stmt->fetchColumn() > 0;
    }
}
