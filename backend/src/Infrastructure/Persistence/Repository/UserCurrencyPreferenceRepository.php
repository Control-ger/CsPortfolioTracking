<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class UserCurrencyPreferenceRepository
{
    public const DEFAULT_CURRENCY = 'EUR';

    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTables(): void
    {
        $preferenceSql = "CREATE TABLE IF NOT EXISTS user_currency_preferences (
            user_id             INT            NOT NULL PRIMARY KEY,
            preferred_currency  CHAR(3)        NOT NULL DEFAULT 'EUR',
            created_at          TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at          TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX idx_currency_code (preferred_currency)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        $usageSql = "CREATE TABLE IF NOT EXISTS currency_usage_stats (
            currency_code       CHAR(3)         NOT NULL PRIMARY KEY,
            active_users        INT UNSIGNED    NOT NULL DEFAULT 0,
            selection_events    BIGINT UNSIGNED NOT NULL DEFAULT 0,
            last_selected_at    TIMESTAMP       NULL DEFAULT NULL,
            updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_active_users (active_users),
            INDEX idx_selection_events (selection_events)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($preferenceSql);
            RepositoryObservability::schemaEnsured(self::class, 'user_currency_preferences');
            $this->pdo->exec($usageSql);
            RepositoryObservability::schemaEnsured(self::class, 'currency_usage_stats');
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $preferenceSql . "\n" . $usageSql,
                $exception
            );
            throw $exception;
        }
    }

    public function getByUserId(int $userId): array
    {
        $this->ensureTables();

        $sql = 'SELECT user_id, preferred_currency, updated_at
                FROM user_currency_preferences
                WHERE user_id = ?
                LIMIT 1';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$userId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!is_array($row)) {
                return [
                    'userId' => $userId,
                    'currency' => self::DEFAULT_CURRENCY,
                    'updatedAt' => null,
                    'source' => 'defaults',
                ];
            }

            return [
                'userId' => (int) ($row['user_id'] ?? $userId),
                'currency' => $this->normalizeCurrency($row['preferred_currency'] ?? null),
                'updatedAt' => isset($row['updated_at']) ? (string) $row['updated_at'] : null,
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

    public function listPopularCurrencies(int $limit = 12): array
    {
        $this->ensureTables();

        $resolvedLimit = max(1, min($limit, 50));
        $sql = 'SELECT currency_code, active_users, selection_events, last_selected_at
                FROM currency_usage_stats
                WHERE active_users > 0
                ORDER BY active_users DESC, selection_events DESC, currency_code ASC
                LIMIT ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->bindValue(1, $resolvedLimit, PDO::PARAM_INT);
            $stmt->execute();
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

            if (!is_array($rows)) {
                return [];
            }

            return array_values(array_filter(array_map(function ($row): ?array {
                if (!is_array($row)) {
                    return null;
                }

                $currencyCode = $this->normalizeCurrency($row['currency_code'] ?? null);
                if ($currencyCode === '') {
                    return null;
                }

                return [
                    'currency' => $currencyCode,
                    'activeUsers' => max(0, (int) ($row['active_users'] ?? 0)),
                    'selectionEvents' => max(0, (int) ($row['selection_events'] ?? 0)),
                    'lastSelectedAt' => isset($row['last_selected_at']) ? (string) $row['last_selected_at'] : null,
                ];
            }, $rows)));
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['limit' => $resolvedLimit]
            );
            throw $exception;
        }
    }

    public function upsertByUserId(int $userId, string $currency): array
    {
        $this->ensureTables();

        $normalizedCurrency = $this->normalizeCurrency($currency);
        $upsertSql = 'INSERT INTO user_currency_preferences (
                user_id, preferred_currency
            ) VALUES (?, ?)
            ON DUPLICATE KEY UPDATE
                preferred_currency = VALUES(preferred_currency),
                updated_at = CURRENT_TIMESTAMP';

        try {
            $previousCurrency = $this->readStoredCurrency($userId);

            $this->pdo->beginTransaction();
            $stmt = $this->pdo->prepare($upsertSql);
            $stmt->execute([$userId, $normalizedCurrency]);

            // Anonymized stats table intentionally stores only per-currency aggregates.
            $this->incrementSelectionEvents($normalizedCurrency);

            if ($previousCurrency === null) {
                $this->incrementActiveUsers($normalizedCurrency);
            } elseif ($previousCurrency !== $normalizedCurrency) {
                $this->decrementActiveUsers($previousCurrency);
                $this->incrementActiveUsers($normalizedCurrency);
            }

            $this->pdo->commit();
            return $this->getByUserId($userId);
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }

            RepositoryObservability::upsertFailed(
                self::class,
                __FUNCTION__,
                $upsertSql,
                $exception,
                ['userId' => $userId, 'currency' => $normalizedCurrency]
            );
            throw $exception;
        }
    }

    public function normalizeCurrency(?string $currency): string
    {
        $normalized = strtoupper(trim((string) $currency));
        if (preg_match('/^[A-Z]{3}$/', $normalized) !== 1) {
            return self::DEFAULT_CURRENCY;
        }

        return $normalized;
    }

    private function readStoredCurrency(int $userId): ?string
    {
        $sql = 'SELECT preferred_currency
                FROM user_currency_preferences
                WHERE user_id = ?
                LIMIT 1';

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([$userId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            return null;
        }

        $normalized = strtoupper(trim((string) ($row['preferred_currency'] ?? '')));
        return preg_match('/^[A-Z]{3}$/', $normalized) === 1 ? $normalized : null;
    }

    private function incrementSelectionEvents(string $currency): void
    {
        $sql = 'INSERT INTO currency_usage_stats (
                    currency_code, active_users, selection_events, last_selected_at
                ) VALUES (?, 0, 1, CURRENT_TIMESTAMP)
                ON DUPLICATE KEY UPDATE
                    selection_events = selection_events + 1,
                    last_selected_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP';
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([$currency]);
    }

    private function incrementActiveUsers(string $currency): void
    {
        $sql = 'INSERT INTO currency_usage_stats (
                    currency_code, active_users, selection_events, last_selected_at
                ) VALUES (?, 1, 0, CURRENT_TIMESTAMP)
                ON DUPLICATE KEY UPDATE
                    active_users = active_users + 1,
                    last_selected_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP';
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([$currency]);
    }

    private function decrementActiveUsers(string $currency): void
    {
        $sql = 'UPDATE currency_usage_stats
                SET active_users = GREATEST(active_users - 1, 0),
                    updated_at = CURRENT_TIMESTAMP
                WHERE currency_code = ?';
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([$currency]);
    }
}
