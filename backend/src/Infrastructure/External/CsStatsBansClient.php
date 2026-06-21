<?php
declare(strict_types=1);

namespace App\Infrastructure\External;

use RuntimeException;

// Scrapes https://csstats.gg/bans for daily VAC ban counts.
// The page embeds data as: const vacs = [{"date":"2026-05-22","num":"508"}, ...];
// FRAGILE: regex-based; Cloudflare may block. Treat as fallback source only.
// Regex last verified: 2026-06-21.
final class CsStatsBansClient
{
    public function __construct(
        private readonly int $timeoutSeconds = 15
    ) {
    }

    /**
     * @return array<int,array{date:string,ban_count:int}>
     */
    public function fetch(): array
    {
        $ch = curl_init('https://csstats.gg/bans');
        if ($ch === false) {
            throw new RuntimeException('CsStatsBansClient: Failed to initialize cURL.');
        }

        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => $this->timeoutSeconds,
            CURLOPT_HTTPHEADER => [
                'Accept: text/html,application/xhtml+xml',
                'Accept-Language: en-US,en;q=0.9',
                'User-Agent: CSInvestorHub/1.0 (+https://github.com/Control-ger/CsPortfolioTracking)',
            ],
        ]);

        $body = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($curlError !== '') {
            throw new RuntimeException('CsStatsBansClient: cURL error: ' . $curlError);
        }

        if (!is_string($body) || $body === '') {
            throw new RuntimeException('CsStatsBansClient: Empty response.');
        }

        if ($httpCode < 200 || $httpCode >= 300) {
            throw new RuntimeException('CsStatsBansClient: HTTP ' . $httpCode . '.');
        }

        if ($this->isCloudflareChallenge($body)) {
            throw new RuntimeException('CsStatsBansClient: Cloudflare challenge detected — page unavailable.');
        }

        return $this->extractVacsData($body);
    }

    /**
     * @return array<int,array{date:string,ban_count:int}>
     */
    private function extractVacsData(string $html): array
    {
        if (preg_match('/const\s+vacs\s*=\s*(\[.*?\]);/s', $html, $matches) !== 1) {
            throw new RuntimeException('CsStatsBansClient: Could not locate `const vacs` in page HTML. Site structure may have changed.');
        }

        $decoded = json_decode((string) $matches[1], true);
        if (!is_array($decoded)) {
            throw new RuntimeException('CsStatsBansClient: Failed to parse vacs JSON from page.');
        }

        $result = [];
        foreach ($decoded as $item) {
            if (!is_array($item)) {
                continue;
            }

            $date = trim((string) ($item['date'] ?? ''));
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
                continue;
            }

            $rawCount = $item['num'] ?? $item['ban_count'] ?? $item['count'] ?? null;
            if ($rawCount === null) {
                continue;
            }
            $count = (int) $rawCount;
            if ($count < 0) {
                continue;
            }

            $result[] = ['date' => $date, 'ban_count' => $count];
        }

        usort($result, static fn(array $a, array $b) => strcmp($a['date'], $b['date']));

        return $result;
    }

    private function isCloudflareChallenge(string $html): bool
    {
        $lower = strtolower($html);
        return str_contains($lower, 'enable javascript and cookies to continue')
            || str_contains($lower, '__cf_chl_opt')
            || str_contains($lower, 'cf-error');
    }
}
