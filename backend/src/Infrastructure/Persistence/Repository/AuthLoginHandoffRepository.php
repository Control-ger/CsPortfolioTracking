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

    /**
     * DATETIME, not TIMESTAMP, and that is the whole point.
     *
     * With explicit_defaults_for_timestamp=OFF (the default on MySQL 5.7 and
     * MariaDB) the FIRST `TIMESTAMP NOT NULL` column without its own DEFAULT
     * silently becomes `DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`.
     * `expires_at` was that column — so the UPDATE in complete() reset the row's
     * own expiry to "now", the row was expired the instant the login finished,
     * and every pickup answered "unknown or expired login" one second after the
     * browser had reported success. DATETIME carries no such magic.
     */
    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS auth_login_handoffs (
            state       VARCHAR(64) NOT NULL PRIMARY KEY,
            claim_hash  CHAR(64)    NOT NULL,
            payload     TEXT        NULL,
            expires_at  DATETIME    NOT NULL,
            created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_expires (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            $this->repairSelfExpiringTimestampColumn();
        } catch (Throwable $exception) {
            error_log('Failed to create auth_login_handoffs table: ' . $exception->getMessage());
            throw $exception;
        }
    }

    /**
     * CREATE TABLE IF NOT EXISTS does nothing to a table that already exists, so
     * installs created before the DATETIME fix keep the self-resetting column.
     * Convert it once; afterwards this is a single indexed information_schema
     * lookup per request.
     */
    private function repairSelfExpiringTimestampColumn(): void
    {
        try {
            $stmt = $this->pdo->query(
                "SELECT DATA_TYPE FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'auth_login_handoffs'
                   AND COLUMN_NAME = 'expires_at'"
            );
            $dataType = strtolower((string) ($stmt->fetchColumn() ?: ''));
            if ($dataType !== 'timestamp') {
                return;
            }

            $this->pdo->exec('ALTER TABLE auth_login_handoffs MODIFY expires_at DATETIME NOT NULL');
            error_log('[auth] converted auth_login_handoffs.expires_at from TIMESTAMP to DATETIME');
        } catch (Throwable $exception) {
            // complete() defends itself against the auto-update anyway, so a
            // missing ALTER privilege must not break logins.
            error_log('[auth] could not convert expires_at column: ' . $exception->getMessage());
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

        // `expires_at = expires_at` is not a no-op: assigning a column explicitly
        // suppresses ON UPDATE CURRENT_TIMESTAMP. It keeps this UPDATE from
        // resetting the row's expiry on any install where the column is still a
        // TIMESTAMP (see repairSelfExpiringTimestampColumn).
        $sql = 'UPDATE auth_login_handoffs
                SET payload = :payload, expires_at = expires_at
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
     * Returns a status the caller can act on:
     *   'pending'  — the browser is still in the flow
     *   'ready'    — `payload` holds the finished login (consumed by this call)
     *   'missing'  — unknown, expired, or the claim secret did not match
     *   'corrupt'  — a parked payload that will not decode
     *
     * 'missing' deliberately merges "no such state" with "wrong secret" so a
     * caller that is guessing learns nothing from the difference.
     *
     * @return array{status: string, payload?: array}
     */
    public function claim(string $state, string $claimSecret): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT claim_hash, payload FROM auth_login_handoffs
             WHERE state = :state AND expires_at > NOW()'
        );
        $stmt->execute([':state' => $state]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!is_array($row)) {
            return ['status' => 'missing'];
        }

        if (!hash_equals((string) $row['claim_hash'], hash('sha256', $claimSecret))) {
            return ['status' => 'missing'];
        }

        $payload = $row['payload'];
        if ($payload === null) {
            return ['status' => 'pending'];
        }

        $decoded = json_decode((string) $payload, true);
        if (!is_array($decoded)) {
            // Decode BEFORE deleting. The first version deleted the row and then
            // returned null on a decode failure, which turned an unreadable
            // payload into "unknown login" — the session was destroyed by the
            // very request that was supposed to fetch it, and the user saw a 404
            // seconds after the browser said the login had worked.
            // The head of the payload is the JSON envelope
            // ({"success":true,"user":{"id":…) — no secret lives in the first
            // few dozen characters, and seeing it is what tells truncation apart
            // from a charset problem.
            error_log(sprintf(
                '[auth] parked login payload is not decodable (state=%s, bytes=%d, jsonError=%s, head=%s)',
                substr($state, 0, 8),
                strlen((string) $payload),
                json_last_error_msg(),
                substr((string) $payload, 0, 40)
            ));

            return [
                'status' => 'corrupt',
                'bytes' => strlen((string) $payload),
                'jsonError' => json_last_error_msg(),
            ];
        }

        // Consume only now that we know we can hand it over: a session token
        // handed out twice is a token an eavesdropper on the second read gets
        // for free.
        $this->delete($state);

        return ['status' => 'ready', 'payload' => $decoded];
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
