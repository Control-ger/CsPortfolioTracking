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
            id INT AUTO_INCREMENT PRIMARY KEY,
            investment_id INT NOT NULL,
            date DATE NOT NULL,
            quantity INT NOT NULL,
            unit_price DECIMAL(10, 2) NOT NULL,
            total_value DECIMAL(12, 2) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_investment_date (investment_id, date),
            INDEX idx_investment_date (investment_id, date)
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
        int $investmentId,
        string $date,
        int $quantity,
        float $unitPrice,
        float $totalValue
    ): void {
        $sql = 'INSERT INTO position_history (investment_id, date, quantity, unit_price, total_value)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                 quantity = VALUES(quantity),
                 unit_price = VALUES(unit_price),
                 total_value = VALUES(total_value)';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$investmentId, $date, $quantity, $unitPrice, $totalValue]);
        } catch (Throwable $exception) {
            RepositoryObservability::upsertFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['investmentId' => $investmentId, 'date' => $date]
            );
            throw $exception;
        }
    }

    public function findHistoryByInvestmentId(int $investmentId): array
    {
        $sql = 'SELECT date, quantity, unit_price, total_value
             FROM position_history
             WHERE investment_id = ?
             ORDER BY date ASC';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$investmentId]);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            if ($rows === []) {
                RepositoryObservability::resultEmptyUnexpected(
                    self::class,
                    __FUNCTION__,
                    ['investmentId' => $investmentId]
                );
            }

            return $rows;
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
}
