<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class WatchlistRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS watchlist (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            user_id         INT            NOT NULL,
            item_id         INT            NOT NULL,
            alert_price_usd DECIMAL(10,2)  NULL,
            added_at        TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
            UNIQUE idx_user_item (user_id, item_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            RepositoryObservability::schemaEnsured(self::class, 'watchlist');
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['table' => 'watchlist']
            );
            throw $exception;
        }
    }

    public function findAll(int $userId): array
    {
        $sql = 'SELECT w.id, w.alert_price_usd, w.added_at,
                       it.name, it.market_hash_name, it.type, it.image_url
                FROM watchlist w
                JOIN items it ON it.id = w.item_id
                WHERE w.user_id = ?
                ORDER BY w.added_at DESC';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$userId]);
            return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['userId' => $userId]
            );
            throw $exception;
        }
    }

    public function existsByItemId(int $userId, int $itemId): bool
    {
        $sql = 'SELECT id FROM watchlist WHERE user_id = ? AND item_id = ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$userId, $itemId]);
            return (bool) $stmt->fetch(PDO::FETCH_ASSOC);
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['userId' => $userId, 'itemId' => $itemId]
            );
            throw $exception;
        }
    }

    public function insert(int $userId, int $itemId, ?float $alertPriceUsd = null): int
    {
        $sql = 'INSERT INTO watchlist (user_id, item_id, alert_price_usd) VALUES (?, ?, ?)';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$userId, $itemId, $alertPriceUsd]);
            return (int) $this->pdo->lastInsertId();
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['userId' => $userId, 'itemId' => $itemId]
            );
            throw $exception;
        }
    }

    public function deleteById(int $id): bool
    {
        $sql = 'DELETE FROM watchlist WHERE id = ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$id]);
            return $stmt->rowCount() > 0;
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
}
