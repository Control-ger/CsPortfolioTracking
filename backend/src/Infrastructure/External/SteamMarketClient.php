<?php
declare(strict_types=1);

namespace App\Infrastructure\External;

final class SteamMarketClient
{
    public function searchItems(string $query, int $limit = 8): array
    {
        $normalizedQuery = trim($query);
        if ($normalizedQuery === '') {
            return [];
        }

        $fetchLimit = max(1, min($limit * 4, 40));
        $url = sprintf(
            'https://steamcommunity.com/market/search/render/?query=%s&start=0&count=%d&search_descriptions=0&sort_column=popular&sort_dir=desc&appid=730&norender=1',
            rawurlencode($normalizedQuery),
            $fetchLimit
        );

        $response = $this->fetchJson($url);
        $results = $response['results'] ?? null;
        if (!is_array($results)) {
            return [];
        }

        $items = [];

        foreach ($results as $row) {
            if (!is_array($row)) {
                continue;
            }

            $assetDescription = $row['asset_description'] ?? [];
            if (!is_array($assetDescription)) {
                $assetDescription = [];
            }

            $marketHashName = (string) ($assetDescription['market_hash_name'] ?? $row['hash_name'] ?? '');
            if ($marketHashName === '') {
                continue;
            }

            $iconPath = (string) ($assetDescription['icon_url'] ?? '');
            $items[$marketHashName] = [
                'marketHashName' => $marketHashName,
                'displayName' => (string) ($row['name'] ?? $marketHashName),
                'typeLabel' => (string) ($assetDescription['type'] ?? 'CS2 Item'),
                'isCommodity' => ((int) ($assetDescription['commodity'] ?? 0)) === 1,
                'iconUrl' => $iconPath !== ''
                    ? sprintf('https://community.akamai.steamstatic.com/economy/image/%s/96fx96f', $iconPath)
                    : null,
            ];

            if (count($items) >= $fetchLimit) {
                break;
            }
        }

        return array_values($items);
    }

    public function findExactItem(string $marketHashName): ?array
    {
        $normalizedTarget = trim($marketHashName);
        if ($normalizedTarget === '') {
            return null;
        }

        $results = $this->searchItems($normalizedTarget, 8);
        foreach ($results as $result) {
            if (($result['marketHashName'] ?? '') === $normalizedTarget) {
                return $result;
            }
        }

        return $results[0] ?? null;
    }

    private function fetchJson(string $url): ?array
    {
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);
        curl_setopt($ch, CURLOPT_USERAGENT, 'CsPortfolioTracking/1.0');

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode !== 200 || !is_string($response) || $response === '') {
            return null;
        }

        $decoded = json_decode($response, true);
        return is_array($decoded) ? $decoded : null;
    }
}
