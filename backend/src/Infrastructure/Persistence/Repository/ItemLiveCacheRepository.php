<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class ItemLiveCacheRepository
{
    private const PRICE_SOURCE_DEFAULT = 'csfloat';

    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS item_live_cache (
            item_id          INT            NOT NULL,
            price_source     VARCHAR(64)    NOT NULL DEFAULT '" . self::PRICE_SOURCE_DEFAULT . "',
            price_usd        DECIMAL(10,2)  NOT NULL,
            exchange_rate_id INT            NOT NULL,
            fetched_at       TIMESTAMP      NOT NULL,
            updated_at       TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (item_id, price_source),
            INDEX idx_item_live_cache_item (item_id),
            INDEX idx_item_live_cache_fetched_at (fetched_at),
            FOREIGN KEY (item_id)          REFERENCES items(id)          ON DELETE CASCADE,
            FOREIGN KEY (exchange_rate_id) REFERENCES exchange_rates(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            $this->ensureCompositePrimaryKey();
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

    public function findByItemId(int $itemId, ?string $priceSource = null): ?array
    {
        $sql = 'SELECT ilc.item_id, ilc.price_usd, ilc.exchange_rate_id, ilc.price_source, ilc.fetched_at, er.usd_to_eur
                FROM item_live_cache ilc
                JOIN exchange_rates er ON er.id = ilc.exchange_rate_id
                WHERE ilc.item_id = ?';
        $params = [$itemId];

        if ($priceSource !== null && trim($priceSource) !== '') {
            $sql .= ' AND ilc.price_source = ?';
            $params[] = strtolower(trim($priceSource));
        }

        $sql .= " ORDER BY CASE ilc.price_source
                    WHEN 'csfloat' THEN 0
                    WHEN 'steam' THEN 1
                    ELSE 2
                END ASC,
                ilc.fetched_at DESC
                LIMIT 1";

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return $row ?: null;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['itemId' => $itemId, 'priceSource' => $priceSource]
            );
            throw $exception;
        }
    }

    public function findAllByItemId(int $itemId): array
    {
        $sql = 'SELECT ilc.item_id, ilc.price_usd, ilc.exchange_rate_id, ilc.price_source, ilc.fetched_at, er.usd_to_eur
                FROM item_live_cache ilc
                JOIN exchange_rates er ON er.id = ilc.exchange_rate_id
                WHERE ilc.item_id = ?
                ORDER BY ilc.fetched_at DESC';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$itemId]);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
            return is_array($rows) ? $rows : [];
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
    ): void
    {
        $normalizedSource = strtolower(trim($priceSource));
        if ($normalizedSource === '') {
            $normalizedSource = self::PRICE_SOURCE_DEFAULT;
        }

        $sql = 'INSERT INTO item_live_cache (
                item_id, price_source, price_usd, exchange_rate_id, fetched_at
             ) VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                price_usd = VALUES(price_usd),
                exchange_rate_id = VALUES(exchange_rate_id),
                fetched_at = VALUES(fetched_at),
                updated_at = CURRENT_TIMESTAMP';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$itemId, $normalizedSource, $priceUsd, $exchangeRateId, $fetchedAt]);
        } catch (Throwable $exception) {
            RepositoryObservability::upsertFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['itemId' => $itemId, 'priceSource' => $normalizedSource]
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
            [$itemId, $priceSource, $priceUsd, $exchangeRateId, $fetchedAt] = $row;
            $normalizedSource = strtolower(trim((string) $priceSource));
            if ($normalizedSource === '') {
                $normalizedSource = self::PRICE_SOURCE_DEFAULT;
            }

            $values[] = '(?, ?, ?, ?, ?)';
            $params[] = (int) $itemId;
            $params[] = $normalizedSource;
            $params[] = (float) $priceUsd;
            $params[] = (int) $exchangeRateId;
            $params[] = (string) $fetchedAt;
        }

        if ($values === []) {
            return 0;
        }

        $sql = 'INSERT INTO item_live_cache (
                    item_id, price_source, price_usd, exchange_rate_id, fetched_at
                ) VALUES ' . implode(',', $values) . '
                ON DUPLICATE KEY UPDATE
                    price_usd = VALUES(price_usd),
                    exchange_rate_id = VALUES(exchange_rate_id),
                    fetched_at = VALUES(fetched_at),
                    updated_at = CURRENT_TIMESTAMP';

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

    private function ensureCompositePrimaryKey(): void
    {
        $primaryKeyColumns = $this->loadPrimaryKeyColumns();
        $expectedPrimary = ['item_id', 'price_source'];
        $priceSourceColumnMeta = $this->loadPriceSourceColumnMeta();
        $isNullable = (bool) ($priceSourceColumnMeta['isNullable'] ?? true);
        $defaultValue = strtolower(trim((string) ($priceSourceColumnMeta['default'] ?? '')));
        $needsColumnMigration = $isNullable || $defaultValue !== self::PRICE_SOURCE_DEFAULT;
        $needsPrimaryMigration = $primaryKeyColumns !== $expectedPrimary;

        if ($needsColumnMigration || $needsPrimaryMigration) {
            $this->pdo->exec(
                "UPDATE item_live_cache
                 SET price_source = '" . self::PRICE_SOURCE_DEFAULT . "'
                 WHERE price_source IS NULL OR TRIM(price_source) = ''"
            );
        }

        if ($needsColumnMigration) {
            $this->pdo->exec(
                "ALTER TABLE item_live_cache
                 MODIFY COLUMN price_source VARCHAR(64) NOT NULL DEFAULT '" . self::PRICE_SOURCE_DEFAULT . "'"
            );
        }

        if ($needsPrimaryMigration) {
            $this->pdo->exec(
                "ALTER TABLE item_live_cache
                 DROP PRIMARY KEY,
                 ADD PRIMARY KEY (item_id, price_source)"
            );
        }

        $this->ensureIndex('idx_item_live_cache_item', 'item_id');
        $this->ensureIndex('idx_item_live_cache_fetched_at', 'fetched_at');
    }

    private function loadPrimaryKeyColumns(): array
    {
        $sql = "SELECT COLUMN_NAME
                FROM information_schema.statistics
                WHERE table_schema = DATABASE()
                  AND table_name = 'item_live_cache'
                  AND index_name = 'PRIMARY'
                ORDER BY SEQ_IN_INDEX ASC";
        $stmt = $this->pdo->query($sql);
        $rows = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
        if (!is_array($rows)) {
            return [];
        }

        return array_values(array_map(
            static fn(array $row): string => strtolower((string) ($row['COLUMN_NAME'] ?? '')),
            $rows
        ));
    }

    private function loadPriceSourceColumnMeta(): array
    {
        $sql = "SELECT IS_NULLABLE, COLUMN_DEFAULT
                FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'item_live_cache'
                  AND COLUMN_NAME = 'price_source'
                LIMIT 1";
        $stmt = $this->pdo->query($sql);
        $row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : null;
        if (!is_array($row)) {
            return [
                'isNullable' => true,
                'default' => null,
            ];
        }

        return [
            'isNullable' => strtolower((string) ($row['IS_NULLABLE'] ?? 'yes')) === 'yes',
            'default' => isset($row['COLUMN_DEFAULT']) ? (string) $row['COLUMN_DEFAULT'] : null,
        ];
    }

    private function ensureIndex(string $indexName, string $column): void
    {
        $sql = "SELECT COUNT(*) AS total
                FROM information_schema.statistics
                WHERE table_schema = DATABASE()
                  AND table_name = 'item_live_cache'
                  AND index_name = ?";
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([$indexName]);
        $exists = (int) ($stmt->fetchColumn() ?: 0) > 0;
        if ($exists) {
            return;
        }

        $this->pdo->exec(
            sprintf(
                'ALTER TABLE item_live_cache ADD INDEX `%s` (`%s`)',
                $indexName,
                $column
            )
        );
    }
}
