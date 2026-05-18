<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class UserPriceSourcePreferenceRepository
{
    public const MODE_AUTO = 'auto';
    public const MODE_CSFLOAT = 'csfloat';
    public const MODE_STEAM = 'steam';

    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS user_price_source_preferences (
            user_id            INT            NOT NULL PRIMARY KEY,
            preferred_source   VARCHAR(16)    NOT NULL DEFAULT 'auto',
            created_at         TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at         TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX idx_preferred_source (preferred_source)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            RepositoryObservability::schemaEnsured(self::class, 'user_price_source_preferences');
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['table' => 'user_price_source_preferences']
            );
            throw $exception;
        }
    }

    public function getByUserId(int $userId): array
    {
        $this->ensureTable();

        $sql = 'SELECT user_id, preferred_source, updated_at
                FROM user_price_source_preferences
                WHERE user_id = ?
                LIMIT 1';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$userId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!is_array($row)) {
                return [
                    'userId' => $userId,
                    'mode' => self::MODE_AUTO,
                    'updatedAt' => null,
                    'source' => 'defaults',
                ];
            }

            return [
                'userId' => (int) ($row['user_id'] ?? $userId),
                'mode' => $this->normalizeMode($row['preferred_source'] ?? null),
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

    public function upsertByUserId(int $userId, string $mode): array
    {
        $this->ensureTable();

        $normalizedMode = $this->normalizeMode($mode);
        $sql = 'INSERT INTO user_price_source_preferences (
                    user_id, preferred_source
                ) VALUES (?, ?)
                ON DUPLICATE KEY UPDATE
                    preferred_source = VALUES(preferred_source),
                    updated_at = CURRENT_TIMESTAMP';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$userId, $normalizedMode]);
            return $this->getByUserId($userId);
        } catch (Throwable $exception) {
            RepositoryObservability::upsertFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['userId' => $userId, 'mode' => $normalizedMode]
            );
            throw $exception;
        }
    }

    public function normalizeMode(?string $mode): string
    {
        $normalized = strtolower(trim((string) $mode));

        return match ($normalized) {
            self::MODE_CSFLOAT => self::MODE_CSFLOAT,
            self::MODE_STEAM => self::MODE_STEAM,
            default => self::MODE_AUTO,
        };
    }
}
