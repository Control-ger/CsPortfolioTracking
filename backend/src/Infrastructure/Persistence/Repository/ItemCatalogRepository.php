<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;

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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_item_type (item_type),
            INDEX idx_updated_at (updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
        $this->pdo->exec($sql);
    }

    public function findByMarketHashName(string $marketHashName): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT market_hash_name, image_url, item_type, item_type_label, market_type_label, wear_key, wear_label, updated_at
             FROM item_catalog
             WHERE market_hash_name = ?'
        );
        $stmt->execute([$marketHashName]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
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
        $stmt = $this->pdo->prepare(
            'INSERT INTO item_catalog (
                market_hash_name, image_url, item_type, item_type_label, market_type_label, wear_key, wear_label
             ) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                image_url = VALUES(image_url),
                item_type = VALUES(item_type),
                item_type_label = VALUES(item_type_label),
                market_type_label = VALUES(market_type_label),
                wear_key = VALUES(wear_key),
                wear_label = VALUES(wear_label),
                updated_at = CURRENT_TIMESTAMP'
        );
        $stmt->execute([
            $marketHashName,
            $imageUrl,
            $itemType,
            $itemTypeLabel,
            $marketTypeLabel,
            $wearKey,
            $wearLabel,
        ]);
    }
}
