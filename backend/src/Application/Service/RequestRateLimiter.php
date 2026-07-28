<?php
declare(strict_types=1);

namespace App\Application\Service;

use App\Application\Service\RateLimit\ApcuRateLimitStore;
use App\Application\Service\RateLimit\FileRateLimitStore;
use App\Application\Service\RateLimit\RateLimitStore;

/**
 * Sliding-window request limiter.
 *
 * Uses the weighted sliding-window-counter approximation: the current window's
 * count plus the previous window's count weighted by how much of it still falls
 * inside the trailing window. A plain fixed window would let a caller spend the
 * full budget at the end of one window and again at the start of the next —
 * twice the intended rate across the boundary, which matters most exactly where
 * it hurts (login attempts).
 *
 * Counter storage is delegated: APCu when present (atomic, lock-free, shared
 * across Apache workers), otherwise a locked JSON file.
 */
final class RequestRateLimiter
{
    private RateLimitStore $store;

    /** @var callable(): int */
    private $clock;

    /**
     * @param callable(): int|null $clock Injectable for tests; defaults to time().
     */
    public function __construct(?string $storageFile = null, ?RateLimitStore $store = null, ?callable $clock = null)
    {
        $this->clock = $clock ?? static fn(): int => time();

        if ($store !== null) {
            $this->store = $store;

            return;
        }

        $apcu = new ApcuRateLimitStore();
        $this->store = $apcu->isAvailable() ? $apcu : new FileRateLimitStore($storageFile);
    }

    public function storeName(): string
    {
        return $this->store->name();
    }

    /**
     * @param bool $failClosed When the store is unusable, deny instead of allow.
     *                         Used for pre-session auth endpoints, where a broken
     *                         limiter must not silently become unlimited.
     * @return array{allowed: bool, limit: int, remaining: int, retryAfter: int}
     */
    public function consume(string $bucketKey, int $limit, int $windowSeconds, bool $failClosed = false): array
    {
        $limit = max(1, $limit);
        $windowSeconds = max(1, $windowSeconds);
        $now = ($this->clock)();

        $windowIndex = intdiv($now, $windowSeconds);
        // Two windows must stay readable for the sliding calculation.
        $counters = $this->store->hitWindow($bucketKey, $windowIndex, $windowSeconds * 2);

        if ($counters === null) {
            return $this->storeUnavailable($limit, $windowSeconds, $failClosed);
        }

        $elapsed = $now - ($windowIndex * $windowSeconds);
        $previousWeight = ($windowSeconds - $elapsed) / $windowSeconds;
        $estimated = ($counters['previous'] * $previousWeight) + $counters['current'];

        if ($estimated > $limit) {
            return [
                'allowed' => false,
                'limit' => $limit,
                'remaining' => 0,
                // The previous window rolls off at the end of the current one, which
                // is the earliest point the estimate can drop below the limit.
                'retryAfter' => max(1, $windowSeconds - $elapsed),
            ];
        }

        return [
            'allowed' => true,
            'limit' => $limit,
            'remaining' => max(0, (int) floor($limit - $estimated)),
            'retryAfter' => 0,
        ];
    }

    /**
     * @return array{allowed: bool, limit: int, remaining: int, retryAfter: int}
     */
    private function storeUnavailable(int $limit, int $windowSeconds, bool $failClosed): array
    {
        if ($failClosed) {
            return [
                'allowed' => false,
                'limit' => $limit,
                'remaining' => 0,
                'retryAfter' => min($windowSeconds, 5),
            ];
        }

        return [
            'allowed' => true,
            'limit' => $limit,
            'remaining' => max(0, $limit - 1),
            'retryAfter' => 0,
        ];
    }
}
