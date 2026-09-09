<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class SaleRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS sales (
            id                INT AUTO_INCREMENT PRIMARY KEY,
            user_id           INT            NOT NULL,
            item_id           INT            NOT NULL,
            quantity          INT            NOT NULL,
            sell_price_usd    DECIMAL(10,2)  NOT NULL,
            platform          VARCHAR(64),
            external_trade_id VARCHAR(255),
            sold_at           TIMESTAMP      NOT NULL,
            created_at        TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (item_id) REFERENCES items(id),
            INDEX idx_user_item (user_id, item_id),
            INDEX idx_sold_at (sold_at),
            -- Identity bridge for the sync entity: the desktop's local UUID
            -- lands here when a sale carries no real marketplace trade id, so a
            -- re-push updates instead of duplicating.
            --
            -- Scoped by user_id, unlike `investments`' equivalent key. Without
            -- the scope two accounts sharing a (platform, trade id) pair collide
            -- on one row, and `ON DUPLICATE KEY UPDATE` would overwrite the
            -- other account's sale.
            UNIQUE KEY uq_sale_external_trade (user_id, platform, external_trade_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            RepositoryObservability::schemaEnsured(self::class, 'sales');
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['table' => 'sales']
            );
            throw $exception;
        }

        $this->ensureSaleAllocationsTable();
        $this->ensureUserScopedTradeKey();
    }

    /**
     * Re-scope the identity key on tables created before it carried `user_id`.
     *
     * `CREATE TABLE IF NOT EXISTS` is a no-op on an existing table, so a server
     * that already received a sale keeps the unscoped key until this runs.
     */
    private function ensureUserScopedTradeKey(): void
    {
        try {
            $stmt = $this->pdo->query(
                "SELECT COUNT(*) AS c
                   FROM information_schema.STATISTICS
                  WHERE TABLE_SCHEMA = DATABASE()
                    AND TABLE_NAME = 'sales'
                    AND INDEX_NAME = 'uq_sale_external_trade'
                    AND COLUMN_NAME = 'user_id'"
            );
            $row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : false;
            if ($row !== false && (int) ($row['c'] ?? 0) > 0) {
                return;
            }

            $this->pdo->exec('ALTER TABLE sales DROP INDEX uq_sale_external_trade');
            $this->pdo->exec(
                'ALTER TABLE sales
                    ADD UNIQUE KEY uq_sale_external_trade (user_id, platform, external_trade_id)'
            );
            RepositoryObservability::schemaEnsured(self::class, 'sales.uq_sale_external_trade');
        } catch (Throwable $exception) {
            // A duplicate row under the new, narrower key would fail the ADD.
            // Do not let that take the sync path down: the unscoped key still
            // enforces uniqueness, just too broadly.
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                'ALTER TABLE sales ... uq_sale_external_trade',
                $exception,
                ['table' => 'sales']
            );
        }
    }

    private function ensureSaleAllocationsTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS sale_allocations (
            id            INT AUTO_INCREMENT PRIMARY KEY,
            sale_id       INT NOT NULL,
            investment_id INT NOT NULL,
            quantity      INT NOT NULL,
            -- Captured when the allocation is made, never read back off the
            -- purchase row: the management UI lets a lot be re-priced later, and
            -- a realised gain must not change retroactively when it is.
            buy_price_usd DECIMAL(10,2) NULL,
            created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (sale_id)       REFERENCES sales(id)       ON DELETE CASCADE,
            FOREIGN KEY (investment_id) REFERENCES investments(id),
            INDEX idx_sale (sale_id),
            INDEX idx_investment (investment_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            RepositoryObservability::schemaEnsured(self::class, 'sale_allocations');
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['table' => 'sale_allocations']
            );
            throw $exception;
        }
    }

    public function create(int $userId, int $itemId, int $quantity, float $sellPriceUsd, string $soldAt, ?string $platform = null, ?string $externalTradeId = null): int
    {
        $sql = 'INSERT INTO sales (user_id, item_id, quantity, sell_price_usd, platform, external_trade_id, sold_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$userId, $itemId, $quantity, $sellPriceUsd, $platform, $externalTradeId, $soldAt]);
            return (int) $this->pdo->lastInsertId();
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

    public function createAllocation(int $saleId, int $investmentId, int $quantity, ?float $buyPriceUsd = null): void
    {
        $sql = 'INSERT INTO sale_allocations (sale_id, investment_id, quantity, buy_price_usd)
                VALUES (?, ?, ?, ?)';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$saleId, $investmentId, $quantity, $buyPriceUsd]);
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['saleId' => $saleId, 'investmentId' => $investmentId]
            );
            throw $exception;
        }
    }

    public function getRemainingQuantity(int $investmentId): int
    {
        $sql = 'SELECT i.quantity - COALESCE(SUM(sa.quantity), 0) AS remaining
                FROM investments i
                LEFT JOIN sale_allocations sa ON sa.investment_id = i.id
                WHERE i.id = ?
                GROUP BY i.id';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$investmentId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return $row !== false ? (int) $row['remaining'] : 0;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['investmentId' => $investmentId]
            );
            throw $exception;
        }
    }

    public function getRealizedPnl(int $saleId): ?array
    {
        $sql = 'SELECT
                    s.sell_price_usd * s.quantity AS revenue,
                    SUM(COALESCE(sa.buy_price_usd, inv.buy_price_usd) * sa.quantity) AS cost,
                    (s.sell_price_usd * s.quantity)
                        - SUM(COALESCE(sa.buy_price_usd, inv.buy_price_usd) * sa.quantity) AS pnl
                FROM sales s
                JOIN sale_allocations sa ON sa.sale_id = s.id
                JOIN investments inv ON inv.id = sa.investment_id
                WHERE s.id = ?
                GROUP BY s.id';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$saleId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return $row !== false ? $row : null;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['saleId' => $saleId]
            );
            throw $exception;
        }
    }

    public function findByUserId(int $userId): array
    {
        $sql = 'SELECT s.*, i.name AS item_name, i.market_hash_name
                FROM sales s
                JOIN items i ON i.id = s.item_id
                WHERE s.user_id = ?
                ORDER BY s.sold_at DESC';

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
}
