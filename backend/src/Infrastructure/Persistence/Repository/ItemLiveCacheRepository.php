<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;

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
            fetched_at DATETIME NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_fetched_at (fetched_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
        $this->pdo->exec($sql);
    }

    public function findByMarketHashName(string $marketHashName): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT market_hash_name, price_usd, price_eur, exchange_rate, fetched_at
             FROM item_live_cache
             WHERE market_hash_name = ?'
        );
        $stmt->execute([$marketHashName]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    public function upsert(
        string $marketHashName,
        float $priceUsd,
        float $priceEur,
        float $exchangeRate,
        string $fetchedAt
    ): void {
        $stmt = $this->pdo->prepare(
            'INSERT INTO item_live_cache (
                market_hash_name, price_usd, price_eur, exchange_rate, fetched_at
             ) VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                price_usd = VALUES(price_usd),
                price_eur = VALUES(price_eur),
                exchange_rate = VALUES(exchange_rate),
                fetched_at = VALUES(fetched_at),
                updated_at = CURRENT_TIMESTAMP'
        );
        $stmt->execute([$marketHashName, $priceUsd, $priceEur, $exchangeRate, $fetchedAt]);
    }
}
