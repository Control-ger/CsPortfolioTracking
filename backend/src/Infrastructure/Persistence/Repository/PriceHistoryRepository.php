<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

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
            date DATETIME NOT NULL,
            price_usd DECIMAL(10, 2) NOT NULL,
            price_eur DECIMAL(10, 2) NOT NULL,
            exchange_rate DECIMAL(10, 6) NOT NULL,
            price_source VARCHAR(16) DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_item_date (item_name, date),
            INDEX idx_item_name (item_name),
            INDEX idx_date (date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            RepositoryObservability::schemaEnsured(self::class, 'price_history');
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['table' => 'price_history']
            );
            throw $exception;
        }

        $this->ensurePriceSourceColumn();
        $this->ensureDateColumnSupportsTime();
    }

    public function findLatestPriceByItem(string $itemName, string $beforeDate): ?float
    {
        $sql = 'SELECT price_eur FROM price_history WHERE item_name = ? AND date <= ? ORDER BY date DESC LIMIT 1';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$itemName, $beforeDate]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return $row ? (float) $row['price_eur'] : null;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['itemName' => $itemName, 'beforeDate' => $beforeDate]
            );
            throw $exception;
        }
    }

    public function findLatestPriceSnapshotByItem(string $itemName, string $beforeDate): ?array
    {
        $sql = 'SELECT price_eur, price_source
             FROM price_history
             WHERE item_name = ? AND date <= ?
             ORDER BY date DESC
             LIMIT 1';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$itemName, $beforeDate]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$row) {
                return null;
            }

            return [
                'priceEur' => isset($row['price_eur']) ? (float) $row['price_eur'] : null,
                'priceSource' => isset($row['price_source']) ? (string) $row['price_source'] : null,
            ];
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['itemName' => $itemName, 'beforeDate' => $beforeDate]
            );
            throw $exception;
        }
    }

    public function findHistoryByItem(string $itemName, string $fromDate): array
    {
        $sql = 'SELECT date, price_eur FROM price_history WHERE item_name = ? AND date >= ? ORDER BY date ASC';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$itemName, $fromDate]);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            return array_map(
                static fn(array $row): array => [
                    'date' => self::formatSnapshotDate((string) $row['date']),
                    'wert' => (float) $row['price_eur'],
                ],
                $rows
            );
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['itemName' => $itemName, 'fromDate' => $fromDate]
            );
            throw $exception;
        }
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
        $sql = 'INSERT INTO price_history (item_name, date, price_usd, price_eur, exchange_rate, price_source)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                 price_usd = VALUES(price_usd),
                 price_eur = VALUES(price_eur),
                 exchange_rate = VALUES(exchange_rate),
                 price_source = VALUES(price_source)';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$itemName, $date, $priceUsd, $priceEur, $exchangeRate, $priceSource]);
        } catch (Throwable $exception) {
            RepositoryObservability::upsertFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['itemName' => $itemName, 'date' => $date]
            );
            throw $exception;
        }
    }

    private function ensurePriceSourceColumn(): void
    {
        $checkSql = "SHOW COLUMNS FROM price_history LIKE 'price_source'";
        try {
            $stmt = $this->pdo->query($checkSql);
            $row = $stmt?->fetch(PDO::FETCH_ASSOC);
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $checkSql,
                $exception,
                ['table' => 'price_history', 'column' => 'price_source']
            );
            throw $exception;
        }

        if ($row !== false && $row !== null) {
            return;
        }

        $alterSql = 'ALTER TABLE price_history ADD COLUMN price_source VARCHAR(16) DEFAULT NULL AFTER exchange_rate';
        try {
            $this->pdo->exec($alterSql);
            RepositoryObservability::migrationColumnAdded(
                self::class,
                'price_history',
                'price_source'
            );
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $alterSql,
                $exception,
                ['table' => 'price_history', 'column' => 'price_source']
            );
            throw $exception;
        }
    }

    private function ensureDateColumnSupportsTime(): void
    {
        $checkSql = "SHOW COLUMNS FROM price_history LIKE 'date'";
        try {
            $stmt = $this->pdo->query($checkSql);
            $row = $stmt?->fetch(PDO::FETCH_ASSOC);
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $checkSql,
                $exception,
                ['table' => 'price_history', 'column' => 'date']
            );
            throw $exception;
        }

        $columnType = strtolower((string) ($row['Type'] ?? ''));
        if (str_starts_with($columnType, 'datetime')) {
            return;
        }

        $alterSql = 'ALTER TABLE price_history MODIFY COLUMN date DATETIME NOT NULL';
        try {
            $this->pdo->exec($alterSql);
            RepositoryObservability::migrationColumnAdded(
                self::class,
                'price_history',
                'date_datetime'
            );
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $alterSql,
                $exception,
                ['table' => 'price_history', 'column' => 'date']
            );
            throw $exception;
        }
    }

    private static function formatSnapshotDate(string $value): string
    {
        $trimmed = trim($value);

        if ($trimmed === '') {
            return $trimmed;
        }

        if (str_contains($trimmed, 'T')) {
            return $trimmed;
        }

        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $trimmed) === 1) {
            return $trimmed . 'T00:00:00';
        }

        if (preg_match('/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/', $trimmed) === 1) {
            return str_replace(' ', 'T', $trimmed);
        }

        return $trimmed;
    }
}
