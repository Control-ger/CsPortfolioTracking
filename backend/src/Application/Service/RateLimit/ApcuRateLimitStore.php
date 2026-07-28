<?php
declare(strict_types=1);

namespace App\Application\Service\RateLimit;

/**
 * Shared-memory counter store.
 *
 * Preferred backend: apcu_inc() is atomic across Apache workers, so no lock is
 * taken and concurrent limited requests do not serialize on each other the way
 * they do with a single exclusive file lock.
 */
final class ApcuRateLimitStore implements RateLimitStore
{
    private const PREFIX = 'csportfolio_rl:';

    public function isAvailable(): bool
    {
        // apcu_enabled() is SAPI-aware: it reports false under CLI when
        // apc.enable_cli=0, which ini_get('apc.enabled') would not. Getting this
        // wrong would leave the CLI paths with a store that always fails instead
        // of falling back to the file store.
        return function_exists('apcu_enabled')
            && apcu_enabled()
            && function_exists('apcu_inc')
            && function_exists('apcu_fetch');
    }

    public function hitWindow(string $bucketKey, int $currentIndex, int $ttlSeconds): ?array
    {
        if (!$this->isAvailable()) {
            return null;
        }

        $currentKey = $this->key($bucketKey, $currentIndex);
        $previousKey = $this->key($bucketKey, $currentIndex - 1);

        // apcu_inc creates the key with 1 when absent, so no separate init is
        // needed and there is no read-modify-write race between workers.
        $current = apcu_inc($currentKey, 1, $ok, max(1, $ttlSeconds));
        if ($ok !== true || !is_int($current)) {
            return null;
        }

        $previous = apcu_fetch($previousKey, $previousOk);

        return [
            'current' => $current,
            'previous' => $previousOk === true && is_int($previous) ? $previous : 0,
        ];
    }

    public function name(): string
    {
        return 'apcu';
    }

    private function key(string $bucketKey, int $windowIndex): string
    {
        return self::PREFIX . hash('sha256', $bucketKey) . ':' . $windowIndex;
    }
}
