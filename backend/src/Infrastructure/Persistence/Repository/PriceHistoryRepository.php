<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class PriceHistoryRepository
{
    private const TABLE_NAME = 'price_history_hourly';
    private const PRICE_SOURCE_DEFAULT = 'csfloat';

    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        $partitionSql = $this->buildPartitionSql();
        $sql = "CREATE TABLE IF NOT EXISTS " . self::TABLE_NAME . " (
            item_id          INT            NOT NULL,
            bucket_start     DATETIME       NOT NULL,
            price_usd        DECIMAL(10,2)  NOT NULL,
            exchange_rate_id INT            NOT NULL,
            price_source     VARCHAR(64)    NOT NULL DEFAULT '" . self::PRICE_SOURCE_DEFAULT . "',
            created_at       TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (item_id, bucket_start, price_source),
            INDEX idx_bucket_start (bucket_start),
            INDEX idx_item_bucket (item_id, bucket_start),
            FOREIGN KEY (item_id)          REFERENCES items(id)          ON DELETE CASCADE,
            FOREIGN KEY (exchange_rate_id) REFERENCES exchange_rates(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        {$partitionSql}";

        try {
            $this->pdo->exec($sql);
            $this->ensureMonthlyPartitions();
            RepositoryObservability::schemaEnsured(self::class, self::TABLE_NAME);
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['table' => self::TABLE_NAME]
            );
            throw $exception;
        }
    }

    public function findLatestPriceByItemId(int $itemId, string $beforeDate): ?float
    {
        $sql = 'SELECT ph.price_usd, er.usd_to_eur
                FROM ' . self::TABLE_NAME . ' ph
                JOIN exchange_rates er ON er.id = ph.exchange_rate_id
                WHERE ph.item_id = ? AND ph.bucket_start <= ?
                ORDER BY ph.bucket_start DESC LIMIT 1';

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
        $sql = 'SELECT ph.bucket_start AS date, ph.price_usd, er.usd_to_eur
                FROM ' . self::TABLE_NAME . ' ph
                JOIN exchange_rates er ON er.id = ph.exchange_rate_id
                WHERE ph.item_id = ? AND ph.bucket_start >= ?
                ORDER BY ph.bucket_start ASC';

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
                FROM " . self::TABLE_NAME . " ph
                JOIN (
                    SELECT item_id, MAX(bucket_start) AS latest_date
                    FROM " . self::TABLE_NAME . "
                    WHERE bucket_start <= ? AND item_id IN ({$placeholders})
                    GROUP BY item_id
                ) latest ON latest.item_id = ph.item_id AND latest.latest_date = ph.bucket_start
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
        $sql = "SELECT ph.item_id, ph.bucket_start AS date, ph.price_usd, er.usd_to_eur
                FROM " . self::TABLE_NAME . " ph
                JOIN exchange_rates er ON er.id = ph.exchange_rate_id
                WHERE ph.item_id IN ({$placeholders}) AND ph.bucket_start >= ?
                ORDER BY ph.item_id ASC, ph.bucket_start ASC";

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
        $normalizedSource = $this->normalizePriceSource($priceSource);
        $sql = 'INSERT INTO ' . self::TABLE_NAME . ' (item_id, bucket_start, price_usd, exchange_rate_id, price_source)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                 price_usd = VALUES(price_usd),
                 exchange_rate_id = VALUES(exchange_rate_id),
                 price_source = VALUES(price_source)';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$itemId, $date, $priceUsd, $exchangeRateId, $normalizedSource]);
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

    public function bulkUpsert(array $rows): int
    {
        if ($rows === []) {
            return 0;
        }

        $values = [];
        $params = [];
        foreach ($rows as $row) {
            if (!is_array($row) || count($row) < 5) {
                continue;
            }
            [$itemId, $bucketStart, $priceUsd, $exchangeRateId, $priceSource] = $row;
            $values[] = '(?, ?, ?, ?, ?)';
            $params[] = (int) $itemId;
            $params[] = (string) $bucketStart;
            $params[] = (float) $priceUsd;
            $params[] = (int) $exchangeRateId;
            $params[] = $this->normalizePriceSource($priceSource);
        }

        if ($values === []) {
            return 0;
        }

        $sql = 'INSERT INTO ' . self::TABLE_NAME . ' (item_id, bucket_start, price_usd, exchange_rate_id, price_source)
                VALUES ' . implode(',', $values) . '
                ON DUPLICATE KEY UPDATE
                    price_usd = VALUES(price_usd),
                    exchange_rate_id = VALUES(exchange_rate_id),
                    price_source = VALUES(price_source)';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            return $stmt->rowCount();
        } catch (Throwable $exception) {
            RepositoryObservability::upsertFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['rows' => count($values)]
            );
            throw $exception;
        }
    }

    private function normalizePriceSource(?string $priceSource): string
    {
        $normalized = strtolower(trim((string) $priceSource));
        return $normalized !== '' ? $normalized : self::PRICE_SOURCE_DEFAULT;
    }

    private function buildPartitionSql(): string
    {
        $partitions = $this->buildPartitionDefinitions(12);
        if ($partitions === []) {
            return '';
        }

        return 'PARTITION BY RANGE COLUMNS(bucket_start) (' . implode(',', $partitions) . ')';
    }

    /**
     * @return array<int, string>
     */
    private function buildPartitionDefinitions(int $monthsAhead): array
    {
        $start = new \DateTimeImmutable('first day of this month 00:00:00');
        $parts = [];
        for ($i = 0; $i <= $monthsAhead; $i++) {
            $current = $start->modify("+{$i} months");
            $next = $current->modify('+1 month');
            $parts[] = sprintf(
                "PARTITION p%s VALUES LESS THAN ('%s')",
                $current->format('Y_m'),
                $next->format('Y-m-01')
            );
        }
        $parts[] = 'PARTITION pmax VALUES LESS THAN (MAXVALUE)';

        return $parts;
    }

    private function ensureMonthlyPartitions(): void
    {
        $partitionNames = $this->loadPartitionNames();
        if ($partitionNames === []) {
            return;
        }

        $start = new \DateTimeImmutable('first day of this month 00:00:00');
        $monthsAhead = 3;
        for ($i = 0; $i <= $monthsAhead; $i++) {
            $current = $start->modify("+{$i} months");
            $partitionName = 'p' . $current->format('Y_m');
            if (in_array($partitionName, $partitionNames, true)) {
                continue;
            }

            $next = $current->modify('+1 month');
            $boundary = $next->format('Y-m-01');
            if (in_array('pmax', $partitionNames, true)) {
                $sql = "ALTER TABLE " . self::TABLE_NAME . " REORGANIZE PARTITION pmax INTO (
                    PARTITION {$partitionName} VALUES LESS THAN ('{$boundary}'),
                    PARTITION pmax VALUES LESS THAN (MAXVALUE)
                )";
            } else {
                $sql = "ALTER TABLE " . self::TABLE_NAME . " ADD PARTITION (
                    PARTITION {$partitionName} VALUES LESS THAN ('{$boundary}')
                )";
            }
            $this->pdo->exec($sql);
            $partitionNames[] = $partitionName;
        }
    }

    /**
     * @return array<int, string>
     */
    private function loadPartitionNames(): array
    {
        $sql = "SELECT PARTITION_NAME
                FROM information_schema.PARTITIONS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = ?
                  AND PARTITION_NAME IS NOT NULL";
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([self::TABLE_NAME]);
        $rows = $stmt->fetchAll(PDO::FETCH_COLUMN) ?: [];
        if (!is_array($rows)) {
            return [];
        }
        return array_values(array_filter(array_map(
            static fn(mixed $value): string => (string) $value,
            $rows
        ), static fn(string $value): bool => $value !== ''));
    }
}
