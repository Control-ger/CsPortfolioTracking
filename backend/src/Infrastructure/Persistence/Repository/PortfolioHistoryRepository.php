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
            id                  INT AUTO_INCREMENT PRIMARY KEY,
            user_id             INT            NOT NULL,
            date                DATE           NOT NULL,
            fee_setting_id      INT            NOT NULL,
            total_value_usd     DECIMAL(12,2)  NOT NULL,
            invested_value_usd  DECIMAL(12,2)  NOT NULL,
            realized_pnl_usd    DECIMAL(12,2)  NOT NULL DEFAULT 0,
            created_at          TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id)        REFERENCES users(id)             ON DELETE CASCADE,
            FOREIGN KEY (fee_setting_id) REFERENCES user_fee_settings(id),
            UNIQUE idx_user_date (user_id, date)
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
    }

    public function findAll(int $userId): array
    {
        $sql = 'SELECT id, date, total_value_usd, invested_value_usd, realized_pnl_usd
                FROM portfolio_history
                WHERE user_id = ?
                ORDER BY date ASC';

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

    public function upsertForDate(int $userId, string $date, int $feeSettingId, float $totalValueUsd, float $investedValueUsd, float $realizedPnlUsd = 0): void
    {
        $sql = 'INSERT INTO portfolio_history (user_id, date, fee_setting_id, total_value_usd, invested_value_usd, realized_pnl_usd)
                VALUES (?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    fee_setting_id = VALUES(fee_setting_id),
                    total_value_usd = VALUES(total_value_usd),
                    invested_value_usd = VALUES(invested_value_usd),
                    realized_pnl_usd = VALUES(realized_pnl_usd)';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$userId, $date, $feeSettingId, $totalValueUsd, $investedValueUsd, $realizedPnlUsd]);
        } catch (Throwable $exception) {
            RepositoryObservability::upsertFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['userId' => $userId, 'date' => $date]
            );
            throw $exception;
        }
    }
}
