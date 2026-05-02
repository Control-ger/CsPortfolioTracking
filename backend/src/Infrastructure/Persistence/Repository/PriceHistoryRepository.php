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
            date             DATE           NOT NULL,
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
