<?php
declare(strict_types=1);

namespace App\Infrastructure\External;

use RuntimeException;

final class VacBanApiClient
{
    public function __construct(
        private readonly int $timeoutSeconds = 12
    ) {
    }

    /**
     * @return array<int,array{date:string,ban_count:int}>
     */
    public function fetch(): array
    {
        $ch = curl_init('https://api.vac-ban.com/api/stats');
        if ($ch === false) {
            throw new RuntimeException('VacBanApiClient: Failed to initialize cURL.');
        }

        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => $this->timeoutSeconds,
            CURLOPT_HTTPHEADER => [
                'Accept: application/json',
                'User-Agent: CSInvestorHub/1.0 (+https://github.com/Control-ger/CsPortfolioTracking)',
            ],
        ]);

        $body = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($curlError !== '') {
            throw new RuntimeException('VacBanApiClient: cURL error: ' . $curlError);
        }

        if (!is_string($body) || $body === '') {
            throw new RuntimeException('VacBanApiClient: Empty response from API.');
        }

        if ($httpCode < 200 || $httpCode >= 300) {
            throw new RuntimeException('VacBanApiClient: HTTP ' . $httpCode . ' from API.');
        }

        $decoded = json_decode($body, true);
        if (!is_array($decoded)) {
            throw new RuntimeException('VacBanApiClient: Invalid JSON response.');
        }

        // Response shape (verified 2026-06-21):
        // {"accounts":N,"trackedCount":N,"percent":N,"dailyBans":[{"lastBan":0,"count":N},...]}
        // "lastBan" is days-ago offset from today (UTC); 0 = today (partial).
        if (!isset($decoded['dailyBans']) || !is_array($decoded['dailyBans'])) {
            throw new RuntimeException('VacBanApiClient: Unexpected response shape — "dailyBans" key missing.');
        }

        return $this->normalize($decoded['dailyBans']);
    }

    /**
     * @param array<mixed> $items
     * @return array<int,array{date:string,ban_count:int}>
     */
    private function normalize(array $items): array
    {
        $result = [];
        $nowUtc = time();

        foreach ($items as $item) {
            if (!is_array($item)) {
                continue;
            }

            $offset = isset($item['lastBan']) ? (int) $item['lastBan'] : -1;
            if ($offset < 0) {
                continue;
            }

            $date = gmdate('Y-m-d', $nowUtc - $offset * 86400);

            $rawCount = $item['count'] ?? null;
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
}
