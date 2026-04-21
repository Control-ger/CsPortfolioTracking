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
            date DATETIME NOT NULL,
            quantity INT NOT NULL,
            unit_price DECIMAL(10, 2) NOT NULL,
            total_value DECIMAL(12, 2) NOT NULL,
            invested_value DECIMAL(12, 2) NOT NULL DEFAULT 0,
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

        $this->ensureDateColumnSupportsTime();
        $this->ensureInvestedValueColumn();
    }

    public function upsertSnapshot(
        int $investmentId,
        string $date,
        int $quantity,
        float $unitPrice,
        float $totalValue,
        float $investedValue
    ): void {
        $sql = 'INSERT INTO position_history (investment_id, date, quantity, unit_price, total_value, invested_value)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                 quantity = VALUES(quantity),
                 unit_price = VALUES(unit_price),
                 total_value = VALUES(total_value),
                 invested_value = VALUES(invested_value)';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$investmentId, $date, $quantity, $unitPrice, $totalValue, $investedValue]);
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
        $sql = 'SELECT date, quantity, unit_price, total_value, invested_value
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

    public function findHistoryByInvestmentIds(array $investmentIds): array
    {
        $normalizedIds = array_values(array_unique(array_map('intval', $investmentIds)));
        if ($normalizedIds === []) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($normalizedIds), '?'));
        $sql = "SELECT date,
                       SUM(quantity) AS quantity,
                       CASE
                           WHEN SUM(quantity) > 0 THEN SUM(total_value) / SUM(quantity)
                           ELSE 0
                       END AS unit_price,
                       SUM(total_value) AS total_value,
                       SUM(invested_value) AS invested_value
                FROM position_history
                WHERE investment_id IN ({$placeholders})
                GROUP BY date
                ORDER BY date ASC";

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($normalizedIds);
            return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['investmentIds' => count($normalizedIds)]
            );
            throw $exception;
        }
    }

    private function ensureDateColumnSupportsTime(): void
    {
        $checkSql = "SHOW COLUMNS FROM position_history LIKE 'date'";

        try {
            $stmt = $this->pdo->query($checkSql);
            $row = $stmt?->fetch(PDO::FETCH_ASSOC);
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $checkSql,
                $exception,
                ['table' => 'position_history', 'column' => 'date']
            );
            throw $exception;
        }

        $columnType = strtolower((string) ($row['Type'] ?? ''));
        if (str_starts_with($columnType, 'datetime')) {
            return;
        }

        $alterSql = 'ALTER TABLE position_history MODIFY COLUMN date DATETIME NOT NULL';

        try {
            $this->pdo->exec($alterSql);
            RepositoryObservability::migrationColumnAdded(
                self::class,
                'position_history',
                'date_datetime'
            );
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $alterSql,
                $exception,
                ['table' => 'position_history', 'column' => 'date']
            );
            throw $exception;
        }
    }

    private function ensureInvestedValueColumn(): void
    {
        $checkSql = "SHOW COLUMNS FROM position_history LIKE 'invested_value'";

        try {
            $stmt = $this->pdo->query($checkSql);
            $row = $stmt?->fetch(PDO::FETCH_ASSOC);
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $checkSql,
                $exception,
                ['table' => 'position_history', 'column' => 'invested_value']
            );
            throw $exception;
        }

        if ($row !== false && $row !== null) {
            return;
        }

        $alterSql = 'ALTER TABLE position_history ADD COLUMN invested_value DECIMAL(12, 2) NOT NULL DEFAULT 0 AFTER total_value';

        try {
            $this->pdo->exec($alterSql);
            RepositoryObservability::migrationColumnAdded(
                self::class,
                'position_history',
                'invested_value'
            );
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $alterSql,
                $exception,
                ['table' => 'position_history', 'column' => 'invested_value']
            );
            throw $exception;
        }
    }
}
