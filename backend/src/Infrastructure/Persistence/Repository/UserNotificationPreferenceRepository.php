<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

/**
 * Per-user web-push notification preferences (server-owned).
 *
 * These are the only notification settings that must live on the server, because
 * the server decides which subscriptions to wake. Desktop system-notification
 * settings stay in the Electron SQLite preference blob and never reach here.
 */
final class UserNotificationPreferenceRepository
{
    public const IMPACT_LEVELS = ['none', 'low', 'medium', 'high'];

    // Defaults for a user without a stored row. CS-updates push is ON so that a
    // user who enabled web push + granted OS permission is not silently skipped;
    // the 'high' threshold preserves the historical "only high-impact wakes
    // everyone" behaviour while letting users opt into lower thresholds.
    private const DEFAULT_NOTIFY_CS_UPDATES = true;
    private const DEFAULT_CS_UPDATES_MIN_LEVEL = 'high';

    public function __construct(private readonly PDO $pdo)
    {
    }

    public static function impactIndex(?string $level): int
    {
        $normalized = strtolower(trim((string) $level));
        $index = array_search($normalized, self::IMPACT_LEVELS, true);

        return $index === false ? -1 : (int) $index;
    }

    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS user_notification_preferences (
            user_id                        INT          NOT NULL PRIMARY KEY,
            notify_cs_updates_web_push     TINYINT(1)   NOT NULL DEFAULT 1,
            cs_updates_web_push_min_level  VARCHAR(16)  NOT NULL DEFAULT 'high',
            created_at                     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at                     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            RepositoryObservability::schemaEnsured(self::class, 'user_notification_preferences');
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['table' => 'user_notification_preferences']
            );
            throw $exception;
        }
    }

    /**
     * @return array<string,mixed>
     */
    public function getByUserId(int $userId): array
    {
        $this->ensureTable();

        $sql = 'SELECT user_id, notify_cs_updates_web_push, cs_updates_web_push_min_level, updated_at
                FROM user_notification_preferences
                WHERE user_id = ?
                LIMIT 1';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$userId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!is_array($row)) {
                return [
                    'userId' => $userId,
                    'notifyCsUpdatesWebPush' => self::DEFAULT_NOTIFY_CS_UPDATES,
                    'notifyCsUpdatesWebPushMinLevel' => self::DEFAULT_CS_UPDATES_MIN_LEVEL,
                    'updatedAt' => null,
                    'source' => 'defaults',
                ];
            }

            return [
                'userId' => (int) ($row['user_id'] ?? $userId),
                'notifyCsUpdatesWebPush' => (int) ($row['notify_cs_updates_web_push'] ?? 1) === 1,
                'notifyCsUpdatesWebPushMinLevel' => $this->normalizeLevel(
                    $row['cs_updates_web_push_min_level'] ?? null
                ),
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

    /**
     * @param array<string,mixed> $patch Partial patch; only provided keys are written.
     * @return array<string,mixed>
     */
    public function upsertByUserId(int $userId, array $patch): array
    {
        $this->ensureTable();

        $current = $this->getByUserId($userId);

        $notify = array_key_exists('notifyCsUpdatesWebPush', $patch)
            ? $this->normalizeBoolean($patch['notifyCsUpdatesWebPush'])
            : (bool) $current['notifyCsUpdatesWebPush'];
        $minLevel = array_key_exists('notifyCsUpdatesWebPushMinLevel', $patch)
            ? $this->normalizeLevel($patch['notifyCsUpdatesWebPushMinLevel'])
            : (string) $current['notifyCsUpdatesWebPushMinLevel'];

        $sql = 'INSERT INTO user_notification_preferences (
                    user_id, notify_cs_updates_web_push, cs_updates_web_push_min_level
                ) VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    notify_cs_updates_web_push = VALUES(notify_cs_updates_web_push),
                    cs_updates_web_push_min_level = VALUES(cs_updates_web_push_min_level),
                    updated_at = CURRENT_TIMESTAMP';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$userId, $notify ? 1 : 0, $minLevel]);
            return $this->getByUserId($userId);
        } catch (Throwable $exception) {
            RepositoryObservability::upsertFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['userId' => $userId]
            );
            throw $exception;
        }
    }

    private function normalizeLevel(?string $level): string
    {
        $normalized = strtolower(trim((string) $level));

        return in_array($normalized, self::IMPACT_LEVELS, true)
            ? $normalized
            : self::DEFAULT_CS_UPDATES_MIN_LEVEL;
    }

    private function normalizeBoolean(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if (is_int($value)) {
            return $value === 1;
        }

        return strtolower(trim((string) $value)) === 'true' || (string) $value === '1';
    }
}
