<?php
declare(strict_types=1);

namespace App\Infrastructure\External;

use App\Shared\Logger;

final class CsFloatClient
{
    private const ERROR_MAP = [
        400 => ['code' => 'CSFLOAT_BAD_REQUEST', 'label' => 'Bad Request'],
        401 => ['code' => 'CSFLOAT_UNAUTHORIZED', 'label' => 'Unauthorized'],
        403 => ['code' => 'CSFLOAT_FORBIDDEN', 'label' => 'Forbidden'],
        404 => ['code' => 'CSFLOAT_NOT_FOUND', 'label' => 'Not Found'],
        405 => ['code' => 'CSFLOAT_METHOD_NOT_ALLOWED', 'label' => 'Method Not Allowed'],
        406 => ['code' => 'CSFLOAT_NOT_ACCEPTABLE', 'label' => 'Not Acceptable'],
        410 => ['code' => 'CSFLOAT_GONE', 'label' => 'Gone'],
        418 => ['code' => 'CSFLOAT_TEAPOT', 'label' => "I'm a teapot"],
        429 => ['code' => 'CSFLOAT_TOO_MANY_REQUESTS', 'label' => 'Too Many Requests'],
        500 => ['code' => 'CSFLOAT_INTERNAL_SERVER_ERROR', 'label' => 'Internal Server Error'],
        503 => ['code' => 'CSFLOAT_SERVICE_UNAVAILABLE', 'label' => 'Service Unavailable'],
    ];

    public function fetchLowestPriceUsd(string $marketHashName): ?float
    {
        $listing = $this->fetchLowestListingSnapshot($marketHashName);
        return $listing['priceUsd'] ?? null;
    }

    public function fetchLowestListingSnapshot(string $marketHashName): ?array
    {
        $result = $this->fetchLowestListingResult($marketHashName);
        return is_array($result['snapshot'] ?? null) ? $result['snapshot'] : null;
    }

    public function fetchLowestListingResult(string $marketHashName): array
    {
        $encodedName = urlencode($marketHashName);
        $url = "https://csfloat.com/api/v1/listings?market_hash_name={$encodedName}&type=buy_now&sort_by=lowest_price&limit=1";
        $apiKey = getenv('CSFLOAT_API_KEY') ?: $_ENV['CSFLOAT_API_KEY'] ?? null;

        Logger::debug('CSFloat API Request', [
            'url' => $url,
            'itemName' => $marketHashName,
            'apiKeyProvided' => $apiKey !== null && $apiKey !== '',
            'apiKeyLength' => $apiKey ? strlen($apiKey) : 0,
            'apiKeyPrefix' => $apiKey ? substr($apiKey, 0, 8) . '***' : 'NONE',
        ]);

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);
        curl_setopt($ch, CURLOPT_USERAGENT, 'CsPortfolioTracking/1.0');
        
        $headers = ['Accept: application/json'];
        if ($apiKey !== null && $apiKey !== '') {
            $headers[] = "Authorization: {$apiKey}";
        }
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        $headersList = curl_getinfo($ch, CURLINFO_HEADER_OUT);
        curl_close($ch);

        Logger::debug('CSFloat API Response', [
            'httpCode' => $httpCode,
            'curlError' => $curlError ?: 'NONE',
            'responseLength' => $response ? strlen($response) : 0,
            'headersSent' => $headersList ?: 'NONE',
        ]);

        if ($response === false) {
            Logger::error('CSFloat Request Failed', [
                'itemName' => $marketHashName,
                'error' => $curlError,
            ]);
            return [
                'snapshot' => null,
                'error' => [
                    'source' => 'csfloat',
                    'statusCode' => $httpCode > 0 ? $httpCode : null,
                    'code' => 'CSFLOAT_REQUEST_FAILED',
                    'label' => 'Request Failed',
                    'message' => $curlError !== '' ? $curlError : 'CSFloat konnte nicht erreicht werden.',
                ],
            ];
        }

        if ($httpCode !== 200) {
            Logger::warning('CSFloat HTTP Error', [
                'itemName' => $marketHashName,
                'httpCode' => $httpCode,
                'response' => $response ? substr($response, 0, 500) : 'EMPTY',
            ]);
            return [
                'snapshot' => null,
                'error' => $this->buildHttpError($httpCode),
            ];
        }

        if ($response === '') {
            Logger::warning('CSFloat Empty Response', ['itemName' => $marketHashName]);
            return [
                'snapshot' => null,
                'error' => [
                    'source' => 'csfloat',
                    'statusCode' => 200,
                    'code' => 'CSFLOAT_EMPTY_RESPONSE',
                    'label' => 'Empty Response',
                    'message' => 'CSFloat hat eine leere Antwort geliefert.',
                ],
            ];
        }

        $json = json_decode($response, true);
        if (!is_array($json)) {
            Logger::error('CSFloat Invalid JSON Response', [
                'itemName' => $marketHashName,
                'response' => substr($response, 0, 500),
            ]);
            return [
                'snapshot' => null,
                'error' => [
                    'source' => 'csfloat',
                    'statusCode' => 200,
                    'code' => 'CSFLOAT_INVALID_RESPONSE',
                    'label' => 'Invalid Response',
                    'message' => 'CSFloat hat eine ungueltige Antwort geliefert.',
                ],
            ];
        }

        $listing = null;
        if (isset($json[0]['price'])) {
            $listing = $json[0];
        } elseif (isset($json['data'][0]['price'])) {
            $listing = $json['data'][0];
        }

        if ($listing === null || !isset($listing['price'])) {
            Logger::debug('CSFloat No Listing Found', ['itemName' => $marketHashName]);
            return ['snapshot' => null, 'error' => null];
        }

        Logger::debug('CSFloat Success', [
            'itemName' => $marketHashName,
            'priceUsd' => $listing['price'] ?? null,
        ]);

        $item = $listing['item'] ?? [];
        if (!is_array($item)) {
            $item = [];
        }

        $iconPath = (string) ($item['icon_url'] ?? '');

        return [
            'snapshot' => [
                'priceUsd' => round(((float) $listing['price']) / 100.0, 2),
                'marketHashName' => (string) ($item['market_hash_name'] ?? $marketHashName),
                'itemType' => isset($item['type']) ? (string) $item['type'] : null,
                'itemTypeLabel' => isset($item['type_name']) ? (string) $item['type_name'] : null,
                'wearName' => isset($item['wear_name']) ? (string) $item['wear_name'] : null,
                'iconUrl' => $iconPath !== ''
                    ? sprintf('https://community.akamai.steamstatic.com/economy/image/%s/96fx96f', $iconPath)
                    : null,
            ],
            'error' => null,
        ];
    }

    private function buildHttpError(int $httpCode): array
    {
        $mapping = self::ERROR_MAP[$httpCode] ?? [
            'code' => 'CSFLOAT_HTTP_ERROR',
            'label' => 'HTTP Error',
        ];

        return [
            'source' => 'csfloat',
            'statusCode' => $httpCode,
            'code' => $mapping['code'],
            'label' => $mapping['label'],
            'message' => sprintf('CSFloat antwortet mit %d %s.', $httpCode, $mapping['label']),
        ];
    }
}
