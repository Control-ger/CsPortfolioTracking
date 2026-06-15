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
        $result = $this->requestCollectionEndpoint(
            $url,
            'trades',
            [
                'provider' => 'csfloat',
                'limit' => $limit,
                'page' => $page,
                'type' => $normalizedType,
            ]
        );

        return [
            'trades' => $result['rows'],
            'error' => $result['error'],
        ];
    }

    public function fetchBuyOrdersPage(int $limit = 200, int $page = 0): array
    {
        // CSFloat's /me/buy-orders endpoint rejects large page sizes with a 500
        // (unlike /me/trades which accepts up to 500). The CSFloat web client and
        // reverse-engineered libraries call it with a small limit and order=desc.
        // Matching that shape avoids the HTTP 500 that forced a trades fallback.
        $limit = max(1, min($limit, 50));
        $page = max(0, $page);
        $query = http_build_query([
            'limit' => $limit,
            'page' => $page,
            'order' => 'desc',
        ]);
        $url = 'https://csfloat.com/api/v1/me/buy-orders' . ($query !== '' ? '?' . $query : '');
        $result = $this->requestCollectionEndpoint(
            $url,
            'buy_orders',
            [
                'provider' => 'csfloat',
                'limit' => $limit,
                'page' => $page,
            ]
        );

        return [
            'orders' => $result['rows'],
            'error' => $result['error'],
        ];
    }

    public function fetchWatchlistPage(int $limit = 40): array
    {
        // CSFloat's /me/watchlist returns the user's watched listings. The
        // reverse-engineered web client calls it with a small limit; keep it
        // modest to avoid the oversize-page 500s seen on /me/buy-orders.
        $limit = max(1, min($limit, 40));
        $query = http_build_query([
            'limit' => $limit,
        ]);
        $url = 'https://csfloat.com/api/v1/me/watchlist' . ($query !== '' ? '?' . $query : '');
        $result = $this->requestCollectionEndpoint(
            $url,
            'watchlist',
            [
                'provider' => 'csfloat',
                'limit' => $limit,
            ]
        );

        return [
            'items' => $result['rows'],
            'error' => $result['error'],
        ];
    }

    private function requestCollectionEndpoint(string $url, string $eventSuffix, array $context = []): array
    {
        $apiKey = getenv('CSFLOAT_API_KEY') ?: ($_ENV['CSFLOAT_API_KEY'] ?? null);
        $start = microtime(true);

        Logger::event(
            'info',
            'external',
            sprintf('external.csfloat.%s.request', $eventSuffix),
            'CSFloat request started',
            [
                'url' => $url,
                ...$context,
            ]
        );

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 20);
        curl_setopt($ch, CURLOPT_USERAGENT, 'CsPortfolioTracking/1.0');
        if ((getenv('APP_ENV') ?: ($_ENV['APP_ENV'] ?? '')) === 'desktop') {
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
            curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
        }

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
                'CSFloat curl error',
                [
                    'statusCode' => $httpCode > 0 ? $httpCode : null,
                    'durationMs' => $durationMs,
                    'errorCode' => 'CSFLOAT_REQUEST_FAILED',
                    'curlError' => $curlError,
                    ...$context,
                ]
            );

            return [
                'rows' => [],
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
                sprintf('external.csfloat.%s.response', $eventSuffix),
                'CSFloat HTTP error response',
                [
                    'httpCode' => $httpCode,
                    'durationMs' => $durationMs,
                    'success' => false,
                    'errorCode' => $httpError['code'] ?? 'CSFLOAT_HTTP_ERROR',
                    ...$context,
                ]
            );

            return [
                'rows' => [],
                'error' => $httpError,
            ];
        }

        if ($response === '') {
            return [
                'rows' => [],
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
                sprintf('external.csfloat.%s.response', $eventSuffix),
                'CSFloat invalid JSON response',
                [
                    'httpCode' => 200,
                    'durationMs' => $durationMs,
                    'success' => false,
                    'errorCode' => 'CSFLOAT_INVALID_RESPONSE',
                    ...$context,
                ]
            );

            return [
                'rows' => [],
                'error' => [
                    'source' => 'csfloat',
                    'statusCode' => 200,
                    'code' => 'CSFLOAT_INVALID_RESPONSE',
                    'label' => 'Invalid Response',
                    'message' => 'CSFloat hat eine ungueltige Antwort geliefert.',
                ],
            ];
        }

        $rows = $this->extractRows($json);
        Logger::event(
            'info',
            'external',
            sprintf('external.csfloat.%s.response', $eventSuffix),
            'CSFloat response received',
            [
                'httpCode' => 200,
                'durationMs' => $durationMs,
                'success' => true,
                'rowCount' => count($rows),
                ...$context,
            ]
        );

        return [
            'rows' => $rows,
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
            $data = $json['data'];
            $isList = array_keys($data) === range(0, count($data) - 1);
            if ($isList) {
                return array_values($data);
            }

            foreach (['buy_orders', 'orders', 'items', 'results', 'trades', 'watchlist'] as $nestedKey) {
                if (isset($data[$nestedKey]) && is_array($data[$nestedKey])) {
                    return array_values($data[$nestedKey]);
                }
            }
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

        if (isset($json['orders']) && is_array($json['orders'])) {
            return array_values($json['orders']);
        }

        if (isset($json['buy_orders']) && is_array($json['buy_orders'])) {
            return array_values($json['buy_orders']);
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

