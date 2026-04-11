<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class ItemCatalogRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS item_catalog (
            market_hash_name VARCHAR(255) PRIMARY KEY,
            image_url VARCHAR(512) DEFAULT NULL,
            item_type VARCHAR(64) DEFAULT NULL,
            item_type_label VARCHAR(128) DEFAULT NULL,
            market_type_label VARCHAR(128) DEFAULT NULL,
            wear_key VARCHAR(64) DEFAULT NULL,
            wear_label VARCHAR(64) DEFAULT NULL,
            cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_item_type (item_type),
            INDEX idx_updated_at (updated_at),
            INDEX idx_cached_at (cached_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            // Verify cached_at column exists (for existing tables)
            $this->ensureCachedAtColumn();
            RepositoryObservability::schemaEnsured(self::class, 'item_catalog');
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['table' => 'item_catalog']
            );
            throw $exception;
        }
    }

    private function ensureCachedAtColumn(): void
    {
        try {
            $checkSql = "SHOW COLUMNS FROM item_catalog WHERE Field = 'cached_at'";
            $stmt = $this->pdo->prepare($checkSql);
            $stmt->execute();
            if ($stmt->rowCount() === 0) {
                $alterSql = "ALTER TABLE item_catalog ADD COLUMN cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER market_hash_name, ADD INDEX idx_cached_at (cached_at)";
                $this->pdo->exec($alterSql);
            }
        } catch (Throwable $exception) {
            // Log but don't throw - column might already exist
            RepositoryObservability::queryFailed(
                self::class,
                'ensureCachedAtColumn',
                'ALTER TABLE item_catalog ADD COLUMN cached_at',
                $exception,
                []
            );
        }
    }

    public function findByMarketHashName(string $marketHashName): ?array
    {
        $sql = 'SELECT market_hash_name, image_url, item_type, item_type_label, market_type_label, wear_key, wear_label, cached_at, updated_at
             FROM item_catalog
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
        ?string $imageUrl,
        ?string $itemType,
        ?string $itemTypeLabel,
        ?string $marketTypeLabel,
        ?string $wearKey,
        ?string $wearLabel
    ): void {
        $sql = 'INSERT INTO item_catalog (
                market_hash_name, image_url, item_type, item_type_label, market_type_label, wear_key, wear_label, cached_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON DUPLICATE KEY UPDATE
                image_url = VALUES(image_url),
                item_type = VALUES(item_type),
                item_type_label = VALUES(item_type_label),
                market_type_label = VALUES(market_type_label),
                wear_key = VALUES(wear_key),
                wear_label = VALUES(wear_label),
                cached_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([
                $marketHashName,
                $imageUrl,
                $itemType,
                $itemTypeLabel,
                $marketTypeLabel,
                $wearKey,
                $wearLabel,
            ]);
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
}
