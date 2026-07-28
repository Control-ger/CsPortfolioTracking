<?php
declare(strict_types=1);

namespace App\Http\Auth;

use App\Http\Controller\SteamAuthController;
use App\Shared\Http\Request;

/**
 * Turns a raw request into a server-verified RequestIdentity.
 *
 * The only accepted identity proof is the encrypted session token the server
 * issued itself; scope hints such as X-User-Id or a userId body field are never
 * consulted here. Results are memoized per token so a single request validates
 * at most once even when gate, rate limiter and scope resolver all ask.
 */
final class RequestAuthenticator
{
    /** @var array<string, array|null> */
    private array $sessionCache = [];

    public function __construct(
        private readonly SteamAuthController $steamAuthController,
        private readonly ClientIpResolver $clientIpResolver,
    ) {
    }

    public function authenticate(Request $request, ?string $remoteAddr): RequestIdentity
    {
        $ip = $this->clientIpResolver->resolve($request->headers, $remoteAddr);
        $token = self::extractSessionToken($request);

        if ($token === '') {
            return RequestIdentity::anonymous($ip, false);
        }

        $payload = $this->validateToken($token);
        if (!is_array($payload)) {
            // An invalid or expired token must not open a bucket of its own,
            // otherwise garbage tokens would be a free rate-limit bypass.
            return RequestIdentity::anonymous($ip, true);
        }

        return new RequestIdentity(
            userId: self::normalizeUserId($payload['userId'] ?? null),
            steamId: self::normalizeSteamId($payload['steamId'] ?? null),
            ip: $ip,
            tokenPresent: true,
        );
    }

    public static function extractSessionToken(Request $request): string
    {
        $header = trim((string) ($request->headers['authorization'] ?? $request->headers['x-auth-token'] ?? ''));
        if ($header === '') {
            return '';
        }

        if (str_starts_with(strtolower($header), 'bearer ')) {
            return trim(substr($header, 7));
        }

        return $header;
    }

    private function validateToken(string $token): ?array
    {
        $cacheKey = hash('sha256', $token);
        if (array_key_exists($cacheKey, $this->sessionCache)) {
            return $this->sessionCache[$cacheKey];
        }

        $payload = $this->steamAuthController->validateSession($token);
        $this->sessionCache[$cacheKey] = is_array($payload) ? $payload : null;

        return $this->sessionCache[$cacheKey];
    }

    private static function normalizeSteamId(mixed $value): ?string
    {
        $raw = trim((string) ($value ?? ''));

        return preg_match('/^[1-9]\d{10,}$/', $raw) === 1 ? $raw : null;
    }

    private static function normalizeUserId(mixed $value): ?int
    {
        $raw = trim((string) ($value ?? ''));
        if (preg_match('/^[1-9]\d{0,9}$/', $raw) !== 1) {
            return null;
        }

        return (int) $raw;
    }
}
