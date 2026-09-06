<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

/**
 * Parking spot for a desktop login that finishes in the user's system browser.
 *
 * The desktop app sends the user to Steam in their own browser — where they are
 * usually already signed in, which is the whole point — and therefore cannot
 * watch the callback that completes the flow. So the callback parks the finished
 * session here under the OpenID `state`, and the app polls for it.
 *
 * The `state` is NOT a secret: it rides through Steam's redirect chain and sits
 * in the browser's address bar. Knowing it must not be enough to claim the
 * session token, so the app proves it is the initiator with a secret it
 * generated itself and only ever transmitted as a SHA-256 hash.
 */
final class AuthLoginHandoffRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS auth_login_handoffs (
            state       VARCHAR(64) NOT NULL PRIMARY KEY,
            claim_hash  CHAR(64)    NOT NULL,
            payload     TEXT        NULL,
            expires_at  TIMESTAMP   NOT NULL,
            created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_expires (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
        } catch (Throwable $exception) {
            error_log('Failed to create auth_login_handoffs table: ' . $exception->getMessage());
            throw $exception;
        }
    }

    /**
     * Opens a pending handoff. `$claimHash` is the SHA-256 hex digest of the
     * secret only the initiating app knows.
     */
    public function begin(string $state, string $claimHash, int $expiresInSeconds = 300): void
    {
        $sql = 'INSERT INTO auth_login_handoffs (state, claim_hash, payload, expires_at)
                VALUES (:state, :claim_hash, NULL, :expires_at)
                ON DUPLICATE KEY UPDATE
                    claim_hash = VALUES(claim_hash),
                    payload    = NULL,
                    expires_at = VALUES(expires_at),
                    created_at = CURRENT_TIMESTAMP';

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([
            ':state' => $state,
            ':claim_hash' => $claimHash,
            ':expires_at' => date('Y-m-d H:i:s', time() + $expiresInSeconds),
        ]);
    }

    /**
     * Stores the finished login. Returns false when this state never opened a
     * handoff (the in-app login window flow) or the handoff already expired —
     * the caller uses that to decide between redirecting and rendering a page.
     */
    public function complete(string $state, array $payload): bool
    {
        $encoded = json_encode($payload, JSON_UNESCAPED_SLASHES);
        if (!is_string($encoded)) {
            return false;
        }

        $sql = 'UPDATE auth_login_handoffs
                SET payload = :payload
                WHERE state = :state AND payload IS NULL AND expires_at > NOW()';

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([':state' => $state, ':payload' => $encoded]);

        return $stmt->rowCount() > 0;
    }

    /**
     * Is a handoff open for this state? Lets the callback tell a browser login
     * apart from the in-app window flow before it has a result to store.
     */
    public function isPending(string $state): bool
    {
        $stmt = $this->pdo->prepare(
            'SELECT 1 FROM auth_login_handoffs WHERE state = :state AND expires_at > NOW()'
        );
        $stmt->execute([':state' => $state]);

        return $stmt->fetchColumn() !== false;
    }

    /**
     * Single-use claim.
     *
     * Returns `['pending' => true]` while the browser is still in the flow, the
     * stored payload exactly once, and null for an unknown, expired or
     * wrongly-authenticated state — the three are deliberately indistinguishable
     * to a caller that is guessing.
     */
    public function claim(string $state, string $claimSecret): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT claim_hash, payload FROM auth_login_handoffs
             WHERE state = :state AND expires_at > NOW()'
        );
        $stmt->execute([':state' => $state]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!is_array($row)) {
            return null;
        }

        if (!hash_equals((string) $row['claim_hash'], hash('sha256', $claimSecret))) {
            return null;
        }

        $payload = $row['payload'];
        if ($payload === null) {
            return ['pending' => true];
        }

        // Consume before returning: a session token handed out twice is a token
        // an eavesdropper on the second read gets for free.
        $this->delete($state);

        $decoded = json_decode((string) $payload, true);

        return is_array($decoded) ? $decoded : null;
    }

    public function delete(string $state): void
    {
        $stmt = $this->pdo->prepare('DELETE FROM auth_login_handoffs WHERE state = :state');
        $stmt->execute([':state' => $state]);
    }

    public function cleanupExpired(): int
    {
        return (int) $this->pdo->exec('DELETE FROM auth_login_handoffs WHERE expires_at < NOW()');
    }
}
