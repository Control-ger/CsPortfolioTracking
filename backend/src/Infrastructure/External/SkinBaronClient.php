<?php
declare(strict_types=1);

namespace App\Infrastructure\External;

use App\Shared\Logger;

final class SkinBaronClient
{
    private const BASE_URL = 'https://api.skinbaron.de';

    private const ERROR_MAP = [
        400 => ['code' => 'SKINBARON_BAD_REQUEST', 'label' => 'Bad Request'],
        401 => ['code' => 'SKINBARON_UNAUTHORIZED', 'label' => 'Unauthorized'],
        403 => ['code' => 'SKINBARON_FORBIDDEN', 'label' => 'Forbidden'],
        404 => ['code' => 'SKINBARON_NOT_FOUND', 'label' => 'Not Found'],
        405 => ['code' => 'SKINBARON_METHOD_NOT_ALLOWED', 'label' => 'Method Not Allowed'],
        406 => ['code' => 'SKINBARON_NOT_ACCEPTABLE', 'label' => 'Not Acceptable'],
        429 => ['code' => 'SKINBARON_TOO_MANY_REQUESTS', 'label' => 'Too Many Requests'],
        500 => ['code' => 'SKINBARON_INTERNAL_SERVER_ERROR', 'label' => 'Internal Server Error'],
        503 => ['code' => 'SKINBARON_SERVICE_UNAVAILABLE', 'label' => 'Service Unavailable'],
    ];

    public function fetchSalesPage(int $itemsPerPage = 100, ?string $afterSaleId = null, ?int $saleType = null): array
    {
        $limit = max(1, min($itemsPerPage, 200));
        $payload = [
            'items_per_page' => $limit,
            'appid' => 730,
            'sort_order' => 0,
        ];
        if ($saleType !== null && $saleType >= 1 && $saleType <= 7) {
            $payload['type'] = $saleType;
        }
        if ($afterSaleId !== null && trim($afterSaleId) !== '') {
            $payload['after_saleid'] = trim($afterSaleId);
        }

        $result = $this->request('/GetSales', $payload, [
            'provider' => 'skinbaron',
            'limit' => $limit,
            'afterSaleId' => $afterSaleId,
            'saleType' => $payload['type'] ?? 'all',
        ]);

        if ($result['error'] !== null) {
            return [
                'sales' => [],
                'error' => $result['error'],
                'meta' => $result['meta'],
            ];
        }

        $data = is_array($result['data']) ? $result['data'] : [];
        $rows = $this->extractRows($data);
        return [
            'sales' => $rows,
            'error' => null,
            'meta' => $result['meta'],
        ];
    }

    private function request(string $path, array $payload, array $context = []): array
    {
        $apiKey = trim((string) (getenv('SKINBARON_API_KEY') ?: ($_ENV['SKINBARON_API_KEY'] ?? '')));
        if ($apiKey === '') {
            return [
                'data' => null,
                'meta' => [],
                'error' => [
                    'source' => 'skinbaron',
                    'statusCode' => null,
                    'code' => 'SKINBARON_API_KEY_MISSING',
                    'label' => 'API Key Missing',
                    'message' => 'SkinBaron API Key fehlt. Bitte hinterlege ihn zuerst in den Einstellungen.',
                ],
            ];
        }

        $requestPayload = ['apikey' => $apiKey, ...$payload];
        $url = rtrim(self::BASE_URL, '/') . '/' . ltrim($path, '/');
        $start = microtime(true);

        Logger::event(
            'info',
            'external',
            'external.skinbaron.request',
            'SkinBaron request started',
            [
                'url' => $url,
                ...$context,
            ]
        );

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($requestPayload, JSON_UNESCAPED_SLASHES));
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 20);
        curl_setopt($ch, CURLOPT_USERAGENT, 'CsPortfolioTracking/1.0');
        if ((getenv('APP_ENV') ?: ($_ENV['APP_ENV'] ?? '')) === 'desktop') {
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
            curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
        }
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Accept: application/json',
            'Content-Type: application/json',
            'x-requested-with: XMLHttpRequest',
        ]);

        $response = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);
        $durationMs = (int) round((microtime(true) - $start) * 1000);

        if ($response === false) {
            return [
                'data' => null,
                'meta' => [],
                'error' => [
                    'source' => 'skinbaron',
                    'statusCode' => $httpCode > 0 ? $httpCode : null,
                    'code' => 'SKINBARON_REQUEST_FAILED',
                    'label' => 'Request Failed',
                    'message' => $curlError !== '' ? $curlError : 'SkinBaron konnte nicht erreicht werden.',
                ],
            ];
        }

        $decoded = $this->decodeJson($response);
        $rawMessage = $this->extractErrorMessage($decoded);

        if ($httpCode < 200 || $httpCode >= 300) {
            $error = $this->buildHttpError($httpCode, $rawMessage);
            Logger::event(
                'warning',
                'external',
                'external.skinbaron.response',
                'SkinBaron HTTP error response',
                [
                    'httpCode' => $httpCode,
                    'durationMs' => $durationMs,
                    'errorCode' => $error['code'],
                    ...$context,
                ]
            );

            return [
                'data' => null,
                'meta' => [],
                'error' => $error,
            ];
        }

        if (!is_array($decoded)) {
            return [
                'data' => null,
                'meta' => [],
                'error' => [
                    'source' => 'skinbaron',
                    'statusCode' => $httpCode,
                    'code' => 'SKINBARON_INVALID_RESPONSE',
                    'label' => 'Invalid Response',
                    'message' => 'SkinBaron hat eine ungueltige Antwort geliefert.',
                ],
            ];
        }

        if ($this->looksLikeApiError($decoded)) {
            return [
                'data' => $decoded,
                'meta' => [],
                'error' => [
                    'source' => 'skinbaron',
                    'statusCode' => $httpCode,
                    'code' => 'SKINBARON_API_ERROR',
                    'label' => 'API Error',
                    'message' => $rawMessage !== '' ? $rawMessage : 'SkinBaron API Fehler.',
                ],
            ];
        }

        Logger::event(
            'info',
            'external',
            'external.skinbaron.response',
            'SkinBaron response received',
            [
                'httpCode' => $httpCode,
                'durationMs' => $durationMs,
                ...$context,
            ]
        );

        return [
            'data' => $decoded,
            'meta' => [],
            'error' => null,
        ];
    }

    private function extractRows(array $payload): array
    {
        if (isset($payload['response']) && is_array($payload['response'])) {
            return array_values($payload['response']);
        }

        if (isset($payload['data']) && is_array($payload['data'])) {
            return array_values($payload['data']);
        }

        if (isset($payload['sales']) && is_array($payload['sales'])) {
            return array_values($payload['sales']);
        }

        $isList = array_keys($payload) === range(0, count($payload) - 1);
        return $isList ? array_values($payload) : [];
    }

    private function decodeJson(string $payload): ?array
    {
        $decoded = json_decode($payload, true);
        return is_array($decoded) ? $decoded : null;
    }

    private function looksLikeApiError(array $payload): bool
    {
        $message = strtolower($this->extractErrorMessage($payload));
        if ($message === '') {
            return false;
        }

        if (str_contains($message, 'bad authenticity token')) {
            return true;
        }

        return isset($payload['error']) || isset($payload['errors']) || ($payload['success'] ?? true) === false;
    }

    private function extractErrorMessage(?array $payload): string
    {
        if (!is_array($payload)) {
            return '';
        }

        $candidates = [
            $payload['error'] ?? null,
            $payload['message'] ?? null,
            $payload['msg'] ?? null,
            $payload['reason'] ?? null,
            $payload['errors'] ?? null,
        ];

        foreach ($candidates as $candidate) {
            if (is_string($candidate) && trim($candidate) !== '') {
                return trim($candidate);
            }
            if (is_array($candidate)) {
                foreach ($candidate as $entry) {
                    if (is_string($entry) && trim($entry) !== '') {
                        return trim($entry);
                    }
                    if (is_array($entry) && isset($entry['message']) && is_string($entry['message'])) {
                        return trim((string) $entry['message']);
                    }
                }
            }
        }

        return '';
    }

    private function buildHttpError(int $httpCode, string $message = ''): array
    {
        $mapping = self::ERROR_MAP[$httpCode] ?? [
            'code' => 'SKINBARON_HTTP_ERROR',
            'label' => 'HTTP Error',
        ];

        $fallbackMessage = sprintf('SkinBaron antwortet mit %d %s.', $httpCode, $mapping['label']);
        return [
            'source' => 'skinbaron',
            'statusCode' => $httpCode > 0 ? $httpCode : null,
            'code' => $mapping['code'],
            'label' => $mapping['label'],
            'message' => $message !== '' ? $message : $fallbackMessage,
        ];
    }
}
