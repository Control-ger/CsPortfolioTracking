<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class ItemRepository
{
    private ?bool $priceJoinAvailable = null;

    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS items (
            id                  INT AUTO_INCREMENT PRIMARY KEY,
            csfloat_id          VARCHAR(255)   UNIQUE,
            name                VARCHAR(255)   NOT NULL,
            market_hash_name    VARCHAR(255)   NOT NULL UNIQUE,
            type                VARCHAR(64),
            image_url           VARCHAR(512),
            rarity              VARCHAR(64),
            collection          VARCHAR(128),
            exterior            VARCHAR(64),
            stattrak            BOOL           NOT NULL DEFAULT FALSE,
            item_type           VARCHAR(64),
            item_type_label     VARCHAR(128),
            market_type_label   VARCHAR(128),
            wear_key            VARCHAR(64),
            wear_label          VARCHAR(64),
            catalog_cached_at   TIMESTAMP      NULL,
            created_at          TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at          TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_market_hash_name (market_hash_name),
            INDEX idx_type (type),
            INDEX idx_csfloat_id (csfloat_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            RepositoryObservability::schemaEnsured(self::class, 'items');
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['table' => 'items']
            );
            throw $exception;
        }
    }

    public function findById(int $id): ?array
    {
        $sql = 'SELECT * FROM items WHERE id = ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$id]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return $row ?: null;
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

    public function findByMarketHashName(string $marketHashName): ?array
    {
        $sql = 'SELECT * FROM items WHERE market_hash_name = ?';

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
                ['market_hash_name' => $marketHashName]
            );
            throw $exception;
        }
    }

    public function findByName(string $name): ?array
    {
        $sql = 'SELECT * FROM items WHERE name = ? LIMIT 1';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$name]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return $row ?: null;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['name' => $name]
            );
            throw $exception;
        }
    }

    public function findOrCreateByName(string $name, string $type = 'other'): int
    {
        $existing = $this->findByName($name);
        if ($existing !== null) {
            return (int) $existing['id'];
        }

        return $this->create($name, $name, $type);
    }

    public function create(
        string $name,
        string $marketHashName,
        string $type = 'other',
        ?string $csfloatId = null,
        ?string $imageUrl = null,
        ?string $rarity = null,
        ?string $collection = null,
        ?string $exterior = null,
        bool $stattrak = false
    ): int {
        $sql = 'INSERT INTO items (name, market_hash_name, type, csfloat_id, image_url, rarity, collection, exterior, stattrak)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$name, $marketHashName, $type, $csfloatId, $imageUrl, $rarity, $collection, $exterior, (int) $stattrak]);
            return (int) $this->pdo->lastInsertId();
        } catch (Throwable $exception) {
            // Handle duplicate key gracefully
            if (str_contains($exception->getMessage(), 'Duplicate entry')) {
                $existing = $this->findByMarketHashName($marketHashName);
                if ($existing !== null) {
                    return (int) $existing['id'];
                }
            }
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['name' => $name]
            );
            throw $exception;
        }
    }

    public function updateCatalogData(int $itemId, array $catalogData): void
    {
        $fields = [];
        $values = [];

        $allowedFields = [
            'image_url', 'type', 'rarity', 'collection', 'exterior', 'stattrak',
            'item_type', 'item_type_label', 'market_type_label', 'wear_key', 'wear_label',
            'csfloat_id', 'catalog_cached_at'
        ];

        foreach ($catalogData as $field => $value) {
            if (in_array($field, $allowedFields, true)) {
                $fields[] = "{$field} = ?";
                $values[] = $value;
            }
        }

        if ($fields === []) {
            return;
        }

        $values[] = $itemId;
        $sql = 'UPDATE items SET ' . implode(', ', $fields) . ' WHERE id = ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($values);
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

    public function findAll(): array
    {
        $sql = 'SELECT * FROM items ORDER BY name ASC';

        try {
            $stmt = $this->pdo->query($sql);
            return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception
            );
            throw $exception;
        }
    }

    public function searchCatalog(
        string $query,
        ?string $itemType = null,
        ?string $wearKey = null,
        ?string $sortBy = null,
        int $limit = 20,
        int $offset = 0
    ): array {
        $resolvedLimit = max(1, min($limit, 100));
        $resolvedOffset = max(0, $offset);

        $conditions = [];
        $params = [];

        $normalizedQuery = trim($query);
        if ($normalizedQuery !== '') {
            $conditions[] = '(market_hash_name LIKE ? OR name LIKE ?)';
            $needle = '%' . $normalizedQuery . '%';
            $params[] = $needle;
            $params[] = $needle;
        }

        $normalizedItemType = trim((string) $itemType);
        if ($normalizedItemType !== '' && strtolower($normalizedItemType) !== 'all') {
            $conditions[] = '(item_type = ? OR type = ?)';
            $params[] = $normalizedItemType;
            $params[] = $normalizedItemType;
        }

        $normalizedWear = trim((string) $wearKey);
        if ($normalizedWear !== '' && strtolower($normalizedWear) !== 'all') {
            $conditions[] = 'wear_key = ?';
            $params[] = $normalizedWear;
        }

        $whereSql = $conditions === [] ? '' : ('WHERE ' . implode(' AND ', $conditions));
        $orderSql = match (trim((string) $sortBy)) {
            'name_desc' => 'ORDER BY market_hash_name DESC',
            'price_asc' => 'ORDER BY price_eur ASC, market_hash_name ASC',
            'price_desc' => 'ORDER BY price_eur DESC, market_hash_name ASC',
            default => 'ORDER BY market_hash_name ASC',
        };
        $selectSql = 'id, name, market_hash_name, image_url, type, item_type, item_type_label, market_type_label, wear_key, wear_label';
        $joinSql = '';
        if ($this->supportsPriceJoin()) {
            $selectSql .= ',
                    ipl.price_usd,
                    ipl.price_source,
                    ipl.fetched_at,
                    er.usd_to_eur,
                    CASE WHEN ipl.price_usd IS NOT NULL AND er.usd_to_eur IS NOT NULL
                        THEN (ipl.price_usd * er.usd_to_eur)
                        ELSE NULL
                     END AS price_eur';
            $joinSql = '
                LEFT JOIN item_price_latest ipl ON ipl.item_id = items.id
                LEFT JOIN exchange_rates er ON er.id = ipl.exchange_rate_id';
        } else {
            $selectSql .= ',
                    NULL AS price_usd,
                    NULL AS price_source,
                    NULL AS fetched_at,
                    NULL AS usd_to_eur,
                    NULL AS price_eur';
        }

        $sql = "SELECT {$selectSql}
                FROM items
                {$joinSql}
                {$whereSql}
                {$orderSql}
                LIMIT {$resolvedLimit} OFFSET {$resolvedOffset}";

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['query' => $query, 'itemType' => $itemType, 'wearKey' => $wearKey]
            );
            throw $exception;
        }
    }

    public function countCatalog(
        string $query,
        ?string $itemType = null,
        ?string $wearKey = null
    ): int {
        $conditions = [];
        $params = [];

        $normalizedQuery = trim($query);
        if ($normalizedQuery !== '') {
            $conditions[] = '(market_hash_name LIKE ? OR name LIKE ?)';
            $needle = '%' . $normalizedQuery . '%';
            $params[] = $needle;
            $params[] = $needle;
        }

        $normalizedItemType = trim((string) $itemType);
        if ($normalizedItemType !== '' && strtolower($normalizedItemType) !== 'all') {
            $conditions[] = '(item_type = ? OR type = ?)';
            $params[] = $normalizedItemType;
            $params[] = $normalizedItemType;
        }

        $normalizedWear = trim((string) $wearKey);
        if ($normalizedWear !== '' && strtolower($normalizedWear) !== 'all') {
            $conditions[] = 'wear_key = ?';
            $params[] = $normalizedWear;
        }

        $whereSql = $conditions === [] ? '' : ('WHERE ' . implode(' AND ', $conditions));
        $sql = "SELECT COUNT(*) AS total FROM items {$whereSql}";

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return (int) ($row['total'] ?? 0);
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['query' => $query, 'itemType' => $itemType, 'wearKey' => $wearKey]
            );
            throw $exception;
        }
    }

    private function supportsPriceJoin(): bool
    {
        if ($this->priceJoinAvailable !== null) {
            return $this->priceJoinAvailable;
        }

        try {
            $itemLatest = $this->pdo->query("SHOW TABLES LIKE 'item_price_latest'")?->fetchColumn();
            $exchangeRates = $this->pdo->query("SHOW TABLES LIKE 'exchange_rates'")?->fetchColumn();
            $this->priceJoinAvailable = $itemLatest !== false && $exchangeRates !== false;
        } catch (Throwable) {
            $this->priceJoinAvailable = false;
        }

        return $this->priceJoinAvailable;
    }
}
