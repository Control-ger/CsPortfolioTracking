<?php
declare(strict_types=1);

namespace App\Infrastructure\External;

final class CsFloatClient
{
    public function fetchLowestPriceUsd(string $marketHashName): ?float
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

        if ($listing === null) {
            return null;
        }

        return ((float) $listing['price']) / 100.0;
    }
}
