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
            id            INT AUTO_INCREMENT PRIMARY KEY,
            user_id       INT          NOT NULL,
            source        VARCHAR(64)  NOT NULL,
            status        VARCHAR(32)  NOT NULL,
            last_sync_at  TIMESTAMP    NULL,
            error_message TEXT         NULL,
            updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE idx_user_source (user_id, source)
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

    public function updateStatus(int $userId, string $source, string $status, ?string $errorMessage = null): void
    {
        $sql = 'INSERT INTO sync_status (user_id, source, status, last_sync_at, error_message)
                VALUES (?, ?, ?, NOW(), ?)
                ON DUPLICATE KEY UPDATE
                    status = VALUES(status),
                    last_sync_at = NOW(),
                    error_message = VALUES(error_message)';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$userId, $source, $status, $errorMessage]);
        } catch (Throwable $exception) {
            RepositoryObservability::upsertFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['userId' => $userId, 'source' => $source]
            );
            throw $exception;
        }
    }

    public function getLastSync(int $userId, string $source = 'csfloat'): ?array
    {
        $sql = 'SELECT id, source, status, last_sync_at, error_message
                FROM sync_status
                WHERE user_id = ? AND source = ?
                LIMIT 1';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$userId, $source]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return $row ?: null;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['userId' => $userId, 'source' => $source]
            );
            throw $exception;
        }
    }

    public function getLatestSyncs(int $userId, int $limit = 10): array
    {
        $sql = 'SELECT id, source, status, last_sync_at, error_message
                FROM sync_status
                WHERE user_id = ?
                ORDER BY last_sync_at DESC
                LIMIT ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$userId, $limit]);
            return $stmt->fetchAll(PDO::FETCH_ASSOC) ?? [];
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['userId' => $userId, 'limit' => $limit]
            );
            throw $exception;
        }
    }
}
