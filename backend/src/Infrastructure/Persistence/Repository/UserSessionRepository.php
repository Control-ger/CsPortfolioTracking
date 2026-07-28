<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

/**
 * Revocation registry for issued session tokens.
 *
 * The session token itself stays stateless (AES-256-GCM, self-contained); this
 * table only answers "is this token still allowed to be used". Without it a
 * leaked token was valid for its full 30 days and the only kill switch was
 * rotating ENCRYPTION_KEY, which logs out every user at once.
 *
 * Keyed by the token's `jti` claim, so a token can be revoked without storing
 * the token (or anything derived from it that would allow reconstruction).
 */
final class UserSessionRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS user_sessions (
            id            INT AUTO_INCREMENT PRIMARY KEY,
            jti           CHAR(32)     NOT NULL,
            user_id       INT          NOT NULL,
            steam_id      VARCHAR(32)  NULL,
            issued_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at    TIMESTAMP    NOT NULL,
            revoked_at    TIMESTAMP    NULL DEFAULT NULL,
            UNIQUE KEY uq_jti (jti),
            INDEX idx_user (user_id),
            INDEX idx_expires (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
        } catch (Throwable $exception) {
            error_log('Failed to create user_sessions table: ' . $exception->getMessage());
            throw $exception;
        }
    }

    public function record(string $jti, int $userId, ?string $steamId, int $expiresAtUnix): void
    {
        $sql = "INSERT INTO user_sessions (jti, user_id, steam_id, expires_at)
                VALUES (:jti, :user_id, :steam_id, :expires_at)
                ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)";

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([
            ':jti' => $jti,
            ':user_id' => $userId,
            ':steam_id' => $steamId,
            ':expires_at' => date('Y-m-d H:i:s', $expiresAtUnix),
        ]);
    }

    /**
     * A session counts as active only when it is recorded and not revoked.
     * An unknown jti is treated as revoked — a token whose row was pruned or
     * never written must not outlive the registry.
     */
    public function isActive(string $jti): bool
    {
        $stmt = $this->pdo->prepare(
            'SELECT 1 FROM user_sessions WHERE jti = :jti AND revoked_at IS NULL LIMIT 1'
        );
        $stmt->execute([':jti' => $jti]);

        return $stmt->fetchColumn() !== false;
    }

    public function revoke(string $jti): bool
    {
        $stmt = $this->pdo->prepare(
            'UPDATE user_sessions SET revoked_at = NOW() WHERE jti = :jti AND revoked_at IS NULL'
        );
        $stmt->execute([':jti' => $jti]);

        return $stmt->rowCount() > 0;
    }

    /**
     * Kill switch for one account (password/credential compromise, "sign out
     * everywhere") without touching anyone else's sessions.
     */
    public function revokeAllForUser(int $userId): int
    {
        $stmt = $this->pdo->prepare(
            'UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = :user_id AND revoked_at IS NULL'
        );
        $stmt->execute([':user_id' => $userId]);

        return $stmt->rowCount();
    }

    /**
     * Rows are only useful until the token they describe expires on its own.
     * Keep a grace margin so a just-expired token still resolves to "revoked"
     * rather than "unknown".
     */
    public function pruneExpired(int $graceDays = 7): int
    {
        $stmt = $this->pdo->prepare(
            'DELETE FROM user_sessions WHERE expires_at < (NOW() - INTERVAL :grace DAY)'
        );
        $stmt->bindValue(':grace', max(0, $graceDays), PDO::PARAM_INT);
        $stmt->execute();

        return $stmt->rowCount();
    }
}
