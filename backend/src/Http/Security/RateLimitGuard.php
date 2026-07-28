<?php
declare(strict_types=1);

namespace App\Http\Security;

use App\Application\Service\RequestRateLimiter;
use App\Http\Auth\RequestIdentity;
use App\Shared\Http\Request;
use App\Shared\Logger;

/**
 * Applies the rate-limit policy to a request.
 *
 * Bucket keys are built exclusively from server-derived identity (see
 * RequestIdentity): the hashed session subject for authenticated traffic, the
 * hashed IP otherwise. Client-supplied scope hints are never part of the key —
 * rotating a header must not yield a fresh budget.
 */
final class RateLimitGuard
{
    public function __construct(
        private readonly RequestRateLimiter $limiter,
        private readonly RateLimitPolicy $policy,
        private readonly string $pepper,
        private readonly bool $enabled,
    ) {
    }

    /**
     * @return array{retryAfter: int, limit: int}|null Null when the request may proceed.
     */
    public function check(string $stage, Request $request, RequestIdentity $identity): ?array
    {
        if (!$this->enabled) {
            return null;
        }

        $rule = $this->policy->resolve($stage, $request->method, $request->path);
        if ($rule === null) {
            return null;
        }

        // Edge stage is IP-keyed by definition (no verified identity yet); the
        // session stage prefers the session subject and falls back to IP for
        // public routes.
        $subject = $stage === RateLimitPolicy::STAGE_EDGE
            ? $identity->ipSubject($this->pepper)
            : ($identity->rateLimitSubject($this->pepper) ?? $identity->ipSubject($this->pepper));

        $bucketKey = $stage . ':' . strtolower($request->method) . ':' . $rule['pattern'] . ':' . $subject;
        $result = $this->limiter->consume($bucketKey, $rule['limit'], $rule['window'], $rule['failClosed']);

        if (($result['allowed'] ?? false) === true) {
            header('X-RateLimit-Limit: ' . (int) ($result['limit'] ?? $rule['limit']));
            header('X-RateLimit-Remaining: ' . max(0, (int) ($result['remaining'] ?? 0)));

            return null;
        }

        $retryAfter = max(1, (int) ($result['retryAfter'] ?? 1));
        header('Retry-After: ' . $retryAfter);
        header('X-RateLimit-Limit: ' . $rule['limit']);
        header('X-RateLimit-Remaining: 0');

        Logger::event(
            'warning',
            'security',
            'security.rate_limit.blocked',
            'Request blocked by HTTP rate limit',
            [
                'statusCode' => 429,
                'method' => $request->method,
                'route' => $request->path,
                'stage' => $stage,
                'rule' => $rule['pattern'],
                'retryAfterSeconds' => $retryAfter,
                'limit' => $rule['limit'],
                'windowSeconds' => $rule['window'],
            ] + $identity->toLogContext($this->pepper)
        );

        return ['retryAfter' => $retryAfter, 'limit' => $rule['limit']];
    }
}
