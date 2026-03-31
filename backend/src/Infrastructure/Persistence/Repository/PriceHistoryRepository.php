<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;

final class PriceHistoryRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS price_history (
            id INT AUTO_INCREMENT PRIMARY KEY,
            item_name VARCHAR(255) NOT NULL,
            date DATE NOT NULL,
            price_usd DECIMAL(10, 2) NOT NULL,
            price_eur DECIMAL(10, 2) NOT NULL,
            exchange_rate DECIMAL(10, 6) NOT NULL,
            price_source VARCHAR(16) DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_item_date (item_name, date),
            INDEX idx_item_name (item_name),
            INDEX idx_date (date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
        $this->pdo->exec($sql);
        $this->ensurePriceSourceColumn();
    }

    public function findLatestPriceByItem(string $itemName, string $beforeDate): ?float
    {
        $stmt = $this->pdo->prepare('SELECT price_eur FROM price_history WHERE item_name = ? AND date <= ? ORDER BY date DESC LIMIT 1');
        $stmt->execute([$itemName, $beforeDate]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ? (float) $row['price_eur'] : null;
    }

    public function findLatestPriceSnapshotByItem(string $itemName, string $beforeDate): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT price_eur, price_source
             FROM price_history
             WHERE item_name = ? AND date <= ?
             ORDER BY date DESC
             LIMIT 1'
        );
        $stmt->execute([$itemName, $beforeDate]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            return null;
        }

        return [
            'priceEur' => isset($row['price_eur']) ? (float) $row['price_eur'] : null,
            'priceSource' => isset($row['price_source']) ? (string) $row['price_source'] : null,
        ];
    }

    public function findHistoryByItem(string $itemName, string $fromDate): array
    {
        $stmt = $this->pdo->prepare('SELECT date, price_eur FROM price_history WHERE item_name = ? AND date >= ? ORDER BY date ASC');
        $stmt->execute([$itemName, $fromDate]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        return array_map(
            static fn(array $row): array => ['date' => $row['date'], 'wert' => (float) $row['price_eur']],
            $rows
        );
    }

    public function upsertPrice(
        string $itemName,
        string $date,
        float $priceUsd,
        float $priceEur,
        float $exchangeRate,
        ?string $priceSource = null
    ): void
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO price_history (item_name, date, price_usd, price_eur, exchange_rate, price_source)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                 price_usd = VALUES(price_usd),
                 price_eur = VALUES(price_eur),
                 exchange_rate = VALUES(exchange_rate),
                 price_source = VALUES(price_source)'
        );
        $stmt->execute([$itemName, $date, $priceUsd, $priceEur, $exchangeRate, $priceSource]);
    }

    private function ensurePriceSourceColumn(): void
    {
        $stmt = $this->pdo->query("SHOW COLUMNS FROM price_history LIKE 'price_source'");
        $row = $stmt?->fetch(PDO::FETCH_ASSOC);
        if ($row !== false && $row !== null) {
            return;
        }

        $this->pdo->exec(
            'ALTER TABLE price_history ADD COLUMN price_source VARCHAR(16) DEFAULT NULL AFTER exchange_rate'
        );
    }
}
