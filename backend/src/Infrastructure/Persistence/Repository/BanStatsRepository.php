<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class BanStatsRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    // Schema truth: backend/sql/migrations/2026_06_21_001_cs_ban_stats.sql
    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS cs_ban_stats (
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
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            RepositoryObservability::schemaEnsured(self::class, 'cs_ban_stats');
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['table' => 'cs_ban_stats']
            );
            throw $exception;
        }
    }

    public function upsert(string $statDate, string $source, int $banCount, string $fetchedAt): void
    {
        $sql = "INSERT INTO cs_ban_stats (stat_date, source, ban_count, fetched_at)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    ban_count = VALUES(ban_count),
                    fetched_at = VALUES(fetched_at),
                    updated_at = CURRENT_TIMESTAMP";

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$statDate, $source, $banCount, $fetchedAt]);
        } catch (Throwable $exception) {
            RepositoryObservability::upsertFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['stat_date' => $statDate, 'source' => $source]
            );
            throw $exception;
        }
    }

    /**
     * Returns rows ordered DESC by stat_date, excluding dates >= $beforeDateUtc.
     * Date-based window (not row-count) so gaps from source outages are handled correctly.
     *
     * @return array<int,array{stat_date:string,ban_count:int}>
     */
    public function getRecentCompletedBySource(string $source, string $beforeDateUtc, int $limit): array
    {
        $sql = "SELECT stat_date, ban_count
                FROM cs_ban_stats
                WHERE source = ? AND stat_date < ?
                ORDER BY stat_date DESC
                LIMIT ?";

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->bindValue(1, $source, PDO::PARAM_STR);
            $stmt->bindValue(2, $beforeDateUtc, PDO::PARAM_STR);
            $stmt->bindValue(3, max(1, $limit), PDO::PARAM_INT);
            $stmt->execute();

            return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['source' => $source, 'beforeDateUtc' => $beforeDateUtc, 'limit' => $limit]
            );
            throw $exception;
        }
    }

    public function getLatestCompletedStatDate(string $source, string $beforeDateUtc): ?string
    {
        $sql = "SELECT MAX(stat_date) FROM cs_ban_stats WHERE source = ? AND stat_date < ?";

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$source, $beforeDateUtc]);
            $result = $stmt->fetchColumn();

            return is_string($result) && $result !== '' ? $result : null;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['source' => $source, 'beforeDateUtc' => $beforeDateUtc]
            );
            throw $exception;
        }
    }
}
