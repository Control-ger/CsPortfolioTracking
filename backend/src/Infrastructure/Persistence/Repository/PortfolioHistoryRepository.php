<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class PortfolioHistoryRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS portfolio_history (
            id INT AUTO_INCREMENT PRIMARY KEY,
            date DATETIME NOT NULL UNIQUE,
            total_value DECIMAL(10, 2) NOT NULL,
            invested_value DECIMAL(12, 2) NOT NULL DEFAULT 0,
            growth_percent DECIMAL(8, 4) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_date (date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            RepositoryObservability::schemaEnsured(self::class, 'portfolio_history');
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['table' => 'portfolio_history']
            );
            throw $exception;
        }

        $this->ensureDateColumnSupportsTime();
        $this->ensureInvestedValueColumn();
        $this->ensureGrowthPercentColumn();
    }

    public function findAll(): array
    {
        $sql = 'SELECT id, date, total_value, invested_value, growth_percent FROM portfolio_history ORDER BY date ASC';

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

    public function upsertForDate(string $date, float $totalValue, float $investedValue, ?float $growthPercent = null): void
    {
        $sql = 'INSERT INTO portfolio_history (date, total_value, invested_value, growth_percent) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE total_value = VALUES(total_value), invested_value = VALUES(invested_value), growth_percent = VALUES(growth_percent)';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$date, $totalValue, $investedValue, $growthPercent]);
        } catch (Throwable $exception) {
            RepositoryObservability::upsertFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['date' => $date]
            );
            throw $exception;
        }
    }

    private function ensureDateColumnSupportsTime(): void
    {
        $checkSql = "SHOW COLUMNS FROM portfolio_history LIKE 'date'";

        try {
            $stmt = $this->pdo->query($checkSql);
            $row = $stmt?->fetch(PDO::FETCH_ASSOC);
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $checkSql,
                $exception,
                ['table' => 'portfolio_history', 'column' => 'date']
            );
            throw $exception;
        }

        $columnType = strtolower((string) ($row['Type'] ?? ''));
        if (str_starts_with($columnType, 'datetime')) {
            return;
        }

        $alterSql = 'ALTER TABLE portfolio_history MODIFY COLUMN date DATETIME NOT NULL';

        try {
            $this->pdo->exec($alterSql);
            RepositoryObservability::migrationColumnAdded(
                self::class,
                'portfolio_history',
                'date_datetime'
            );
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $alterSql,
                $exception,
                ['table' => 'portfolio_history', 'column' => 'date']
            );
            throw $exception;
        }
    }

    private function ensureInvestedValueColumn(): void
    {
        $checkSql = "SHOW COLUMNS FROM portfolio_history LIKE 'invested_value'";

        try {
            $stmt = $this->pdo->query($checkSql);
            $row = $stmt?->fetch(PDO::FETCH_ASSOC);
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $checkSql,
                $exception,
                ['table' => 'portfolio_history', 'column' => 'invested_value']
            );
            throw $exception;
        }

        if ($row !== false && $row !== null) {
            return;
        }

        $alterSql = 'ALTER TABLE portfolio_history ADD COLUMN invested_value DECIMAL(12, 2) NOT NULL DEFAULT 0 AFTER total_value';

        try {
            $this->pdo->exec($alterSql);
            RepositoryObservability::migrationColumnAdded(
                self::class,
                'portfolio_history',
                'invested_value'
            );
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $alterSql,
                $exception,
                ['table' => 'portfolio_history', 'column' => 'invested_value']
            );
            throw $exception;
        }
    }

    private function ensureGrowthPercentColumn(): void
    {
        // Ensure invested_value exists first (required for AFTER clause)
        $this->ensureInvestedValueColumn();

        $checkSql = "SHOW COLUMNS FROM portfolio_history LIKE 'growth_percent'";

        try {
            $stmt = $this->pdo->query($checkSql);
            $row = $stmt?->fetch(PDO::FETCH_ASSOC);
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $checkSql,
                $exception,
                ['table' => 'portfolio_history', 'column' => 'growth_percent']
            );
            throw $exception;
        }

        if ($row !== false && $row !== null) {
            return;
        }

        $alterSql = 'ALTER TABLE portfolio_history ADD COLUMN growth_percent DECIMAL(8, 4) NULL AFTER invested_value';

        try {
            $this->pdo->exec($alterSql);
            RepositoryObservability::migrationColumnAdded(
                self::class,
                'portfolio_history',
                'growth_percent'
            );
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $alterSql,
                $exception,
                ['table' => 'portfolio_history', 'column' => 'growth_percent']
            );
            throw $exception;
        }
    }
}
