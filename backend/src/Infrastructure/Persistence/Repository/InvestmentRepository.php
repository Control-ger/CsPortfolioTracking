<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class InvestmentRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS investments (
            id                INT AUTO_INCREMENT PRIMARY KEY,
            user_id           INT            NOT NULL,
            item_id           INT            NOT NULL,
            buy_price_usd     DECIMAL(10,2)  NOT NULL,
            quantity          INT            NOT NULL,
            funding_mode      ENUM('cash','trade','balance') NOT NULL DEFAULT 'cash',
            platform          VARCHAR(64),
            external_trade_id VARCHAR(255),
            purchased_at      TIMESTAMP      NOT NULL,
            raw_payload_json  JSON,
            created_at        TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (item_id) REFERENCES items(id),
            INDEX idx_user_item (user_id, item_id),
            INDEX idx_purchased_at (purchased_at),
            UNIQUE KEY uq_external_trade (platform, external_trade_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            RepositoryObservability::schemaEnsured(self::class, 'investments');
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

    public function findAll(int $userId): array
    {
        $this->ensureTable();

        $sql = 'SELECT i.id, i.user_id, i.item_id, i.buy_price_usd, i.quantity,
                       i.funding_mode, i.platform, i.external_trade_id, i.purchased_at,
                       it.name, it.market_hash_name, it.type, it.image_url
                FROM investments i
                JOIN items it ON it.id = i.item_id
                WHERE i.user_id = ?
                ORDER BY it.name ASC';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$userId]);
            return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['userId' => $userId]
            );
            throw $exception;
        }
    }

    public function findById(int $id): ?array
    {
        $sql = 'SELECT i.*, it.name, it.market_hash_name, it.type, it.image_url
                FROM investments i
                JOIN items it ON it.id = i.item_id
                WHERE i.id = ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$id]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return $row !== false ? $row : null;
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

    public function findByItemId(int $userId, int $itemId): array
    {
        $sql = 'SELECT i.*, it.name, it.market_hash_name
                FROM investments i
                JOIN items it ON it.id = i.item_id
                WHERE i.user_id = ? AND i.item_id = ?
                ORDER BY i.purchased_at ASC';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$userId, $itemId]);
            return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['userId' => $userId, 'itemId' => $itemId]
            );
            throw $exception;
        }
    }

    public function findExistingExternalTradeIds(array $externalTradeIds, string $platform = 'csfloat'): array
    {
        $normalizedIds = array_values(array_unique(array_filter(array_map(
            static fn ($value) => trim((string) $value),
            $externalTradeIds
        ))));

        if ($normalizedIds === []) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($normalizedIds), '?'));
        $sql = "SELECT external_trade_id FROM investments WHERE platform = ? AND external_trade_id IN ({$placeholders})";

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute(array_merge([$platform], $normalizedIds));
            $rows = $stmt->fetchAll(PDO::FETCH_COLUMN, 0) ?: [];

            $existing = [];
            foreach ($rows as $row) {
                $existing[(string) $row] = true;
            }

            return $existing;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['platform' => $platform, 'ids' => count($normalizedIds)]
            );
            throw $exception;
        }
    }

    public function insertImportedTrade(array $trade): int
    {
        $sql = 'INSERT INTO investments (
                user_id,
                item_id,
                buy_price_usd,
                quantity,
                funding_mode,
                platform,
                external_trade_id,
                purchased_at,
                raw_payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([
                (int) ($trade['userId'] ?? 1),
                (int) ($trade['itemId']),
                (float) ($trade['buyPriceUsd'] ?? 0.0),
                max(1, (int) ($trade['quantity'] ?? 1)),
                (string) ($trade['fundingMode'] ?? 'cash'),
                (string) ($trade['platform'] ?? 'csfloat'),
                (string) ($trade['externalTradeId'] ?? ''),
                $trade['purchasedAt'] ?? date('Y-m-d H:i:s'),
                $trade['rawPayloadJson'] ?? null,
            ]);

            return (int) $this->pdo->lastInsertId();
        } catch (Throwable $exception) {
            RepositoryObservability::upsertFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                [
                    'platform' => $trade['platform'] ?? 'csfloat',
                    'externalTradeId' => $trade['externalTradeId'] ?? null,
                ]
            );
            throw $exception;
        }
    }

    public function upsertImportedTradeSnapshot(array $trade): int
    {
        $sql = 'INSERT INTO investments (
                user_id,
                item_id,
                buy_price_usd,
                quantity,
                funding_mode,
                platform,
                external_trade_id,
                purchased_at,
                raw_payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                buy_price_usd = VALUES(buy_price_usd),
                quantity = VALUES(quantity),
                funding_mode = VALUES(funding_mode),
                purchased_at = CASE
                    WHEN purchased_at IS NULL THEN VALUES(purchased_at)
                    WHEN VALUES(purchased_at) IS NULL THEN purchased_at
                    ELSE LEAST(purchased_at, VALUES(purchased_at))
                END,
                raw_payload_json = VALUES(raw_payload_json)';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([
                (int) ($trade['userId'] ?? 1),
                (int) ($trade['itemId']),
                (float) ($trade['buyPriceUsd'] ?? 0.0),
                max(1, (int) ($trade['quantity'] ?? 1)),
                (string) ($trade['fundingMode'] ?? 'cash'),
                (string) ($trade['platform'] ?? 'csfloat'),
                (string) ($trade['externalTradeId'] ?? ''),
                $trade['purchasedAt'] ?? date('Y-m-d H:i:s'),
                $trade['rawPayloadJson'] ?? null,
            ]);

            return (int) $this->pdo->lastInsertId();
        } catch (Throwable $exception) {
            RepositoryObservability::upsertFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                [
                    'platform' => $trade['platform'] ?? 'csfloat',
                    'externalTradeId' => $trade['externalTradeId'] ?? null,
                ]
            );
            throw $exception;
        }
    }

    public function delete(int $id): bool
    {
        $sql = 'DELETE FROM investments WHERE id = ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $result = $stmt->execute([$id]);
            return $result && $stmt->rowCount() > 0;
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
}
