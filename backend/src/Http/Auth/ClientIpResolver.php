<?php
declare(strict_types=1);

namespace App\Http\Auth;

/**
 * Resolves the client IP for security decisions.
 *
 * Proxy headers are only honoured when the deployment explicitly declares that a
 * trusted proxy terminates every request (TRUST_PROXY_HEADERS). If the origin is
 * reachable directly, those headers are attacker-controlled and using them would
 * hand out a fresh rate-limit bucket per forged header value.
 */
final class ClientIpResolver
{
    private const TRUSTED_HEADERS = ['cf-connecting-ip', 'x-real-ip'];

    public function __construct(private readonly bool $trustProxyHeaders)
    {
    }

    /**
     * @param array<string, string> $headers Lowercased header map.
     */
    public function resolve(array $headers, ?string $remoteAddr): string
    {
        if ($this->trustProxyHeaders) {
            foreach (self::TRUSTED_HEADERS as $headerKey) {
                $candidate = trim((string) ($headers[$headerKey] ?? ''));
                if ($this->isIp($candidate)) {
                    return $candidate;
                }
            }

            // Left-most entry of X-Forwarded-For is the originating client.
            $forwardedFor = trim((string) ($headers['x-forwarded-for'] ?? ''));
            if ($forwardedFor !== '') {
                foreach (explode(',', $forwardedFor) as $part) {
                    $candidate = trim($part);
                    if ($this->isIp($candidate)) {
                        return $candidate;
                    }
                }
            }
        }

        $direct = trim((string) ($remoteAddr ?? ''));
        if ($this->isIp($direct)) {
            return $direct;
        }

        return 'unknown';
    }

    private function isIp(string $value): bool
    {
        return $value !== '' && filter_var($value, FILTER_VALIDATE_IP) !== false;
    }
}
