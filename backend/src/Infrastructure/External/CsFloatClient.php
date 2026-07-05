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
    private const BASE_LISTINGS_URL = 'https://csfloat.com/api/v1/listings';
    private const PRICE_LIST_URL = 'https://csfloat.com/api/v1/listings/price-list';
    private const PRICE_LIST_CACHE_TTL_SECONDS = 90;

    /** @var array<string, array{priceUsd: float, quantity: int}>|null */
    private ?array $priceListIndexCache = null;
    private ?int $priceListIndexFetchedAt = null;

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
        $priceListEntry = $this->findPriceListEntry($marketHashName);
        if ($priceListEntry !== null) {
            return [
                'snapshot' => [
                    'priceUsd' => round((float) $priceListEntry['priceUsd'], 2),
                    'marketHashName' => $marketHashName,
                    'itemType' => null,
                    'itemTypeLabel' => null,
                    'wearName' => null,
                    'iconUrl' => null,
                    'floatValue' => null,
                    'paintSeed' => null,
                    'inspectLink' => null,
                    'strategy' => 'market_price_list',
                    'confidence' => 'medium',
                    'sampleSize' => max(1, (int) ($priceListEntry['quantity'] ?? 1)),
                ],
                'error' => null,
            ];
        }

        $result = $this->fetchListingsResult(
            $marketHashName,
            [
                'type' => 'buy_now',
                'sort_by' => 'lowest_price',
                'limit' => 1,
            ],
            'lowest_listing_lookup'
        );

        if (($result['error'] ?? null) !== null) {
            return [
                'snapshot' => null,
                'error' => $result['error'],
            ];
        }

        $listings = is_array($result['listings'] ?? null) ? $result['listings'] : [];
        if ($listings === []) {
            return ['snapshot' => null, 'error' => null];
        }

        $snapshot = $this->buildComparableSnapshot(
            $marketHashName,
            $listings,
            [
                'strategy' => 'market_lowest',
                'confidence' => 'low',
            ]
        );

        // The listings search can return a DIFFERENT item than requested (e.g. a
        // knife from the "Dreams & Nightmares" collection when asked for the case).
        // Persisting such a price poisons item_live_cache/price_history for the
        // requested item, so a mismatched snapshot must be discarded.
        if (!$this->snapshotMatchesRequestedName($snapshot, $marketHashName)) {
            Logger::event(
                'warning',
                'external',
                'external.csfloat.listing_name_mismatch',
                'CSFloat listing lookup returned a different item; snapshot discarded',
                [
                    'provider' => 'csfloat',
                    'itemName' => $marketHashName,
                    'returnedName' => (string) ($snapshot['marketHashName'] ?? ''),
                    'priceUsd' => $snapshot['priceUsd'] ?? null,
                ]
            );
            return ['snapshot' => null, 'error' => null];
        }

        return [
            'snapshot' => $snapshot,
            'error' => null,
        ];
    }

    private function snapshotMatchesRequestedName(?array $snapshot, string $marketHashName): bool
    {
        // Strict: only the name the listing payload itself carried counts.
        // `marketHashName` falls back to the REQUESTED name for name-less listings,
        // which previously let mismatched prices slip through the guard (observed:
        // the Dreams & Nightmares Case getting re-poisoned with a ~600 USD price
        // on every fallback lookup). No verifiable name → no trusted price.
        $listedName = trim((string) ($snapshot['listedMarketHashName'] ?? ''));
        if ($listedName === '') {
            return false;
        }

        return mb_strtolower($listedName) === mb_strtolower(trim($marketHashName));
    }

    private function findPriceListEntry(string $marketHashName): ?array
    {
        $index = $this->getPriceListIndex();
        if (!is_array($index) || $index === []) {
            return null;
        }

        return $index[$marketHashName] ?? null;
    }

    /**
     * @return array<string, array{priceUsd: float, quantity: int}>|null
     */
    private function getPriceListIndex(): ?array
    {
        if (
            is_array($this->priceListIndexCache) &&
            $this->priceListIndexFetchedAt !== null &&
            (time() - $this->priceListIndexFetchedAt) < self::PRICE_LIST_CACHE_TTL_SECONDS
        ) {
            return $this->priceListIndexCache;
        }

        $index = $this->fetchPriceListIndex();
        if (is_array($index) && $index !== []) {
            $this->priceListIndexCache = $index;
            $this->priceListIndexFetchedAt = time();
            return $this->priceListIndexCache;
        }

        if (
            is_array($this->priceListIndexCache) &&
            $this->priceListIndexFetchedAt !== null
        ) {
            return $this->priceListIndexCache;
        }

        return null;
    }

    /**
     * @return array<string, array{priceUsd: float, quantity: int}>|null
     */
    public function fetchPriceListIndexSnapshot(): ?array
    {
        return $this->getPriceListIndex();
    }

    /**
     * @return array<string, array{priceUsd: float, quantity: int}>|null
     */
    private function fetchPriceListIndex(): ?array
    {
        $start = microtime(true);
        Logger::event(
            'info',
            'external',
            'external.csfloat.price_list.request',
            'CSFloat price list request started',
            [
                'provider' => 'csfloat',
                'url' => self::PRICE_LIST_URL,
            ]
        );

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, self::PRICE_LIST_URL);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 20);
        curl_setopt($ch, CURLOPT_USERAGENT, 'CsPortfolioTracking/1.0');
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Accept: application/json']);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);
        $durationMs = (int) round((microtime(true) - $start) * 1000);

        if ($response === false || $httpCode !== 200 || $response === '') {
            Logger::event(
                'warning',
                'external',
                'external.csfloat.price_list.response',
                'CSFloat price list request failed',
                [
                    'provider' => 'csfloat',
                    'httpCode' => $httpCode > 0 ? $httpCode : null,
                    'durationMs' => $durationMs,
                    'curlError' => $curlError !== '' ? $curlError : null,
                ]
            );
            return null;
        }

        $json = json_decode($response, true);
        if (!is_array($json)) {
            Logger::event(
                'warning',
                'external',
                'external.csfloat.price_list.response',
                'CSFloat price list returned invalid JSON',
                [
                    'provider' => 'csfloat',
                    'httpCode' => 200,
                    'durationMs' => $durationMs,
                ]
            );
            return null;
        }

        $index = [];
        foreach ($json as $row) {
            if (!is_array($row)) {
                continue;
            }

            $name = trim((string) ($row['market_hash_name'] ?? ''));
            $minPrice = $row['min_price'] ?? null;
            if ($name === '' || !is_numeric($minPrice)) {
                continue;
            }

            $minPriceCents = (int) $minPrice;
            if ($minPriceCents <= 0) {
                continue;
            }

            $quantity = is_numeric($row['quantity'] ?? null)
                ? max(0, (int) $row['quantity'])
                : 0;

            $index[$name] = [
                'priceUsd' => round($minPriceCents / 100.0, 2),
                'quantity' => $quantity,
            ];
        }

        Logger::event(
            'info',
            'external',
            'external.csfloat.price_list.response',
            'CSFloat price list loaded',
            [
                'provider' => 'csfloat',
                'httpCode' => 200,
                'durationMs' => $durationMs,
                'itemCount' => count($index),
            ]
        );

        return $index !== [] ? $index : null;
    }

    public function fetchComparableListingResult(
        string $marketHashName,
        ?float $targetFloat = null,
        ?int $targetPaintSeed = null
    ): array {
        $normalizedFloat = $this->normalizeFloat($targetFloat);
        $normalizedPaintSeed = $this->normalizePaintSeed($targetPaintSeed);

        $attempts = [];
        if ($normalizedPaintSeed !== null) {
            $attempts[] = [
                'strategy' => 'seed_exact',
                'confidence' => 'high',
                'params' => [
                    'paint_seed' => (string) $normalizedPaintSeed,
                    'limit' => 12,
                    'sort_by' => 'lowest_price',
                ],
            ];
        }

        if ($normalizedFloat !== null) {
            foreach ([0.0025, 0.0050, 0.0100, 0.0200] as $band) {
                $attempts[] = [
                    'strategy' => 'float_band_' . $this->formatBand($band),
                    'confidence' => $band <= 0.0050 ? 'high' : ($band <= 0.0100 ? 'medium' : 'low'),
                    'params' => [
                        'min_float' => $this->formatFloat(max(0.0, $normalizedFloat - $band)),
                        'max_float' => $this->formatFloat(min(1.0, $normalizedFloat + $band)),
                        'limit' => 12,
                        'sort_by' => 'lowest_price',
                    ],
                ];
            }
        }

        $attempts[] = [
            'strategy' => 'market_lowest',
            'confidence' => 'low',
            'params' => [
                'limit' => 12,
                'sort_by' => 'lowest_price',
            ],
        ];

        $lastError = null;
        foreach ($attempts as $attempt) {
            $result = $this->fetchListingsResult(
                $marketHashName,
                array_merge(['type' => 'buy_now'], (array) ($attempt['params'] ?? [])),
                'comparable_listing_lookup',
                [
                    'strategy' => $attempt['strategy'],
                    'targetFloat' => $normalizedFloat,
                    'targetPaintSeed' => $normalizedPaintSeed,
                ]
            );
            $error = is_array($result['error'] ?? null) ? $result['error'] : null;
            if ($error !== null) {
                $lastError = $error;
                continue;
            }

            $listings = is_array($result['listings'] ?? null) ? $result['listings'] : [];
            if ($listings === []) {
                continue;
            }

            $snapshot = $this->buildComparableSnapshot(
                $marketHashName,
                $listings,
                [
                    'strategy' => (string) $attempt['strategy'],
                    'confidence' => (string) $attempt['confidence'],
                ]
            );

            if (!$this->snapshotMatchesRequestedName($snapshot, $marketHashName)) {
                Logger::event(
                    'warning',
                    'external',
                    'external.csfloat.listing_name_mismatch',
                    'CSFloat comparable lookup returned a different item; attempt skipped',
                    [
                        'provider' => 'csfloat',
                        'itemName' => $marketHashName,
                        'returnedName' => (string) ($snapshot['marketHashName'] ?? ''),
                        'strategy' => (string) $attempt['strategy'],
                    ]
                );
                continue;
            }

            return [
                'snapshot' => $snapshot,
                'error' => null,
            ];
        }

        return [
            'snapshot' => null,
            'error' => $lastError,
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

    private function extractRetryAfterSeconds(array $responseHeaders): ?int
    {
        $value = $responseHeaders['retry-after'] ?? null;
        if (!is_string($value) || trim($value) === '') {
            return null;
        }

        $trimmed = trim($value);
        if (ctype_digit($trimmed)) {
            $seconds = (int) $trimmed;
            return $seconds > 0 ? $seconds : null;
        }

        $timestamp = strtotime($trimmed);
        if ($timestamp === false) {
            return null;
        }

        $seconds = $timestamp - time();
        return $seconds > 0 ? $seconds : null;
    }

    private function fetchListingsResult(
        string $marketHashName,
        array $queryParams,
        string $reason,
        array $context = []
    ): array {
        $url = $this->buildListingsUrl($marketHashName, $queryParams);
        $apiKey = getenv('CSFLOAT_API_KEY') ?: $_ENV['CSFLOAT_API_KEY'] ?? null;
        $start = microtime(true);
        $responseHeaders = [];

        Logger::event(
            'info',
            'external',
            'external.csfloat.request',
            'CSFloat request started',
            array_merge([
                'provider' => 'csfloat',
                'itemName' => $marketHashName,
                'url' => $url,
                'reason' => $reason,
            ], $context)
        );

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);
        curl_setopt($ch, CURLOPT_USERAGENT, 'CsPortfolioTracking/1.0');
        curl_setopt(
            $ch,
            CURLOPT_HEADERFUNCTION,
            static function ($curl, string $headerLine) use (&$responseHeaders): int {
                $line = trim($headerLine);
                if ($line === '' || !str_contains($line, ':')) {
                    return strlen($headerLine);
                }

                [$name, $value] = explode(':', $line, 2);
                $responseHeaders[strtolower(trim($name))] = trim($value);
                return strlen($headerLine);
            }
        );

        $headers = ['Accept: application/json'];
        if ($apiKey !== null && $apiKey !== '') {
            $headers[] = "Authorization: {$apiKey}";
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
                    'provider' => 'csfloat',
                    'itemName' => $marketHashName,
                    'statusCode' => $httpCode > 0 ? $httpCode : null,
                    'durationMs' => $durationMs,
                    'errorCode' => 'CSFLOAT_REQUEST_FAILED',
                    'curlError' => $curlError,
                    'reason' => $reason,
                ]
            );
            Logger::event(
                'error',
                'external',
                'external.csfloat.response',
                'CSFloat request failed',
                array_merge([
                    'provider' => 'csfloat',
                    'itemName' => $marketHashName,
                    'httpCode' => $httpCode > 0 ? $httpCode : null,
                    'durationMs' => $durationMs,
                    'success' => false,
                    'errorCode' => 'CSFLOAT_REQUEST_FAILED',
                    'reason' => $reason,
                ], $context)
            );
            return [
                'listings' => [],
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
            $retryAfterSeconds = $this->extractRetryAfterSeconds($responseHeaders);
            if ($retryAfterSeconds !== null) {
                $httpError['retryAfterSeconds'] = $retryAfterSeconds;
            }
            Logger::event(
                'warning',
                'external',
                'external.csfloat.response',
                'CSFloat HTTP error response',
                array_merge([
                    'provider' => 'csfloat',
                    'itemName' => $marketHashName,
                    'httpCode' => $httpCode,
                    'durationMs' => $durationMs,
                    'success' => false,
                    'errorCode' => $httpError['code'] ?? 'CSFLOAT_HTTP_ERROR',
                    'retryAfterSeconds' => $retryAfterSeconds,
                    'reason' => $reason,
                ], $context)
            );
            return [
                'listings' => [],
                'error' => $httpError,
            ];
        }

        if ($response === '') {
            Logger::event(
                'warning',
                'external',
                'external.csfloat.response',
                'CSFloat empty response',
                array_merge([
                    'provider' => 'csfloat',
                    'itemName' => $marketHashName,
                    'httpCode' => 200,
                    'durationMs' => $durationMs,
                    'success' => false,
                    'errorCode' => 'CSFLOAT_EMPTY_RESPONSE',
                    'reason' => $reason,
                ], $context)
            );
            return [
                'listings' => [],
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
                'error',
                'error.json_decode',
                'CSFloat JSON decode failed',
                array_merge([
                    'provider' => 'csfloat',
                    'itemName' => $marketHashName,
                    'statusCode' => 200,
                    'durationMs' => $durationMs,
                    'errorCode' => 'CSFLOAT_INVALID_RESPONSE',
                    'reason' => $reason,
                ], $context)
            );
            Logger::event(
                'error',
                'external',
                'external.csfloat.response',
                'CSFloat invalid JSON response',
                array_merge([
                    'provider' => 'csfloat',
                    'itemName' => $marketHashName,
                    'httpCode' => 200,
                    'durationMs' => $durationMs,
                    'success' => false,
                    'errorCode' => 'CSFLOAT_INVALID_RESPONSE',
                    'reason' => $reason,
                ], $context)
            );
            return [
                'listings' => [],
                'error' => [
                    'source' => 'csfloat',
                    'statusCode' => 200,
                    'code' => 'CSFLOAT_INVALID_RESPONSE',
                    'label' => 'Invalid Response',
                    'message' => 'CSFloat hat eine ungueltige Antwort geliefert.',
                ],
            ];
        }

        $listings = $this->extractListings($json);

        Logger::event(
            'info',
            'external',
            'external.csfloat.response',
            $listings === [] ? 'CSFloat response without listing' : 'CSFloat response received',
            array_merge([
                'provider' => 'csfloat',
                'itemName' => $marketHashName,
                'httpCode' => 200,
                'durationMs' => $durationMs,
                'success' => true,
                'reason' => $reason,
                'listingsCount' => count($listings),
            ], $context)
        );

        return [
            'listings' => $listings,
            'error' => null,
        ];
    }

    private function buildListingsUrl(string $marketHashName, array $queryParams): string
    {
        $params = [
            'market_hash_name' => $marketHashName,
        ];

        foreach ($queryParams as $key => $value) {
            if ($value === null) {
                continue;
            }

            $stringValue = trim((string) $value);
            if ($stringValue === '') {
                continue;
            }

            $params[(string) $key] = $stringValue;
        }

        return self::BASE_LISTINGS_URL . '?' . http_build_query($params);
    }

    private function extractListings(array $json): array
    {
        if (isset($json[0]) && is_array($json[0])) {
            return array_values(array_filter(
                $json,
                static fn (mixed $row): bool => is_array($row) && isset($row['price'])
            ));
        }

        if (isset($json['data']) && is_array($json['data'])) {
            return array_values(array_filter(
                $json['data'],
                static fn (mixed $row): bool => is_array($row) && isset($row['price'])
            ));
        }

        return [];
    }

    private function buildComparableSnapshot(string $marketHashName, array $listings, array $meta): array
    {
        $prices = [];
        foreach ($listings as $listing) {
            if (!is_array($listing) || !isset($listing['price']) || !is_numeric($listing['price'])) {
                continue;
            }
            $prices[] = (int) $listing['price'];
        }
        sort($prices, SORT_NUMERIC);

        $selectedPriceCents = null;
        if ($prices !== []) {
            $index = (int) floor((count($prices) - 1) * 0.5);
            $selectedPriceCents = $prices[$index] ?? null;
        }

        $fallbackListing = is_array($listings[0] ?? null) ? $listings[0] : [];
        $selectedListing = $fallbackListing;
        if ($selectedPriceCents !== null) {
            foreach ($listings as $listing) {
                if (!is_array($listing) || !isset($listing['price']) || !is_numeric($listing['price'])) {
                    continue;
                }
                if ((int) $listing['price'] === $selectedPriceCents) {
                    $selectedListing = $listing;
                    break;
                }
            }
        }

        $snapshot = $this->mapListingSnapshot($selectedListing, $marketHashName);
        $snapshot['strategy'] = (string) ($meta['strategy'] ?? 'market_lowest');
        $snapshot['confidence'] = (string) ($meta['confidence'] ?? 'low');
        $snapshot['sampleSize'] = count($prices);

        return $snapshot;
    }

    private function mapListingSnapshot(array $listing, string $marketHashName): array
    {
        $item = is_array($listing['item'] ?? null) ? $listing['item'] : [];
        $iconPath = (string) ($item['icon_url'] ?? '');
        $priceCents = (float) ($listing['price'] ?? 0.0);

        // Name actually carried by the listing payload (no requested-name fallback):
        // this is what snapshotMatchesRequestedName verifies. A listing without any
        // name is unverifiable and must not be trusted for pricing.
        $listedName = trim((string) ($item['market_hash_name'] ?? $item['name'] ?? ''));

        return [
            'priceUsd' => round($priceCents / 100.0, 2),
            'listedMarketHashName' => $listedName !== '' ? $listedName : null,
            'marketHashName' => (string) ($item['market_hash_name'] ?? $marketHashName),
            'itemType' => isset($item['type']) ? (string) $item['type'] : null,
            'itemTypeLabel' => isset($item['type_name']) ? (string) $item['type_name'] : null,
            'wearName' => isset($item['wear_name']) ? (string) $item['wear_name'] : null,
            'iconUrl' => $iconPath !== ''
                ? sprintf('https://community.akamai.steamstatic.com/economy/image/%s/96fx96f', $iconPath)
                : null,
            'floatValue' => $this->normalizeFloat($item['float_value'] ?? null),
            'paintSeed' => $this->normalizePaintSeed($item['paint_seed'] ?? null),
            'inspectLink' => isset($item['inspect_link']) ? (string) $item['inspect_link'] : null,
        ];
    }

    private function normalizeFloat(mixed $value): ?float
    {
        if (!is_numeric($value)) {
            return null;
        }

        $parsed = (float) $value;
        if ($parsed < 0.0 || $parsed > 1.0) {
            return null;
        }

        return $parsed;
    }

    private function normalizePaintSeed(mixed $value): ?int
    {
        if (!is_numeric($value)) {
            return null;
        }

        $parsed = (int) $value;
        if ($parsed < 0) {
            return null;
        }

        return $parsed;
    }

    private function formatFloat(float $value): string
    {
        return number_format($value, 6, '.', '');
    }

    private function formatBand(float $value): string
    {
        return str_replace('.', '', number_format($value, 4, '.', ''));
    }
}
