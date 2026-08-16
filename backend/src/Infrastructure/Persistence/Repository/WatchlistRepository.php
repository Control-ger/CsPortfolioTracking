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
            alert_meta_json JSON           NULL,
            added_at        TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
            UNIQUE idx_user_item (user_id, item_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            // Additive: CREATE TABLE IF NOT EXISTS does nothing on installs that
            // predate the target-price meta column, and findAll() selects it.
            $columnStmt = $this->pdo->prepare('SHOW COLUMNS FROM watchlist WHERE Field = ?');
            $columnStmt->execute(['alert_meta_json']);
            if (!$columnStmt->fetch(PDO::FETCH_ASSOC)) {
                $this->pdo->exec(
                    'ALTER TABLE watchlist ADD COLUMN alert_meta_json JSON NULL AFTER alert_price_usd'
                );
            }
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
        $sql = 'SELECT w.id, w.item_id, w.alert_price_usd, w.alert_meta_json, w.added_at,
                       it.name, it.market_hash_name, it.type, it.image_url,
                       it.item_type, it.market_type_label
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

    /**
     * Scoped by `user_id` on purpose: the id comes from the request path, and a
     * WHERE on the id alone would let any session retarget another account's row.
     */
    public function updateTarget(
        int $id,
        int $userId,
        ?float $alertPriceUsd,
        ?string $alertMetaJson
    ): bool {
        $sql = 'UPDATE watchlist SET alert_price_usd = ?, alert_meta_json = ?
                WHERE id = ? AND user_id = ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$alertPriceUsd, $alertMetaJson, $id, $userId]);
            return $stmt->rowCount() > 0;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['id' => $id, 'userId' => $userId]
            );
            throw $exception;
        }
    }

    public function findById(int $id, int $userId): ?array
    {
        $sql = 'SELECT w.id, w.item_id, w.alert_price_usd, w.alert_meta_json,
                       it.name, it.market_hash_name
                FROM watchlist w
                JOIN items it ON it.id = w.item_id
                WHERE w.id = ? AND w.user_id = ?
                LIMIT 1';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$id, $userId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return $row !== false ? $row : null;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['id' => $id, 'userId' => $userId]
            );
            throw $exception;
        }
    }

    public function deleteById(int $id, ?int $userId = null): bool
    {
        $sql = $userId !== null
            ? 'DELETE FROM watchlist WHERE user_id = ? AND id = ?'
            : 'DELETE FROM watchlist WHERE id = ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($userId !== null ? [$userId, $id] : [$id]);
            return $stmt->rowCount() > 0;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['id' => $id, 'userId' => $userId]
            );
            throw $exception;
        }
    }
}
