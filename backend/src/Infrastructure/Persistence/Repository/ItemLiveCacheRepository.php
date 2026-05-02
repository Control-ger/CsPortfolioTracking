<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class ItemLiveCacheRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS item_live_cache (
            item_id          INT            NOT NULL PRIMARY KEY,
            price_usd        DECIMAL(10,2)  NOT NULL,
            exchange_rate_id INT            NOT NULL,
            price_source     VARCHAR(64),
            fetched_at       TIMESTAMP      NOT NULL,
            updated_at       TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (item_id)          REFERENCES items(id)          ON DELETE CASCADE,
            FOREIGN KEY (exchange_rate_id) REFERENCES exchange_rates(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            RepositoryObservability::schemaEnsured(self::class, 'item_live_cache');
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['table' => 'item_live_cache']
            );
            throw $exception;
        }
    }

    public function findByItemId(int $itemId): ?array
    {
        $sql = 'SELECT ilc.price_usd, ilc.exchange_rate_id, ilc.price_source, ilc.fetched_at, er.usd_to_eur
                FROM item_live_cache ilc
                JOIN exchange_rates er ON er.id = ilc.exchange_rate_id
                WHERE ilc.item_id = ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$itemId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return $row ?: null;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['itemId' => $itemId]
            );
            throw $exception;
        }
    }

    public function upsert(
        int $itemId,
        float $priceUsd,
        int $exchangeRateId,
        string $priceSource,
        string $fetchedAt
    ): void {
        $sql = 'INSERT INTO item_live_cache (
                item_id, price_usd, exchange_rate_id, price_source, fetched_at
             ) VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                price_usd = VALUES(price_usd),
                exchange_rate_id = VALUES(exchange_rate_id),
                price_source = VALUES(price_source),
                fetched_at = VALUES(fetched_at),
                updated_at = CURRENT_TIMESTAMP';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$itemId, $priceUsd, $exchangeRateId, $priceSource, $fetchedAt]);
        } catch (Throwable $exception) {
            RepositoryObservability::upsertFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['itemId' => $itemId]
            );
            throw $exception;
        }
    }

    public function deleteByItemId(int $itemId): bool
    {
        $sql = 'DELETE FROM item_live_cache WHERE item_id = ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            return $stmt->execute([$itemId]) && $stmt->rowCount() > 0;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['itemId' => $itemId]
            );
            throw $exception;
        }
    }
}
