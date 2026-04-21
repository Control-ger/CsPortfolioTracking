<?php
declare(strict_types=1);

namespace App\Infrastructure\External;

use App\Shared\Logger;

final class CsFloatTradeClient
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

    public function fetchTradesPage(int $limit = 1000, int $page = 0, ?string $type = 'buy'): array
    {
        $limit = max(1, min($limit, 1000));
        $page = max(0, $page);
        $normalizedType = $this->normalizeType($type);

        $query = http_build_query(array_filter([
            'limit' => $limit,
            'page' => $page,
            'type' => $normalizedType,
        ], static fn ($value) => $value !== null && $value !== ''));

        $url = 'https://csfloat.com/api/v1/me/trades' . ($query !== '' ? '?' . $query : '');
        $apiKey = getenv('CSFLOAT_API_KEY') ?: ($_ENV['CSFLOAT_API_KEY'] ?? null);
        $start = microtime(true);

        Logger::event(
            'info',
            'external',
            'external.csfloat.trades.request',
            'CSFloat trade request started',
            [
                'provider' => 'csfloat',
                'url' => $url,
                'limit' => $limit,
                'page' => $page,
                'type' => $normalizedType,
            ]
        );

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 20);
        curl_setopt($ch, CURLOPT_USERAGENT, 'CsPortfolioTracking/1.0');

        $headers = ['Accept: application/json'];
        if ($apiKey !== null && $apiKey !== '') {
            $headers[] = 'Authorization: ' . $apiKey;
        }
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

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
                'CSFloat trade curl error',
                [
                    'provider' => 'csfloat',
                    'limit' => $limit,
                    'page' => $page,
                    'type' => $normalizedType,
                    'statusCode' => $httpCode > 0 ? $httpCode : null,
                    'durationMs' => $durationMs,
                    'errorCode' => 'CSFLOAT_REQUEST_FAILED',
                    'curlError' => $curlError,
                ]
            );

            return [
                'trades' => [],
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
            $httpError = $this->buildHttpError($httpCode);
            Logger::event(
                'warning',
                'external',
                'external.csfloat.trades.response',
                'CSFloat trade HTTP error response',
                [
                    'provider' => 'csfloat',
                    'limit' => $limit,
                    'page' => $page,
                    'type' => $normalizedType,
                    'httpCode' => $httpCode,
                    'durationMs' => $durationMs,
                    'success' => false,
                    'errorCode' => $httpError['code'] ?? 'CSFLOAT_HTTP_ERROR',
                ]
            );

            return [
                'trades' => [],
                'error' => $httpError,
            ];
        }

        if ($response === '') {
            return [
                'trades' => [],
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
            Logger::event(
                'error',
                'external',
                'external.csfloat.trades.response',
                'CSFloat trade invalid JSON response',
                [
                    'provider' => 'csfloat',
                    'limit' => $limit,
                    'page' => $page,
                    'type' => $normalizedType,
                    'httpCode' => 200,
                    'durationMs' => $durationMs,
                    'success' => false,
                    'errorCode' => 'CSFLOAT_INVALID_RESPONSE',
                ]
            );

            return [
                'trades' => [],
                'error' => [
                    'source' => 'csfloat',
                    'statusCode' => 200,
                    'code' => 'CSFLOAT_INVALID_RESPONSE',
                    'label' => 'Invalid Response',
                    'message' => 'CSFloat hat eine ungueltige Antwort geliefert.',
                ],
            ];
        }

        $trades = $this->extractRows($json);
        Logger::event(
            'info',
            'external',
            'external.csfloat.trades.response',
            'CSFloat trade response received',
            [
                'provider' => 'csfloat',
                'limit' => $limit,
                'page' => $page,
                'type' => $normalizedType,
                'httpCode' => 200,
                'durationMs' => $durationMs,
                'success' => true,
                'tradeCount' => count($trades),
            ]
        );

        return [
            'trades' => $trades,
            'error' => null,
        ];
    }

    private function normalizeType(?string $type): ?string
    {
        $normalized = strtolower(trim((string) $type));
        if ($normalized === '' || $normalized === 'all') {
            return null;
        }

        return in_array($normalized, ['buy', 'sell'], true) ? $normalized : 'buy';
    }

    private function extractRows(array $json): array
    {
        if (isset($json['data']) && is_array($json['data'])) {
            return array_values($json['data']);
        }

        if (isset($json['trades']) && is_array($json['trades'])) {
            return array_values($json['trades']);
        }

        if (isset($json['items']) && is_array($json['items'])) {
            return array_values($json['items']);
        }

        if (isset($json['results']) && is_array($json['results'])) {
            return array_values($json['results']);
        }

        $isList = array_keys($json) === range(0, count($json) - 1);
        return $isList ? array_values($json) : [];
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

