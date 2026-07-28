<?php
declare(strict_types=1);

namespace App\Application\Service\RateLimit;

/**
 * JSON-file counter store.
 *
 * Fallback for deployments without APCu (and the only option for the CLI
 * sidecar). Every hit takes an exclusive lock and rewrites the file, so limited
 * requests serialize on it — acceptable as a fallback, not as the primary path.
 */
final class FileRateLimitStore implements RateLimitStore
{
    private string $storageFile;

    public function __construct(?string $storageFile = null)
    {
        $this->storageFile = $storageFile !== null && trim($storageFile) !== ''
            ? trim($storageFile)
            : rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'csportfolio_request_rate_limits.json';
    }

    public function isAvailable(): bool
    {
        return true;
    }

    public function hitWindow(string $bucketKey, int $currentIndex, int $ttlSeconds): ?array
    {
        $handle = @fopen($this->storageFile, 'c+');
        if ($handle === false) {
            return null;
        }

        try {
            if (!flock($handle, LOCK_EX)) {
                return null;
            }

            rewind($handle);
            $raw = stream_get_contents($handle);
            $payload = is_string($raw) ? json_decode($raw, true) : null;
            $buckets = is_array($payload['buckets'] ?? null) ? $payload['buckets'] : [];

            $key = hash('sha256', $bucketKey);
            $entry = is_array($buckets[$key] ?? null) ? $buckets[$key] : [];

            $storedIndex = (int) ($entry['i'] ?? -1);
            $storedCurrent = (int) ($entry['c'] ?? 0);
            $storedPrevious = (int) ($entry['p'] ?? 0);

            if ($storedIndex === $currentIndex) {
                $current = $storedCurrent + 1;
                $previous = $storedPrevious;
            } elseif ($storedIndex === $currentIndex - 1) {
                // Window rolled over by exactly one: the old current becomes previous.
                $current = 1;
                $previous = $storedCurrent;
            } else {
                // Gap of two or more windows: nothing carries over.
                $current = 1;
                $previous = 0;
            }

            $buckets[$key] = [
                'i' => $currentIndex,
                'c' => $current,
                'p' => $previous,
                't' => time() + max(1, $ttlSeconds),
            ];

            $this->dropExpired($buckets);
            $this->persist($handle, $buckets);

            return ['current' => $current, 'previous' => $previous];
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }

    public function name(): string
    {
        return 'file';
    }

    /**
     * @param array<string, mixed> $buckets
     */
    private function dropExpired(array &$buckets): void
    {
        $now = time();
        foreach ($buckets as $key => $entry) {
            if (!is_array($entry) || (int) ($entry['t'] ?? 0) <= $now) {
                unset($buckets[$key]);
            }
        }
    }

    /**
     * @param resource            $handle
     * @param array<string, mixed> $buckets
     */
    private function persist($handle, array $buckets): void
    {
        $json = json_encode(['buckets' => $buckets], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (!is_string($json)) {
            return;
        }

        rewind($handle);
        ftruncate($handle, 0);
        fwrite($handle, $json);
        fflush($handle);
    }
}
