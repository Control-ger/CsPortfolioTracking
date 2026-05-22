<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class WebPushSubscriptionRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS web_push_subscriptions (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id INT NOT NULL,
            endpoint TEXT NOT NULL,
            endpoint_hash CHAR(64) NOT NULL,
            p256dh_key VARCHAR(255) NULL,
            auth_key VARCHAR(255) NULL,
            content_encoding VARCHAR(32) NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            failure_count INT NOT NULL DEFAULT 0,
            last_success_at DATETIME NULL,
            last_failure_at DATETIME NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY ux_web_push_endpoint_hash (endpoint_hash),
            KEY ix_web_push_user_active (user_id, is_active),
            KEY ix_web_push_active (is_active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            RepositoryObservability::schemaEnsured(self::class, 'web_push_subscriptions');
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['table' => 'web_push_subscriptions']
            );
            throw $exception;
        }
    }

    public function upsert(int $userId, string $endpoint, ?string $p256dhKey, ?string $authKey, ?string $contentEncoding): void
    {
        $this->ensureTable();

        $endpointHash = hash('sha256', $endpoint);
        $sql = "INSERT INTO web_push_subscriptions (
                    user_id, endpoint, endpoint_hash, p256dh_key, auth_key, content_encoding, is_active, failure_count
                ) VALUES (?, ?, ?, ?, ?, ?, 1, 0)
                ON DUPLICATE KEY UPDATE
                    user_id = VALUES(user_id),
                    endpoint = VALUES(endpoint),
                    p256dh_key = VALUES(p256dh_key),
                    auth_key = VALUES(auth_key),
                    content_encoding = VALUES(content_encoding),
                    is_active = 1,
                    failure_count = 0,
                    updated_at = CURRENT_TIMESTAMP";

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([
                $userId,
                $endpoint,
                $endpointHash,
                $p256dhKey,
                $authKey,
                $contentEncoding,
            ]);
        } catch (Throwable $exception) {
            RepositoryObservability::upsertFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['userId' => $userId, 'endpointHash' => $endpointHash]
            );
            throw $exception;
        }
    }

    public function deactivateByEndpoint(string $endpoint, ?int $userId = null): void
    {
        $this->ensureTable();

        $endpointHash = hash('sha256', $endpoint);
        $sql = "UPDATE web_push_subscriptions
                SET is_active = 0, updated_at = CURRENT_TIMESTAMP
                WHERE endpoint_hash = ?";
        $params = [$endpointHash];

        if ($userId !== null && $userId > 0) {
            $sql .= " AND user_id = ?";
            $params[] = $userId;
        }

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['endpointHash' => $endpointHash, 'userId' => $userId]
            );
            throw $exception;
        }
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public function listActive(int $limit = 500): array
    {
        $this->ensureTable();

        $resolvedLimit = max(1, min(2000, $limit));
        $sql = "SELECT id, user_id, endpoint, endpoint_hash, p256dh_key, auth_key, content_encoding, failure_count
                FROM web_push_subscriptions
                WHERE is_active = 1
                ORDER BY id DESC
                LIMIT ?";

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->bindValue(1, $resolvedLimit, PDO::PARAM_INT);
            $stmt->execute();
            return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
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

    public function markDeliverySuccess(string $endpoint): void
    {
        $this->ensureTable();

        $sql = "UPDATE web_push_subscriptions
                SET last_success_at = UTC_TIMESTAMP(), failure_count = 0, updated_at = CURRENT_TIMESTAMP
                WHERE endpoint_hash = ?";
        $endpointHash = hash('sha256', $endpoint);

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([$endpointHash]);
    }

    public function markDeliveryFailure(string $endpoint, bool $deactivate = false): void
    {
        $this->ensureTable();

        $endpointHash = hash('sha256', $endpoint);
        $sql = "UPDATE web_push_subscriptions
                SET last_failure_at = UTC_TIMESTAMP(),
                    failure_count = failure_count + 1,
                    is_active = CASE WHEN ? = 1 THEN 0 ELSE is_active END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE endpoint_hash = ?";

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([$deactivate ? 1 : 0, $endpointHash]);
    }
}

