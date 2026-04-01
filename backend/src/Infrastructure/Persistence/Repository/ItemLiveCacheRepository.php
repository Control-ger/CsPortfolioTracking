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
            market_hash_name VARCHAR(255) PRIMARY KEY,
            price_usd DECIMAL(10, 2) NOT NULL,
            price_eur DECIMAL(10, 2) NOT NULL,
            exchange_rate DECIMAL(10, 6) NOT NULL,
            price_source VARCHAR(16) DEFAULT NULL,
            fetched_at DATETIME NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_fetched_at (fetched_at)
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

        $this->ensurePriceSourceColumn();
    }

    public function findByMarketHashName(string $marketHashName): ?array
    {
        $sql = 'SELECT market_hash_name, price_usd, price_eur, exchange_rate, price_source, fetched_at
             FROM item_live_cache
             WHERE market_hash_name = ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$marketHashName]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return $row ?: null;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['marketHashName' => $marketHashName]
            );
            throw $exception;
        }
    }

    public function upsert(
        string $marketHashName,
        float $priceUsd,
        float $priceEur,
        float $exchangeRate,
        string $priceSource,
        string $fetchedAt
    ): void {
        $sql = 'INSERT INTO item_live_cache (
                market_hash_name, price_usd, price_eur, exchange_rate, price_source, fetched_at
             ) VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                price_usd = VALUES(price_usd),
                price_eur = VALUES(price_eur),
                exchange_rate = VALUES(exchange_rate),
                price_source = VALUES(price_source),
                fetched_at = VALUES(fetched_at),
                updated_at = CURRENT_TIMESTAMP';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$marketHashName, $priceUsd, $priceEur, $exchangeRate, $priceSource, $fetchedAt]);
        } catch (Throwable $exception) {
            RepositoryObservability::upsertFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['marketHashName' => $marketHashName]
            );
            throw $exception;
        }
    }

    private function ensurePriceSourceColumn(): void
    {
        $checkSql = "SHOW COLUMNS FROM item_live_cache LIKE 'price_source'";
        try {
            $stmt = $this->pdo->query($checkSql);
            $row = $stmt?->fetch(PDO::FETCH_ASSOC);
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $checkSql,
                $exception,
                ['table' => 'item_live_cache', 'column' => 'price_source']
            );
            throw $exception;
        }

        if ($row !== false && $row !== null) {
            return;
        }

        $alterSql = 'ALTER TABLE item_live_cache ADD COLUMN price_source VARCHAR(16) DEFAULT NULL AFTER exchange_rate';
        try {
            $this->pdo->exec($alterSql);
            RepositoryObservability::migrationColumnAdded(
                self::class,
                'item_live_cache',
                'price_source'
            );
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $alterSql,
                $exception,
                ['table' => 'item_live_cache', 'column' => 'price_source']
            );
            throw $exception;
        }
    }
}
