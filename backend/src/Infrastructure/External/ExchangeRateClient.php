<?php
declare(strict_types=1);

namespace App\Infrastructure\External;

final class ExchangeRateClient
{
    public function usdToEur(): float
    {
        $url = 'https://open.er-api.com/v6/latest/USD';
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);
        $response = curl_exec($ch);
        curl_close($ch);

        if (!$response) {
            return 0.92;
        }

        $json = json_decode($response, true);
        return isset($json['rates']['EUR']) ? (float) $json['rates']['EUR'] : 0.92;
    }
}
