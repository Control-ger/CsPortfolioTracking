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
        'withdrawalFeePercent' => 2.5,
        'depositFeePercent' => 2.8,
        'depositFeeFixedEur' => 0.26,
        'source' => 'defaults',
    ];

    private bool $tableReady = false;

    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        if ($this->tableReady) {
            return;
        }

        $sql = "CREATE TABLE IF NOT EXISTS user_fee_settings (
            id INT PRIMARY KEY,
            fx_fee_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00,
            seller_fee_percent DECIMAL(5,2) NOT NULL DEFAULT 2.00,
            withdrawal_fee_percent DECIMAL(5,2) NOT NULL DEFAULT 2.50,
            deposit_fee_percent DECIMAL(5,2) NOT NULL DEFAULT 2.80,
            deposit_fee_fixed_eur DECIMAL(10,2) NOT NULL DEFAULT 0.26,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            $this->tableReady = true;
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

    public function findOrDefault(): array
    {
        $this->ensureTable();

        $sql = 'SELECT fx_fee_percent, seller_fee_percent, withdrawal_fee_percent, deposit_fee_percent, deposit_fee_fixed_eur
            FROM user_fee_settings WHERE id = 1 LIMIT 1';

        try {
            $stmt = $this->pdo->query($sql);
            $row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : false;

            if (!is_array($row)) {
                return self::DEFAULT_SETTINGS;
            }

            return [
                'fxFeePercent' => (float) $row['fx_fee_percent'],
                'sellerFeePercent' => (float) $row['seller_fee_percent'],
                'withdrawalFeePercent' => (float) $row['withdrawal_fee_percent'],
                'depositFeePercent' => (float) $row['deposit_fee_percent'],
                'depositFeeFixedEur' => (float) $row['deposit_fee_fixed_eur'],
                'source' => 'db',
            ];
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

    public function upsert(array $settings): array
    {
        $this->ensureTable();

        $sql = 'INSERT INTO user_fee_settings (
                id,
                fx_fee_percent,
                seller_fee_percent,
                withdrawal_fee_percent,
                deposit_fee_percent,
                deposit_fee_fixed_eur
            ) VALUES (1, :fx, :seller, :withdrawal, :depositPercent, :depositFixed)
            ON DUPLICATE KEY UPDATE
                fx_fee_percent = VALUES(fx_fee_percent),
                seller_fee_percent = VALUES(seller_fee_percent),
                withdrawal_fee_percent = VALUES(withdrawal_fee_percent),
                deposit_fee_percent = VALUES(deposit_fee_percent),
                deposit_fee_fixed_eur = VALUES(deposit_fee_fixed_eur),
                updated_at = CURRENT_TIMESTAMP';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([
                ':fx' => $settings['fxFeePercent'],
                ':seller' => $settings['sellerFeePercent'],
                ':withdrawal' => $settings['withdrawalFeePercent'],
                ':depositPercent' => $settings['depositFeePercent'],
                ':depositFixed' => $settings['depositFeeFixedEur'],
            ]);

            $stored = $this->findOrDefault();
            $stored['source'] = 'db';
            return $stored;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                $settings
            );
            throw $exception;
        }
    }
}

