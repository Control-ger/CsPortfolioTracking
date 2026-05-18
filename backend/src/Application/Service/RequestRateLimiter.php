<?php
declare(strict_types=1);

namespace App\Application\Service;

final class RequestRateLimiter
{
    private string $storageFile;

    public function __construct(?string $storageFile = null)
    {
        $this->storageFile = $storageFile
            ? trim($storageFile)
            : rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'csportfolio_request_rate_limits.json';
    }

    /**
     * @return array{allowed: bool, limit: int, remaining: int, retryAfter: int}
     */
    public function consume(string $bucketKey, int $limit, int $windowSeconds): array
    {
        $limit = max(1, $limit);
        $windowSeconds = max(1, $windowSeconds);
        $now = time();

        $fallbackAllowed = [
            'allowed' => true,
            'limit' => $limit,
            'remaining' => max(0, $limit - 1),
            'retryAfter' => 0,
        ];

        $handle = @fopen($this->storageFile, 'c+');
        if ($handle === false) {
            return $fallbackAllowed;
        }

        try {
            if (!flock($handle, LOCK_EX)) {
                return $fallbackAllowed;
            }

            rewind($handle);
            $raw = stream_get_contents($handle);
            $payload = is_string($raw) ? json_decode($raw, true) : null;
            if (!is_array($payload)) {
                $payload = [];
            }

            $buckets = is_array($payload['buckets'] ?? null) ? $payload['buckets'] : [];
            $this->cleanupExpiredBuckets($buckets, $now, $windowSeconds);

            $key = hash('sha256', $bucketKey);
            $entry = is_array($buckets[$key] ?? null) ? $buckets[$key] : ['windowStart' => $now, 'count' => 0];
            $windowStart = (int) ($entry['windowStart'] ?? $now);
            $count = (int) ($entry['count'] ?? 0);

            if (($now - $windowStart) >= $windowSeconds) {
                $windowStart = $now;
                $count = 0;
            }

            if ($count >= $limit) {
                $retryAfter = max(1, $windowSeconds - ($now - $windowStart));
                $this->persist($handle, $buckets);

                return [
                    'allowed' => false,
                    'limit' => $limit,
                    'remaining' => 0,
                    'retryAfter' => $retryAfter,
                ];
            }

            $count++;
            $buckets[$key] = [
                'windowStart' => $windowStart,
                'count' => $count,
            ];
            $this->persist($handle, $buckets);

            return [
                'allowed' => true,
                'limit' => $limit,
                'remaining' => max(0, $limit - $count),
                'retryAfter' => 0,
            ];
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }

    private function cleanupExpiredBuckets(array &$buckets, int $now, int $windowSeconds): void
    {
        if ($buckets === []) {
            return;
        }

        $maxAge = max(120, $windowSeconds * 2);
        foreach ($buckets as $key => $entry) {
            if (!is_array($entry)) {
                unset($buckets[$key]);
                continue;
            }

            $windowStart = (int) ($entry['windowStart'] ?? 0);
            if ($windowStart <= 0 || ($now - $windowStart) > $maxAge) {
                unset($buckets[$key]);
            }
        }
    }

    private function persist($handle, array $buckets): void
    {
        $payload = ['buckets' => $buckets];
        $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (!is_string($json)) {
            return;
        }

        rewind($handle);
        ftruncate($handle, 0);
        fwrite($handle, $json);
        fflush($handle);
    }
}
