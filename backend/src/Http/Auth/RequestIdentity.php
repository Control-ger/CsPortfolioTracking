<?php
declare(strict_types=1);

namespace App\Http\Auth;

/**
 * Server-derived identity of a request.
 *
 * Every field originates from data the server itself can verify: the user/steam
 * identity comes out of the decrypted session token, the IP out of the connection
 * (or a proxy header that was explicitly declared trustworthy). Nothing here is
 * taken from a client-supplied scope header, so this object is safe to key
 * rate-limit buckets on.
 */
final class RequestIdentity
{
    public function __construct(
        public readonly ?int $userId,
        public readonly ?string $steamId,
        public readonly string $ip,
        public readonly bool $tokenPresent,
    ) {
    }

    public static function anonymous(string $ip, bool $tokenPresent = false): self
    {
        return new self(null, null, $ip, $tokenPresent);
    }

    public function isAuthenticated(): bool
    {
        return $this->steamId !== null || $this->userId !== null;
    }

    /**
     * Stable, non-reversible bucket subject for the authenticated user.
     *
     * The hash never leaves the server; it exists so the rate-limit store and the
     * security logs do not carry plaintext Steam IDs. The pepper defeats brute
     * forcing the (small) Steam ID space back out of a leaked hash.
     */
    public function rateLimitSubject(string $pepper): ?string
    {
        if (!$this->isAuthenticated()) {
            return null;
        }

        $raw = $this->steamId !== null
            ? 'steam:' . $this->steamId
            : 'user:' . $this->userId;

        return substr(hash('sha256', $pepper . '|' . $raw), 0, 32);
    }

    /**
     * Bucket subject for unauthenticated traffic. Also hashed so the store stays
     * free of plaintext IP addresses.
     */
    public function ipSubject(string $pepper): string
    {
        return substr(hash('sha256', $pepper . '|ip:' . $this->ip), 0, 32);
    }

    /**
     * @return array<string, mixed> Log-safe descriptor (no plaintext identifiers).
     */
    public function toLogContext(string $pepper): array
    {
        return [
            'authenticated' => $this->isAuthenticated(),
            'credentialPresent' => $this->tokenPresent,
            'subject' => $this->rateLimitSubject($pepper) ?? $this->ipSubject($pepper),
            'subjectKind' => $this->isAuthenticated() ? 'session' : 'ip',
        ];
    }
}
