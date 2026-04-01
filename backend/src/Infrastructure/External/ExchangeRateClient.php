<?php
declare(strict_types=1);

namespace App\Infrastructure\External;

use App\Shared\Logger;

final class ExchangeRateClient
{
    private const FALLBACK_RATE = 0.92;

    public function usdToEur(): float
    {
        $url = 'https://open.er-api.com/v6/latest/USD';
        $start = microtime(true);
        Logger::event(
            'info',
            'external',
            'external.exchange_rate.request',
            'Exchange rate request started',
            [
                'provider' => 'exchange_rate',
                'url' => $url,
            ]
        );

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);
        $durationMs = (int) round((microtime(true) - $start) * 1000);

        if ($response === false) {
            Logger::event(
                'error',
                'error',
                'error.curl',
                'Exchange rate curl error',
                [
                    'provider' => 'exchange_rate',
                    'statusCode' => $httpCode > 0 ? $httpCode : null,
                    'durationMs' => $durationMs,
                    'errorCode' => 'EXCHANGE_RATE_REQUEST_FAILED',
                    'curlError' => $curlError,
                ]
            );
            Logger::event(
                'error',
                'external',
                'external.exchange_rate.response',
                'Exchange rate request failed',
                [
                    'provider' => 'exchange_rate',
                    'httpCode' => $httpCode > 0 ? $httpCode : null,
                    'durationMs' => $durationMs,
                    'success' => false,
                    'fallbackUsed' => true,
                    'errorCode' => 'EXCHANGE_RATE_REQUEST_FAILED',
                ]
            );
            return self::FALLBACK_RATE;
        }

        if ($httpCode !== 200 || !is_string($response) || trim($response) === '') {
            Logger::event(
                'warning',
                'external',
                'external.exchange_rate.response',
                'Exchange rate HTTP response not usable',
                [
                    'provider' => 'exchange_rate',
                    'httpCode' => $httpCode > 0 ? $httpCode : null,
                    'durationMs' => $durationMs,
                    'success' => false,
                    'fallbackUsed' => true,
                    'errorCode' => 'EXCHANGE_RATE_HTTP_ERROR',
                ]
            );
            return self::FALLBACK_RATE;
        }

        $json = json_decode($response, true);
        if (!is_array($json)) {
            Logger::event(
                'error',
                'error',
                'error.json_decode',
                'Exchange rate JSON decode failed',
                [
                    'provider' => 'exchange_rate',
                    'statusCode' => $httpCode,
                    'durationMs' => $durationMs,
                    'errorCode' => 'EXCHANGE_RATE_INVALID_RESPONSE',
                ]
            );
            Logger::event(
                'error',
                'external',
                'external.exchange_rate.response',
                'Exchange rate invalid JSON response',
                [
                    'provider' => 'exchange_rate',
                    'httpCode' => $httpCode,
                    'durationMs' => $durationMs,
                    'success' => false,
                    'fallbackUsed' => true,
                    'errorCode' => 'EXCHANGE_RATE_INVALID_RESPONSE',
                ]
            );
            return self::FALLBACK_RATE;
        }

        if (!isset($json['rates']['EUR']) || !is_numeric($json['rates']['EUR'])) {
            Logger::event(
                'warning',
                'external',
                'external.exchange_rate.response',
                'Exchange rate EUR value missing',
                [
                    'provider' => 'exchange_rate',
                    'httpCode' => $httpCode,
                    'durationMs' => $durationMs,
                    'success' => false,
                    'fallbackUsed' => true,
                    'errorCode' => 'EXCHANGE_RATE_MISSING_EUR_RATE',
                ]
            );
            return self::FALLBACK_RATE;
        }

        Logger::event(
            'info',
            'external',
            'external.exchange_rate.response',
            'Exchange rate response received',
            [
                'provider' => 'exchange_rate',
                'httpCode' => $httpCode,
                'durationMs' => $durationMs,
                'success' => true,
                'fallbackUsed' => false,
            ]
        );

        return (float) $json['rates']['EUR'];
    }
}
