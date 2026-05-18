<?php
declare(strict_types=1);

namespace App\Infrastructure\External;

use RuntimeException;

final class SteamNewsClient
{
    public function __construct(
        private readonly ?string $endpointUrl = null,
        private readonly int $timeoutSeconds = 10
    ) {
    }

    public function resolveEndpointUrl(): string
    {
        $configured = trim((string) ($this->endpointUrl ?? getenv('CS_UPDATES_STEAM_NEWS_URL') ?: ''));
        if ($configured !== '') {
            return $configured;
        }

        return 'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=730&count=100&maxlength=0&format=json&feeds=steam_community_announcements';
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public function fetchNewsItems(): array
    {
        $url = $this->resolveEndpointUrl();
        $context = stream_context_create([
            'http' => [
                'method' => 'GET',
                'timeout' => max(1, $this->timeoutSeconds),
                'header' => "User-Agent: CSInvestorHub/1.0 (+https://github.com/Control-ger/CsPortfolioTracking)\r\n",
            ],
            'ssl' => [
                'verify_peer' => true,
                'verify_peer_name' => true,
            ],
        ]);

        $raw = @file_get_contents($url, false, $context);
        if ($raw === false || trim($raw) === '') {
            throw new RuntimeException('Unable to fetch Steam News feed from ' . $url);
        }

        $payload = json_decode($raw, true);
        if (!is_array($payload)) {
            throw new RuntimeException('Steam News response is not valid JSON.');
        }

        $items = $payload['appnews']['newsitems'] ?? null;
        if (!is_array($items)) {
            return [];
        }

        return array_values(array_filter($items, static fn($entry): bool => is_array($entry)));
    }
}

