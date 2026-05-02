<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class PositionHistoryRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS position_history (
            id               INT AUTO_INCREMENT PRIMARY KEY,
            user_id          INT            NOT NULL,
            item_id          INT            NOT NULL,
            date             DATE           NOT NULL,
            quantity_open    INT            NOT NULL,
            avg_buy_price_usd DECIMAL(10,2) NOT NULL,
            exchange_rate_id INT            NOT NULL,
            created_at       TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id)          REFERENCES users(id)          ON DELETE CASCADE,
            FOREIGN KEY (item_id)          REFERENCES items(id),
            FOREIGN KEY (exchange_rate_id) REFERENCES exchange_rates(id),
            UNIQUE idx_user_item_date (user_id, item_id, date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            RepositoryObservability::schemaEnsured(self::class, 'position_history');
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['table' => 'position_history']
            );
            throw $exception;
        }
    }

    public function upsertSnapshot(
        int $userId,
        int $itemId,
        string $date,
        int $quantityOpen,
        float $avgBuyPriceUsd,
        int $exchangeRateId
    ): void {
        $sql = 'INSERT INTO position_history (user_id, item_id, date, quantity_open, avg_buy_price_usd, exchange_rate_id)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                 quantity_open = VALUES(quantity_open),
                 avg_buy_price_usd = VALUES(avg_buy_price_usd),
                 exchange_rate_id = VALUES(exchange_rate_id)';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$userId, $itemId, $date, $quantityOpen, $avgBuyPriceUsd, $exchangeRateId]);
        } catch (Throwable $exception) {
            RepositoryObservability::upsertFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['userId' => $userId, 'itemId' => $itemId, 'date' => $date]
            );
            throw $exception;
        }
    }

    public function findHistoryByItemId(int $userId, int $itemId): array
    {
        $sql = 'SELECT ph.date, ph.quantity_open, ph.avg_buy_price_usd, er.usd_to_eur
                FROM position_history ph
                JOIN exchange_rates er ON er.id = ph.exchange_rate_id
                WHERE ph.user_id = ? AND ph.item_id = ?
                ORDER BY ph.date ASC';

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
}
