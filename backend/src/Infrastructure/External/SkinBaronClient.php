<?php
declare(strict_types=1);

namespace App\Infrastructure\External;

use App\Shared\Logger;

final class SkinBaronClient
{
    private const BASE_API_URL = 'https://api.skinbaron.de';
    private const BASE_WEB_URL = 'https://skinbaron.de';

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

    private const WEB_ERROR_MAP = [
        400 => ['code' => 'SKINBARON_WEB_BAD_REQUEST', 'label' => 'Bad Request'],
        401 => ['code' => 'SKINBARON_WEB_UNAUTHORIZED', 'label' => 'Unauthorized'],
        403 => ['code' => 'SKINBARON_WEB_FORBIDDEN', 'label' => 'Forbidden'],
        404 => ['code' => 'SKINBARON_WEB_NOT_FOUND', 'label' => 'Not Found'],
        429 => ['code' => 'SKINBARON_WEB_TOO_MANY_REQUESTS', 'label' => 'Too Many Requests'],
        500 => ['code' => 'SKINBARON_WEB_INTERNAL_SERVER_ERROR', 'label' => 'Internal Server Error'],
        503 => ['code' => 'SKINBARON_WEB_SERVICE_UNAVAILABLE', 'label' => 'Service Unavailable'],
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

    public function fetchPurchasesPage(int $page = 1, string $searchString = '', int $itemsPerPage = 200): array
    {
        $safePage = max(1, $page);
        $safeItemsPerPage = max(1, min($itemsPerPage, 200));
        $query = [
            'searchString' => $searchString,
            'page' => $safePage,
            'itemsPerPage' => $safeItemsPerPage,
        ];

        $result = $this->requestWeb('/api/v2/Purchases', $query, [
            'provider' => 'skinbaron',
            'source' => 'web-purchases',
            'page' => $safePage,
            'itemsPerPage' => $safeItemsPerPage,
        ]);

        if ($result['error'] !== null) {
            return [
                'purchaseGroups' => [],
                'pagination' => null,
                'error' => $result['error'],
                'meta' => $result['meta'],
            ];
        }

        $data = is_array($result['data']) ? $result['data'] : [];
        $purchaseGroups = isset($data['purchaseGroups']) && is_array($data['purchaseGroups'])
            ? array_values($data['purchaseGroups'])
            : [];
        $pagination = isset($data['paginationResponse']) && is_array($data['paginationResponse'])
            ? $data['paginationResponse']
            : null;

        return [
            'purchaseGroups' => $purchaseGroups,
            'pagination' => $pagination,
            'error' => null,
            'meta' => $result['meta'],
        ];
    }

    public function fetchPurchaseItemsPage(string $transferId, int $page = 1, int $pageSize = 25): array
    {
        $normalizedTransferId = trim($transferId);
        if ($normalizedTransferId === '') {
            return [
                'items' => [],
                'pagination' => null,
                'error' => [
                    'source' => 'skinbaron',
                    'statusCode' => null,
                    'code' => 'SKINBARON_TRANSFER_ID_INVALID',
                    'label' => 'Transfer ID Invalid',
                    'message' => 'SkinBaron transferId ist ungueltig.',
                ],
                'meta' => [],
            ];
        }

        $safePage = max(1, $page);
        $safePageSize = max(1, min($pageSize, 200));
        $paginationJson = json_encode([
            'page' => $safePage,
            'pageSize' => $safePageSize,
        ], JSON_UNESCAPED_SLASHES);
        if (!is_string($paginationJson) || trim($paginationJson) === '') {
            $paginationJson = '{"page":' . $safePage . ',"pageSize":' . $safePageSize . '}';
        }

        $query = [
            'transferId' => $normalizedTransferId,
            'pagination' => $paginationJson,
        ];
        $result = $this->requestWebRaw('/api/v2/Purchase/Purchases', $query, [
            'provider' => 'skinbaron',
            'source' => 'web-purchase-items',
            'transferId' => $normalizedTransferId,
            'page' => $safePage,
            'pageSize' => $safePageSize,
        ]);

        if ($result['error'] !== null) {
            return [
                'items' => [],
                'pagination' => null,
                'error' => $result['error'],
                'meta' => $result['meta'],
            ];
        }

        $data = is_array($result['data']) ? $result['data'] : null;
        if (!is_array($data)) {
            return [
                'items' => [],
                'pagination' => null,
                'error' => [
                    'source' => 'skinbaron',
                    'statusCode' => null,
                    'code' => 'SKINBARON_WEB_INVALID_RESPONSE',
                    'label' => 'Invalid Response',
                    'message' => 'SkinBaron Purchase/Purchases hat eine ungueltige Antwort geliefert.',
                ],
                'meta' => $result['meta'],
            ];
        }

        $items = isset($data['items']) && is_array($data['items'])
            ? array_values($data['items'])
            : [];
        $pagination = isset($data['paginationResponse']) && is_array($data['paginationResponse'])
            ? $data['paginationResponse']
            : null;

        return [
            'items' => $items,
            'pagination' => $pagination,
            'error' => null,
            'meta' => $result['meta'],
        ];
    }

    public function fetchPersonalUserConfig(): array
    {
        $result = $this->requestWebRaw('/api/v2/Profile/PersonalUserConfig', [], [
            'provider' => 'skinbaron',
            'source' => 'web-personal-user-config',
        ]);

        if ($result['error'] !== null) {
            return [
                'config' => null,
                'error' => $result['error'],
                'meta' => $result['meta'],
            ];
        }

        $data = is_array($result['data']) ? $result['data'] : null;
        if (!is_array($data)) {
            return [
                'config' => null,
                'error' => [
                    'source' => 'skinbaron',
                    'statusCode' => null,
                    'code' => 'SKINBARON_WEB_INVALID_RESPONSE',
                    'label' => 'Invalid Response',
                    'message' => 'SkinBaron PersonalUserConfig hat eine ungueltige Antwort geliefert.',
                ],
                'meta' => $result['meta'],
            ];
        }

        return [
            'config' => $data,
            'error' => null,
            'meta' => $result['meta'],
        ];
    }

    public function setLanguage(string $language): array
    {
        $normalizedLanguage = strtolower(trim($language));
        if ($normalizedLanguage === '') {
            return [
                'applied' => false,
                'resultLanguage' => null,
                'error' => [
                    'source' => 'skinbaron',
                    'statusCode' => null,
                    'code' => 'SKINBARON_LANGUAGE_INVALID',
                    'label' => 'Invalid Language',
                    'message' => 'SkinBaron Sprache ist ungueltig.',
                ],
                'meta' => [],
            ];
        }

        $result = $this->requestWebRaw('/api/v2/User/Language/Set/' . rawurlencode($normalizedLanguage), [], [
            'provider' => 'skinbaron',
            'source' => 'web-language-set',
            'language' => $normalizedLanguage,
        ]);

        if ($result['error'] !== null) {
            return [
                'applied' => false,
                'resultLanguage' => null,
                'error' => $result['error'],
                'meta' => $result['meta'],
            ];
        }

        $data = is_array($result['data']) ? $result['data'] : [];
        $resultLanguage = strtolower(trim((string) ($data['result'] ?? '')));
        $applied = $resultLanguage === '' || $resultLanguage === $normalizedLanguage;

        return [
            'applied' => $applied,
            'resultLanguage' => $resultLanguage !== '' ? $resultLanguage : null,
            'error' => $applied ? null : [
                'source' => 'skinbaron',
                'statusCode' => null,
                'code' => 'SKINBARON_LANGUAGE_SET_MISMATCH',
                'label' => 'Language Set Mismatch',
                'message' => sprintf(
                    'SkinBaron Sprache konnte nicht bestaetigt werden (expected=%s, got=%s).',
                    $normalizedLanguage,
                    $resultLanguage !== '' ? $resultLanguage : 'empty'
                ),
            ],
            'meta' => $result['meta'],
        ];
    }

    public function setAdditionalCurrency(string $currencyCode): array
    {
        $normalizedCurrency = strtoupper(trim($currencyCode));
        if ($normalizedCurrency === '') {
            return [
                'applied' => false,
                'error' => [
                    'source' => 'skinbaron',
                    'statusCode' => null,
                    'code' => 'SKINBARON_CURRENCY_INVALID',
                    'label' => 'Invalid Currency',
                    'message' => 'SkinBaron Waehrung ist ungueltig.',
                ],
                'meta' => [],
                'attempts' => [],
            ];
        }

        $attemptDefinitions = [
            ['method' => 'GET', 'query' => ['currency' => $normalizedCurrency], 'body' => null],
            ['method' => 'GET', 'query' => ['additionalCurrency' => $normalizedCurrency], 'body' => null],
            ['method' => 'POST', 'query' => [], 'body' => ['currency' => $normalizedCurrency]],
            ['method' => 'POST', 'query' => [], 'body' => ['additionalCurrency' => $normalizedCurrency]],
            ['method' => 'POST', 'query' => [], 'body' => ['code' => $normalizedCurrency]],
        ];

        $attempts = [];
        $lastError = null;
        foreach ($attemptDefinitions as $attemptDefinition) {
            $method = (string) ($attemptDefinition['method'] ?? 'GET');
            $query = is_array($attemptDefinition['query'] ?? null) ? $attemptDefinition['query'] : [];
            $body = is_array($attemptDefinition['body'] ?? null) ? $attemptDefinition['body'] : null;

            $result = $this->requestWebRaw(
                '/api/v2/User/AdditionalCurrency/Set',
                $query,
                [
                    'provider' => 'skinbaron',
                    'source' => 'web-additional-currency-set',
                    'method' => $method,
                    'currency' => $normalizedCurrency,
                ],
                $method,
                $body
            );

            $attemptEntry = [
                'method' => $method,
                'query' => $query,
                'body' => $body,
                'ok' => $result['error'] === null,
                'statusCode' => $result['error']['statusCode'] ?? null,
                'errorCode' => $result['error']['code'] ?? null,
            ];
            $attempts[] = $attemptEntry;

            if ($result['error'] !== null) {
                $lastError = $result['error'];
                continue;
            }

            $data = is_array($result['data']) ? $result['data'] : [];
            if (($data['success'] ?? null) === true) {
                return [
                    'applied' => true,
                    'error' => null,
                    'meta' => $result['meta'],
                    'attempts' => $attempts,
                ];
            }

            $lastError = [
                'source' => 'skinbaron',
                'statusCode' => null,
                'code' => 'SKINBARON_CURRENCY_SET_UNEXPECTED_RESPONSE',
                'label' => 'Unexpected Response',
                'message' => 'SkinBaron AdditionalCurrency/Set hat keine success=true Antwort geliefert.',
            ];
        }

        return [
            'applied' => false,
            'error' => $lastError ?? [
                'source' => 'skinbaron',
                'statusCode' => null,
                'code' => 'SKINBARON_CURRENCY_SET_FAILED',
                'label' => 'Currency Set Failed',
                'message' => 'SkinBaron Waehrung konnte nicht gesetzt werden.',
            ],
            'meta' => [],
            'attempts' => $attempts,
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
        $url = rtrim(self::BASE_API_URL, '/') . '/' . ltrim($path, '/');
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

    private function requestWeb(string $path, array $query = [], array $context = []): array
    {
        $result = $this->requestWebRaw($path, $query, $context, 'GET');
        if ($result['error'] !== null) {
            return $result;
        }

        $decoded = is_array($result['data']) ? $result['data'] : null;
        if (!is_array($decoded)) {
            return [
                'data' => null,
                'meta' => [],
                'error' => [
                    'source' => 'skinbaron',
                    'statusCode' => null,
                    'code' => 'SKINBARON_WEB_INVALID_RESPONSE',
                    'label' => 'Invalid Response',
                    'message' => 'SkinBaron Purchases hat eine ungueltige Antwort geliefert.',
                ],
            ];
        }

        if (!isset($decoded['purchaseGroups']) || !is_array($decoded['purchaseGroups'])) {
            return [
                'data' => null,
                'meta' => [],
                'error' => [
                    'source' => 'skinbaron',
                    'statusCode' => null,
                    'code' => 'SKINBARON_WEB_SESSION_INVALID',
                    'label' => 'Session Invalid',
                    'message' => 'SkinBaron Session scheint ungueltig oder abgelaufen zu sein.',
                ],
            ];
        }

        return [
            'data' => $decoded,
            'meta' => $result['meta'],
            'error' => null,
        ];
    }

    private function requestWebRaw(
        string $path,
        array $query = [],
        array $context = [],
        string $method = 'GET',
        ?array $body = null
    ): array
    {
        $sessionCookie = $this->getSessionCookieHeader();
        if ($sessionCookie === '') {
            return [
                'data' => null,
                'meta' => [],
                'error' => [
                    'source' => 'skinbaron',
                    'statusCode' => null,
                    'code' => 'SKINBARON_SESSION_COOKIE_MISSING',
                    'label' => 'Session Cookie Missing',
                    'message' => 'SkinBaron Session-Cookie fehlt. Bitte in den Einstellungen hinterlegen.',
                ],
            ];
        }

        $normalizedMethod = strtoupper(trim($method));
        if (!in_array($normalizedMethod, ['GET', 'POST'], true)) {
            $normalizedMethod = 'GET';
        }

        $queryString = http_build_query($query);
        $url = rtrim(self::BASE_WEB_URL, '/') . '/' . ltrim($path, '/');
        if ($queryString !== '') {
            $url .= '?' . $queryString;
        }
        $start = microtime(true);

        Logger::event(
            'info',
            'external',
            'external.skinbaron.web.request',
            'SkinBaron web request started',
            [
                'url' => $url,
                ...$context,
            ]
        );

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        if ($normalizedMethod === 'POST') {
            curl_setopt($ch, CURLOPT_POST, true);
            $payload = $body !== null ? json_encode($body, JSON_UNESCAPED_SLASHES) : '{}';
            curl_setopt($ch, CURLOPT_POSTFIELDS, is_string($payload) ? $payload : '{}');
        } else {
            curl_setopt($ch, CURLOPT_HTTPGET, true);
        }
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 20);
        curl_setopt($ch, CURLOPT_USERAGENT, 'CsPortfolioTracking/1.0');
        if ((getenv('APP_ENV') ?: ($_ENV['APP_ENV'] ?? '')) === 'desktop') {
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
            curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
        }
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Accept: application/json, text/plain, */*',
            'Content-Type: application/json',
            'x-requested-with: XMLHttpRequest',
            'Referer: https://skinbaron.de/en/profile/purchases',
            'Accept-Language: en-US,en;q=0.9',
            'Cookie: ' . $sessionCookie,
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
                    'code' => 'SKINBARON_WEB_REQUEST_FAILED',
                    'label' => 'Web Request Failed',
                    'message' => $curlError !== '' ? $curlError : 'SkinBaron Purchases konnte nicht erreicht werden.',
                ],
            ];
        }

        $decoded = $this->decodeJson($response);
        $rawMessage = $this->extractErrorMessage($decoded);

        if ($httpCode < 200 || $httpCode >= 300) {
            $error = $this->buildHttpError($httpCode, $rawMessage, true);
            Logger::event(
                'warning',
                'external',
                'external.skinbaron.web.response',
                'SkinBaron web HTTP error response',
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
                    'code' => 'SKINBARON_WEB_INVALID_RESPONSE',
                    'label' => 'Invalid Response',
                    'message' => 'SkinBaron Web API hat eine ungueltige Antwort geliefert.',
                ],
            ];
        }

        Logger::event(
            'info',
            'external',
            'external.skinbaron.web.response',
            'SkinBaron web response received',
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

    private function buildHttpError(int $httpCode, string $message = '', bool $web = false): array
    {
        $map = $web ? self::WEB_ERROR_MAP : self::ERROR_MAP;
        $mapping = $map[$httpCode] ?? [
            'code' => $web ? 'SKINBARON_WEB_HTTP_ERROR' : 'SKINBARON_HTTP_ERROR',
            'label' => 'HTTP Error',
        ];

        $fallbackMessage = sprintf(
            '%s antwortet mit %d %s.',
            $web ? 'SkinBaron Purchases' : 'SkinBaron',
            $httpCode,
            $mapping['label']
        );
        return [
            'source' => 'skinbaron',
            'statusCode' => $httpCode > 0 ? $httpCode : null,
            'code' => $mapping['code'],
            'label' => $mapping['label'],
            'message' => $message !== '' ? $message : $fallbackMessage,
        ];
    }

    private function getSessionCookieHeader(): string
    {
        $rawCookie = trim((string) (getenv('SKINBARON_SESSION_COOKIE') ?: ($_ENV['SKINBARON_SESSION_COOKIE'] ?? '')));
        if ($rawCookie === '') {
            return '';
        }

        $normalized = preg_replace('/^cookie:\s*/i', '', $rawCookie);
        if (!is_string($normalized)) {
            return '';
        }

        $trimmed = trim($normalized);
        return $trimmed;
    }
}
