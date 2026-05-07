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
            id               INT AUTO_INCREMENT PRIMARY KEY,
            item_id          INT            NOT NULL,
            date             DATETIME       NOT NULL,
            price_usd        DECIMAL(10,2)  NOT NULL,
            exchange_rate_id INT            NOT NULL,
            price_source     VARCHAR(64),
            created_at       TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (item_id)          REFERENCES items(id)          ON DELETE CASCADE,
            FOREIGN KEY (exchange_rate_id) REFERENCES exchange_rates(id),
            UNIQUE idx_item_date (item_id, date),
            INDEX idx_date (date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            $this->ensureDateTimeColumn();
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
    }

    public function findLatestPriceByItemId(int $itemId, string $beforeDate): ?float
    {
        $sql = 'SELECT ph.price_usd, er.usd_to_eur
                FROM price_history ph
                JOIN exchange_rates er ON er.id = ph.exchange_rate_id
                WHERE ph.item_id = ? AND ph.date <= ?
                ORDER BY ph.date DESC LIMIT 1';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$itemId, $beforeDate]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return $row ? (float) $row['price_usd'] * (float) $row['usd_to_eur'] : null;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['itemId' => $itemId, 'beforeDate' => $beforeDate]
            );
            throw $exception;
        }
    }

    public function findHistoryByItemId(int $itemId, string $fromDate): array
    {
        $sql = 'SELECT ph.date, ph.price_usd, er.usd_to_eur
                FROM price_history ph
                JOIN exchange_rates er ON er.id = ph.exchange_rate_id
                WHERE ph.item_id = ? AND ph.date >= ?
                ORDER BY ph.date ASC';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$itemId, $fromDate]);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            return array_map(
                static fn(array $row): array => [
                    'date' => $row['date'],
                    'priceEur' => (float) $row['price_usd'] * (float) $row['usd_to_eur'],
                ],
                $rows
            );
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['itemId' => $itemId, 'fromDate' => $fromDate]
            );
            throw $exception;
        }
    }

    public function findLatestPriceMapByItemIds(array $itemIds, string $beforeDate): array
    {
        $normalizedIds = array_values(array_unique(array_filter(array_map(
            static fn(mixed $value): int => (int) $value,
            $itemIds
        ), static fn(int $value): bool => $value > 0)));

        if ($normalizedIds === []) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($normalizedIds), '?'));
        $sql = "SELECT ph.item_id, ph.price_usd, er.usd_to_eur
                FROM price_history ph
                JOIN (
                    SELECT item_id, MAX(date) AS latest_date
                    FROM price_history
                    WHERE date <= ? AND item_id IN ({$placeholders})
                    GROUP BY item_id
                ) latest ON latest.item_id = ph.item_id AND latest.latest_date = ph.date
                JOIN exchange_rates er ON er.id = ph.exchange_rate_id";

        $params = array_merge([$beforeDate], $normalizedIds);

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            $map = [];
            foreach ($rows as $row) {
                $itemId = (int) ($row['item_id'] ?? 0);
                if ($itemId <= 0) {
                    continue;
                }
                $map[$itemId] = (float) ($row['price_usd'] ?? 0.0) * (float) ($row['usd_to_eur'] ?? 0.0);
            }
            return $map;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['itemIds' => count($normalizedIds), 'beforeDate' => $beforeDate]
            );
            throw $exception;
        }
    }

    private function ensureDateTimeColumn(): void
    {
        $query = "SELECT DATA_TYPE
                  FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE()
                    AND TABLE_NAME = 'price_history'
                    AND COLUMN_NAME = 'date'
                  LIMIT 1";
        $stmt = $this->pdo->query($query);
        $dataType = strtolower((string) ($stmt?->fetchColumn() ?: ''));
        if ($dataType === 'datetime') {
            return;
        }

        $this->pdo->exec(
            "ALTER TABLE price_history
             MODIFY COLUMN date DATETIME NOT NULL"
        );
    }

    public function findHistoryMapByItemIds(array $itemIds, string $fromDate): array
    {
        $normalizedIds = array_values(array_unique(array_filter(array_map(
            static fn(mixed $value): int => (int) $value,
            $itemIds
        ), static fn(int $value): bool => $value > 0)));

        if ($normalizedIds === []) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($normalizedIds), '?'));
        $sql = "SELECT ph.item_id, ph.date, ph.price_usd, er.usd_to_eur
                FROM price_history ph
                JOIN exchange_rates er ON er.id = ph.exchange_rate_id
                WHERE ph.item_id IN ({$placeholders}) AND ph.date >= ?
                ORDER BY ph.item_id ASC, ph.date ASC";

        $params = array_merge($normalizedIds, [$fromDate]);

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            $map = [];
            foreach ($rows as $row) {
                $itemId = (int) ($row['item_id'] ?? 0);
                if ($itemId <= 0) {
                    continue;
                }
                $map[$itemId] ??= [];
                $map[$itemId][] = [
                    'date' => (string) ($row['date'] ?? ''),
                    'priceEur' => (float) ($row['price_usd'] ?? 0.0) * (float) ($row['usd_to_eur'] ?? 0.0),
                ];
            }
            return $map;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['itemIds' => count($normalizedIds), 'fromDate' => $fromDate]
            );
            throw $exception;
        }
    }

    public function upsertPrice(
        int $itemId,
        string $date,
        float $priceUsd,
        int $exchangeRateId,
        ?string $priceSource = null
    ): void {
        $sql = 'INSERT INTO price_history (item_id, date, price_usd, exchange_rate_id, price_source)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                 price_usd = VALUES(price_usd),
                 exchange_rate_id = VALUES(exchange_rate_id),
                 price_source = VALUES(price_source)';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$itemId, $date, $priceUsd, $exchangeRateId, $priceSource]);
        } catch (Throwable $exception) {
            RepositoryObservability::upsertFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['itemId' => $itemId, 'date' => $date]
            );
            throw $exception;
        }
    }
}
