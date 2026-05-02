<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class UserFeeSettingsRepository
{
    private const DEFAULT_SETTINGS = [
        'fxFeePercent' => 0.0,
        'sellerFeePercent' => 2.0,
        'withdrawalFee' => 2.5,
        'depositFee' => 2.8,
        'depositFeeFixed' => 0.26,
        'source' => 'defaults',
    ];

    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS user_fee_settings (
            id                  INT AUTO_INCREMENT PRIMARY KEY,
            user_id             INT            NOT NULL,
            fx_fee_percent      DECIMAL(5,4)   NOT NULL DEFAULT 0,
            seller_fee_percent  DECIMAL(5,4)   NOT NULL DEFAULT 0,
            withdrawal_fee      DECIMAL(10,2)  NOT NULL DEFAULT 0,
            deposit_fee         DECIMAL(5,4)   NOT NULL DEFAULT 0,
            deposit_fee_fixed   DECIMAL(10,2)  NOT NULL DEFAULT 0,
            valid_from          TIMESTAMP      NOT NULL,
            valid_to            TIMESTAMP      NULL,
            created_at          TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX idx_user_valid (user_id, valid_from)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            RepositoryObservability::schemaEnsured(self::class, 'user_fee_settings');
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['table' => 'user_fee_settings']
            );
            throw $exception;
        }
    }

    public function findCurrentByUserId(int $userId): array
    {
        $this->ensureTable();

        $sql = 'SELECT id, fx_fee_percent, seller_fee_percent, withdrawal_fee, deposit_fee, deposit_fee_fixed
                FROM user_fee_settings
                WHERE user_id = ?
                  AND valid_from <= NOW()
                  AND (valid_to IS NULL OR valid_to > NOW())
                ORDER BY valid_from DESC
                LIMIT 1';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$userId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!is_array($row)) {
                return self::DEFAULT_SETTINGS;
            }

            return [
                'id' => (int) $row['id'],
                'fxFeePercent' => (float) $row['fx_fee_percent'],
                'sellerFeePercent' => (float) $row['seller_fee_percent'],
                'withdrawalFee' => (float) $row['withdrawal_fee'],
                'depositFee' => (float) $row['deposit_fee'],
                'depositFeeFixed' => (float) $row['deposit_fee_fixed'],
                'source' => 'db',
            ];
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

    public function createNewVersion(int $userId, array $settings): array
    {
        $this->ensureTable();

        // Close previous version
        $closeSql = 'UPDATE user_fee_settings SET valid_to = NOW()
                     WHERE user_id = ? AND valid_to IS NULL';
        try {
            $stmt = $this->pdo->prepare($closeSql);
            $stmt->execute([$userId]);
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $closeSql,
                $exception,
                ['userId' => $userId]
            );
            throw $exception;
        }

        // Insert new version
        $sql = 'INSERT INTO user_fee_settings (user_id, fx_fee_percent, seller_fee_percent, withdrawal_fee, deposit_fee, deposit_fee_fixed, valid_from)
                VALUES (?, ?, ?, ?, ?, ?, NOW())';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([
                $userId,
                $settings['fxFeePercent'] ?? 0,
                $settings['sellerFeePercent'] ?? 0,
                $settings['withdrawalFee'] ?? 0,
                $settings['depositFee'] ?? 0,
                $settings['depositFeeFixed'] ?? 0,
            ]);

            $stored = $this->findCurrentByUserId($userId);
            $stored['source'] = 'db';
            return $stored;
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

