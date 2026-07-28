<?php
declare(strict_types=1);

namespace App\Http\Security;

use App\Shared\Http\RoutePattern;

/**
 * Rate-limit rule table.
 *
 * Two stages, because the identity of a request is not known at the same time as
 * the need to protect the process:
 *
 *  - STAGE_EDGE runs before the database connection is opened. Nothing is
 *    verified yet, so it can only key on the connection IP. Its job is to keep a
 *    flood from reaching the DB and to cap the pre-session auth endpoints.
 *  - STAGE_SESSION runs once the session token has been decrypted. It keys on the
 *    hashed session subject and carries the per-route budgets.
 *
 * Rules are matched by method + path pattern; the most specific match wins, with
 * a catch-all default per stage.
 */
final class RateLimitPolicy
{
    public const STAGE_EDGE = 'edge';
    public const STAGE_SESSION = 'session';

    /** @var callable(string, int, int, int): int */
    private $envInt;

    /**
     * @param callable(string, int, int, int): int $envInt key, default, min, max
     */
    public function __construct(callable $envInt)
    {
        $this->envInt = $envInt;
    }

    /**
     * @return array{limit: int, window: int, pattern: string, failClosed: bool}|null
     */
    public function resolve(string $stage, string $method, string $path): ?array
    {
        $method = strtoupper($method);
        $best = null;
        $bestScore = -1;

        foreach ($this->rules($stage) as $rule) {
            if ($rule['method'] !== '*' && $rule['method'] !== $method) {
                continue;
            }

            if (!RoutePattern::matches($rule['pattern'], $path)) {
                continue;
            }

            $score = RoutePattern::specificity($rule['pattern']) * 10
                + ($rule['method'] === '*' ? 0 : 1);

            if ($score > $bestScore) {
                $best = $rule;
                $bestScore = $score;
            }
        }

        if ($best === null || $best['limit'] <= 0) {
            return null;
        }

        return [
            'limit' => $best['limit'],
            'window' => $best['window'],
            'pattern' => $best['pattern'],
            'failClosed' => $best['failClosed'],
        ];
    }

    /**
     * @return array<int, array{method: string, pattern: string, limit: int, window: int, failClosed: bool}>
     */
    private function rules(string $stage): array
    {
        return $stage === self::STAGE_EDGE ? $this->edgeRules() : $this->sessionRules();
    }

    /**
     * @return array<int, array{method: string, pattern: string, limit: int, window: int, failClosed: bool}>
     */
    private function edgeRules(): array
    {
        return [
            // Catch-all per IP: keeps an unauthenticated flood away from the DB.
            $this->rule('*', '/api/*', 'RATE_LIMIT_GLOBAL_IP_PER_MINUTE', 600, 0, 20000),

            // Pre-session auth surface. Fail closed: if the limiter store is
            // unavailable these must not become unlimited.
            $this->rule('POST', '/api/v1/auth/steam/login', 'RATE_LIMIT_AUTH_LOGIN_PER_MINUTE', 20, 0, 300, true),
            $this->rule('GET', '/api/v1/auth/steam/login', 'RATE_LIMIT_AUTH_LOGIN_PER_MINUTE', 20, 0, 300, true),
            $this->rule('GET', '/api/v1/auth/steam/callback', 'RATE_LIMIT_AUTH_CALLBACK_PER_MINUTE', 40, 0, 300, true),
            $this->rule('GET', '/api/v1/auth/session/validate', 'RATE_LIMIT_AUTH_VALIDATE_PER_MINUTE', 240, 0, 5000, true),
        ];
    }

    /**
     * @return array<int, array{method: string, pattern: string, limit: int, window: int, failClosed: bool}>
     */
    private function sessionRules(): array
    {
        return [
            // Catch-all per session.
            $this->rule('*', '/api/*', 'RATE_LIMIT_DEFAULT_PER_MINUTE', 600, 0, 20000),

            // Sync.
            $this->rule('POST', '/api/v1/sync/push', 'RATE_LIMIT_SYNC_PUSH_PER_MINUTE', 60, 0, 2000),
            $this->rule('GET', '/api/v1/sync/pull', 'RATE_LIMIT_SYNC_PULL_PER_MINUTE', 180, 0, 5000),

            // Steam inventory + push registration.
            $this->rule('GET', '/api/v1/auth/steam/inventory', 'RATE_LIMIT_AUTH_INVENTORY_PER_MINUTE', 60, 0, 1000),
            $this->rule('POST', '/api/v1/push/subscribe', 'RATE_LIMIT_PUSH_SUBSCRIBE_PER_MINUTE', 30, 0, 600),
            $this->rule('POST', '/api/v1/push/unsubscribe', 'RATE_LIMIT_PUSH_UNSUBSCRIBE_PER_MINUTE', 30, 0, 600),

            // Routes with external fan-out (CSFloat / Steam Market) — the expensive class.
            $this->rule('POST', '/api/v1/portfolio/prices/refresh-stale', 'RATE_LIMIT_PRICE_REFRESH_PER_MINUTE', 6, 0, 600),
            $this->rule('POST', '/api/v1/watchlist/prices/refresh', 'RATE_LIMIT_PRICE_REFRESH_PER_MINUTE', 6, 0, 600),
            $this->rule('GET', '/api/v1/watchlist/search', 'RATE_LIMIT_WATCHLIST_SEARCH_PER_MINUTE', 60, 0, 1200),
            $this->rule('POST', '/api/v1/portfolio/sync/csfloat/preview', 'RATE_LIMIT_CSFLOAT_SYNC_PER_MINUTE', 6, 0, 300),
            $this->rule('POST', '/api/v1/portfolio/sync/csfloat/execute', 'RATE_LIMIT_CSFLOAT_EXECUTE_PER_MINUTE', 4, 0, 300),

            // Writes.
            $this->rule('POST', '/api/v1/watchlist', 'RATE_LIMIT_WATCHLIST_WRITE_PER_MINUTE', 60, 0, 1200),
            $this->rule('POST', '/api/v1/watchlist/batch', 'RATE_LIMIT_WATCHLIST_BATCH_PER_MINUTE', 20, 0, 600),
            $this->rule('DELETE', '/api/v1/watchlist/{id}', 'RATE_LIMIT_WATCHLIST_WRITE_PER_MINUTE', 60, 0, 1200),
            $this->rule('PUT', '/api/v1/settings/*', 'RATE_LIMIT_SETTINGS_WRITE_PER_MINUTE', 60, 0, 1200),
            $this->rule('POST', '/api/v1/settings/*', 'RATE_LIMIT_SETTINGS_WRITE_PER_MINUTE', 60, 0, 1200),
            $this->rule('PUT', '/api/v1/portfolio/investments/{id}/*', 'RATE_LIMIT_INVESTMENT_WRITE_PER_MINUTE', 120, 0, 2400),
            $this->rule('PUT', '/api/v1/portfolio/daily-value', 'RATE_LIMIT_INVESTMENT_WRITE_PER_MINUTE', 120, 0, 2400),

            // Telemetry ingest.
            $this->rule('POST', '/api/v1/observability/frontend-events', 'RATE_LIMIT_TELEMETRY_PER_MINUTE', 60, 0, 1200),
        ];
    }

    /**
     * @return array{method: string, pattern: string, limit: int, window: int, failClosed: bool}
     */
    private function rule(
        string $method,
        string $pattern,
        string $envKey,
        int $default,
        int $min,
        int $max,
        bool $failClosed = false,
    ): array {
        return [
            'method' => $method,
            'pattern' => $pattern,
            'limit' => ($this->envInt)($envKey, $default, $min, $max),
            'window' => 60,
            'failClosed' => $failClosed,
        ];
    }
}
