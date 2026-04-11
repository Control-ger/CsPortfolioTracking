<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class SyncStatusRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS sync_status (
            id INT AUTO_INCREMENT PRIMARY KEY,
            sync_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status ENUM('success', 'failed', 'partial') NOT NULL DEFAULT 'partial',
            items_synced INT DEFAULT 0,
            items_failed INT DEFAULT 0,
            rate_limited INT DEFAULT 0,
            error_message TEXT DEFAULT NULL,
            duration_seconds DECIMAL(5, 2) DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_sync_date (sync_date),
            INDEX idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            RepositoryObservability::schemaEnsured(self::class, 'sync_status');
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['table' => 'sync_status']
            );
            throw $exception;
        }
    }

    public function recordSync(
        string $status,
        int $itemsSynced,
        int $itemsFailed,
        int $rateLimited,
        ?string $errorMessage,
        ?float $durationSeconds
    ): int {
        $sql = 'INSERT INTO sync_status (status, items_synced, items_failed, rate_limited, error_message, duration_seconds)
                VALUES (?, ?, ?, ?, ?, ?)';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([
                $status,
                $itemsSynced,
                $itemsFailed,
                $rateLimited,
                $errorMessage,
                $durationSeconds,
            ]);
            return (int) $this->pdo->lastInsertId();
        } catch (Throwable $exception) {
            RepositoryObservability::insertFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['status' => $status]
            );
            throw $exception;
        }
    }

    public function getLastSync(): ?array
    {
        $sql = 'SELECT id, sync_date, status, items_synced, items_failed, rate_limited, error_message, duration_seconds
                FROM sync_status
                ORDER BY sync_date DESC
                LIMIT 1';

        try {
            $stmt = $this->pdo->query($sql);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return $row ?: null;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                []
            );
            throw $exception;
        }
    }

    public function getLatestSyncs(int $limit = 10): array
    {
        $sql = 'SELECT id, sync_date, status, items_synced, items_failed, rate_limited, error_message, duration_seconds
                FROM sync_status
                ORDER BY sync_date DESC
                LIMIT ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$limit]);
            return $stmt->fetchAll(PDO::FETCH_ASSOC) ?? [];
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['limit' => $limit]
            );
            throw $exception;
        }
    }

    public function getSyncStats(int $hoursBack = 24): array
    {
        $sql = 'SELECT 
                    COUNT(*) as total_syncs,
                    SUM(CASE WHEN status = "success" THEN 1 ELSE 0 END) as successful_syncs,
                    SUM(CASE WHEN status = "failed" THEN 1 ELSE 0 END) as failed_syncs,
                    SUM(CASE WHEN status = "partial" THEN 1 ELSE 0 END) as partial_syncs,
                    SUM(items_synced) as total_items_synced,
                    SUM(items_failed) as total_items_failed,
                    AVG(duration_seconds) as avg_duration_seconds
                FROM sync_status
                WHERE sync_date >= DATE_SUB(NOW(), INTERVAL ? HOUR)';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$hoursBack]);
            return $stmt->fetch(PDO::FETCH_ASSOC) ?? [];
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['hoursBack' => $hoursBack]
            );
            throw $exception;
        }
    }
}
