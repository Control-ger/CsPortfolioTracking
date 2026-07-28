<?php
declare(strict_types=1);

namespace App\Application\Service\RateLimit;

/**
 * Counter backend for the sliding-window rate limiter.
 *
 * Buckets are counted per window index (floor(now / window)), so a store only
 * ever needs to increment one counter and read the preceding one. Expiry is
 * handled by the store's own TTL — no sweep pass required.
 */
interface RateLimitStore
{
    public function isAvailable(): bool;

    /**
     * Atomically increments the counter for the current window and reads the
     * previous one.
     *
     * @param string $bucketKey      Opaque bucket identity.
     * @param int    $currentIndex   Index of the window being counted.
     * @param int    $ttlSeconds     How long a window counter must survive
     *                               (>= 2 windows, so the previous one is still
     *                               readable for the sliding calculation).
     * @return array{current: int, previous: int}|null Null when the store is unusable.
     */
    public function hitWindow(string $bucketKey, int $currentIndex, int $ttlSeconds): ?array;

    /**
     * Human-readable backend name, for diagnostics.
     */
    public function name(): string;
}
