<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use RuntimeException;
use Throwable;

final class ItemRepository
{
    private const CATALOG_WRITE_SCOPE_ENV = 'ITEMS_CATALOG_WRITE_SCOPE';
    private const CATALOG_WRITE_SCOPE_CRON = 'cron';

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

        $this->assertCatalogWriteEnabled(__FUNCTION__);
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
        $this->assertCatalogWriteEnabled(__FUNCTION__);

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

        $this->assertCatalogWriteEnabled(__FUNCTION__);
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
            $conditions[] = '(i.market_hash_name LIKE ? OR i.name LIKE ?)';
            $needle = '%' . $normalizedQuery . '%';
            $params[] = $needle;
            $params[] = $needle;
        }

        $normalizedItemType = trim((string) $itemType);
        if ($normalizedItemType !== '' && strtolower($normalizedItemType) !== 'all') {
            if (strtolower($normalizedItemType) === 'other') {
                $conditions[] = '(
                    i.item_type = ? OR i.type = ?
                    OR i.item_type IS NULL OR TRIM(i.item_type) = \'\'
                    OR i.type IS NULL OR TRIM(i.type) = \'\'
                )';
                $params[] = $normalizedItemType;
                $params[] = $normalizedItemType;
            } else {
                $conditions[] = '(i.item_type = ? OR i.type = ?)';
                $params[] = $normalizedItemType;
                $params[] = $normalizedItemType;
            }
        }

        $normalizedWear = trim((string) $wearKey);
        if ($normalizedWear !== '' && strtolower($normalizedWear) !== 'all') {
            $conditions[] = 'i.wear_key = ?';
            $params[] = $normalizedWear;
        }

        $whereSql = $conditions === [] ? '' : ('WHERE ' . implode(' AND ', $conditions));
        $normalizedSortBy = trim((string) $sortBy);
        $orderSql = match ($normalizedSortBy) {
            'name_desc' => 'ORDER BY i.market_hash_name DESC',
            'price_asc' => 'ORDER BY price_eur ASC, i.market_hash_name ASC',
            'price_desc' => 'ORDER BY price_eur DESC, i.market_hash_name ASC',
            default => 'ORDER BY i.market_hash_name ASC',
        };
        $selectSql = 'i.id, i.name, i.market_hash_name, i.image_url, i.type, i.item_type, i.item_type_label, i.market_type_label, i.wear_key, i.wear_label';
        $relevanceSelectSql = '';
        $relevanceParams = [];
        if ($normalizedSortBy === 'relevance' && $normalizedQuery !== '') {
            $queryTokens = $this->extractSearchTokens($normalizedQuery);
            $exactNeedle = $normalizedQuery;
            $prefixNeedle = $normalizedQuery . '%';
            $containsNeedle = '%' . $normalizedQuery . '%';
            $tokenScoreParts = [];
            $allTokenPresenceConditions = [];
            $tokenScoreParams = [];
            $allTokenPresenceParams = [];
            foreach ($queryTokens as $token) {
                $tokenPrefixNeedle = $token . '%';
                $tokenContainsNeedle = '%' . $token . '%';
                $tokenScoreParts[] = '
                            (
                                CASE
                                    WHEN i.market_hash_name LIKE ? THEN 120
                                    WHEN i.name LIKE ? THEN 110
                                    WHEN i.market_hash_name LIKE ? THEN 80
                                    WHEN i.name LIKE ? THEN 70
                                    ELSE 0
                                END
                            )';
                $tokenScoreParams[] = $tokenPrefixNeedle;
                $tokenScoreParams[] = $tokenPrefixNeedle;
                $tokenScoreParams[] = $tokenContainsNeedle;
                $tokenScoreParams[] = $tokenContainsNeedle;

                $allTokenPresenceConditions[] = '(i.market_hash_name LIKE ? OR i.name LIKE ?)';
                $allTokenPresenceParams[] = $tokenContainsNeedle;
                $allTokenPresenceParams[] = $tokenContainsNeedle;
            }
            $tokenScoreSql = $tokenScoreParts !== [] ? implode(' + ', $tokenScoreParts) : '0';
            $allTokensBonusSql = $allTokenPresenceConditions !== []
                ? '(CASE WHEN ' . implode(' AND ', $allTokenPresenceConditions) . ' THEN 240 ELSE 0 END)'
                : '0';
            $relevanceSelectSql = ',
                    (
                        CASE
                            WHEN i.market_hash_name = ? THEN 1000
                            WHEN i.name = ? THEN 980
                            WHEN i.market_hash_name LIKE ? THEN 900
                            WHEN i.name LIKE ? THEN 860
                            WHEN i.market_hash_name LIKE ? THEN 700
                            WHEN i.name LIKE ? THEN 660
                            ELSE 0
                        END
                        + (' . $tokenScoreSql . ')
                        + ' . $allTokensBonusSql . '
                    ) AS relevance_score';
            $relevanceParams = [
                $exactNeedle,
                $exactNeedle,
                $prefixNeedle,
                $prefixNeedle,
                $containsNeedle,
                $containsNeedle,
                ...$tokenScoreParams,
                ...$allTokenPresenceParams,
            ];
            $orderSql = 'ORDER BY relevance_score DESC, CHAR_LENGTH(i.market_hash_name) ASC, i.market_hash_name ASC';
        }
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
                LEFT JOIN item_price_latest ipl ON ipl.item_id = i.id
                LEFT JOIN exchange_rates er ON er.id = ipl.exchange_rate_id';
        } else {
            $selectSql .= ',
                    NULL AS price_usd,
                    NULL AS price_source,
                    NULL AS fetched_at,
                    NULL AS usd_to_eur,
                    NULL AS price_eur';
        }
        $selectSql .= $relevanceSelectSql;

        $sql = "SELECT {$selectSql}
                FROM items i
                {$joinSql}
                {$whereSql}
                {$orderSql}
                LIMIT {$resolvedLimit} OFFSET {$resolvedOffset}";

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute(array_merge($relevanceParams, $params));
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
            if (strtolower($normalizedItemType) === 'other') {
                $conditions[] = '(
                    item_type = ? OR type = ?
                    OR item_type IS NULL OR TRIM(item_type) = \'\'
                    OR type IS NULL OR TRIM(type) = \'\'
                )';
                $params[] = $normalizedItemType;
                $params[] = $normalizedItemType;
            } else {
                $conditions[] = '(item_type = ? OR type = ?)';
                $params[] = $normalizedItemType;
                $params[] = $normalizedItemType;
            }
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

    /**
     * @return array<int, string>
     */
    private function extractSearchTokens(string $query, int $maxTokens = 6): array
    {
        $normalized = preg_replace('/[^\p{L}\p{N}]+/u', ' ', $query) ?? '';
        $parts = preg_split('/\s+/u', trim($normalized)) ?: [];

        $tokens = [];
        $seen = [];
        foreach ($parts as $part) {
            $candidate = trim((string) $part);
            if ($candidate === '') {
                continue;
            }

            $token = function_exists('mb_strtolower')
                ? mb_strtolower($candidate, 'UTF-8')
                : strtolower($candidate);
            $length = function_exists('mb_strlen')
                ? mb_strlen($token, 'UTF-8')
                : strlen($token);
            if ($length < 2) {
                continue;
            }

            if (isset($seen[$token])) {
                continue;
            }

            $seen[$token] = true;
            $tokens[] = $token;
            if (count($tokens) >= $maxTokens) {
                break;
            }
        }

        return $tokens;
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

    public function findIdsByMarketHashNames(array $marketHashNames): array
    {
        $normalized = array_values(array_unique(array_filter(array_map(
            static fn(mixed $value): string => trim((string) $value),
            $marketHashNames
        ), static fn(string $value): bool => $value !== '')));

        if ($normalized === []) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($normalized), '?'));
        $sql = "SELECT id, market_hash_name FROM items WHERE market_hash_name IN ({$placeholders})";

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($normalized);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            $map = [];
            foreach ($rows as $row) {
                $name = (string) ($row['market_hash_name'] ?? '');
                $id = (int) ($row['id'] ?? 0);
                if ($name !== '' && $id > 0) {
                    $map[$name] = $id;
                }
            }
            return $map;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['count' => count($normalized)]
            );
            throw $exception;
        }
    }

    public function bulkInsertMarketHashNames(array $marketHashNames): int
    {
        $normalized = array_values(array_unique(array_filter(array_map(
            static fn(mixed $value): string => trim((string) $value),
            $marketHashNames
        ), static fn(string $value): bool => $value !== '')));

        if ($normalized === []) {
            return 0;
        }

        $this->assertCatalogWriteEnabled(__FUNCTION__);
        $values = [];
        $params = [];
        foreach ($normalized as $name) {
            $values[] = '(?, ?)';
            $params[] = $name;
            $params[] = $name;
        }

        $sql = 'INSERT IGNORE INTO items (name, market_hash_name) VALUES ' . implode(',', $values);

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            return $stmt->rowCount();
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['count' => count($normalized)]
            );
            throw $exception;
        }
    }

    public function isCatalogWriteEnabled(): bool
    {
        if (PHP_SAPI !== 'cli') {
            return false;
        }

        $rawScope = getenv(self::CATALOG_WRITE_SCOPE_ENV);
        if ($rawScope === false && isset($_ENV[self::CATALOG_WRITE_SCOPE_ENV])) {
            $rawScope = $_ENV[self::CATALOG_WRITE_SCOPE_ENV];
        }

        $scope = strtolower(trim((string) ($rawScope ?? '')));
        return $scope === self::CATALOG_WRITE_SCOPE_CRON;
    }

    private function assertCatalogWriteEnabled(string $operation): void
    {
        if ($this->isCatalogWriteEnabled()) {
            return;
        }

        throw new RuntimeException(
            sprintf(
                'items catalog is read-only for operation "%s"; only cron catalog sync may mutate items.',
                $operation
            )
        );
    }
}
