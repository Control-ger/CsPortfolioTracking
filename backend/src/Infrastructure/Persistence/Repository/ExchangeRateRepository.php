<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class ExchangeRateRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS exchange_rates (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            date        DATE           NOT NULL UNIQUE,
            usd_to_eur  DECIMAL(10,6)  NOT NULL,
            source      VARCHAR(64),
            created_at  TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_date (date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            RepositoryObservability::schemaEnsured(self::class, 'exchange_rates');
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['table' => 'exchange_rates']
            );
            throw $exception;
        }
    }

    public function findRateByDate(string $date): ?array
    {
        $sql = 'SELECT id, date, usd_to_eur, source FROM exchange_rates WHERE date = ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$date]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return $row ?: null;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['date' => $date]
            );
            throw $exception;
        }
    }

    public function findLatestRate(): ?array
    {
        $sql = 'SELECT id, date, usd_to_eur, source FROM exchange_rates ORDER BY date DESC LIMIT 1';

        try {
            $stmt = $this->pdo->query($sql);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return $row ?: null;
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

    public function upsertRate(string $date, float $usdToEur, string $source = 'api'): int
    {
        $sql = 'INSERT INTO exchange_rates (date, usd_to_eur, source)
                VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE usd_to_eur = VALUES(usd_to_eur), source = VALUES(source)';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$date, $usdToEur, $source]);

            $existing = $this->findRateByDate($date);
            return $existing !== null ? (int) $existing['id'] : (int) $this->pdo->lastInsertId();
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['date' => $date]
            );
            throw $exception;
        }
    }

    public function ensureTodayRate(float $usdToEur, string $source = 'api'): int
    {
        $this->ensureTable();
        $today = date('Y-m-d');
        $existing = $this->findRateByDate($today);
        if ($existing !== null) {
            return (int) $existing['id'];
        }
        return $this->upsertRate($today, $usdToEur, $source);
    }
}
