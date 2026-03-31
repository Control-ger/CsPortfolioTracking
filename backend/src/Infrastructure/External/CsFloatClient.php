<?php
declare(strict_types=1);

namespace App\Infrastructure\External;

final class CsFloatClient
{
    public function fetchLowestPriceUsd(string $marketHashName): ?float
    {
        $listing = $this->fetchLowestListingSnapshot($marketHashName);
        return $listing['priceUsd'] ?? null;
    }

    public function fetchLowestListingSnapshot(string $marketHashName): ?array
    {
        $encodedName = urlencode($marketHashName);
        $url = "https://csfloat.com/api/v1/listings?market_hash_name={$encodedName}&type=buy_now&sort_by=lowest_price&limit=1";
        $apiKey = getenv('CSFLOAT_API_KEY') ?: null;

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);
        curl_setopt($ch, CURLOPT_USERAGENT, 'CsPortfolioTracking/1.0');
        if ($apiKey !== null && $apiKey !== '') {
            curl_setopt($ch, CURLOPT_HTTPHEADER, ["Authorization: {$apiKey}"]);
        }
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode !== 200 || !$response) {
            return null;
        }

        $json = json_decode($response, true);
        if (!is_array($json)) {
            return null;
        }

        $listing = null;
        if (isset($json[0]['price'])) {
            $listing = $json[0];
        } elseif (isset($json['data'][0]['price'])) {
            $listing = $json['data'][0];
        }

        if ($listing === null || !isset($listing['price'])) {
            return null;
        }

        $item = $listing['item'] ?? [];
        if (!is_array($item)) {
            $item = [];
        }

        $iconPath = (string) ($item['icon_url'] ?? '');

        return [
            'priceUsd' => round(((float) $listing['price']) / 100.0, 2),
            'marketHashName' => (string) ($item['market_hash_name'] ?? $marketHashName),
            'itemType' => isset($item['type']) ? (string) $item['type'] : null,
            'itemTypeLabel' => isset($item['type_name']) ? (string) $item['type_name'] : null,
            'wearName' => isset($item['wear_name']) ? (string) $item['wear_name'] : null,
            'iconUrl' => $iconPath !== ''
                ? sprintf('https://community.akamai.steamstatic.com/economy/image/%s/96fx96f', $iconPath)
                : null,
        ];
    }
}
