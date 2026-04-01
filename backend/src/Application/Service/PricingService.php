<?php
declare(strict_types=1);

namespace App\Application\Service;

use App\Application\Support\MarketItemClassifier;
use App\Infrastructure\External\CsFloatClient;
use App\Infrastructure\External\ExchangeRateClient;
use App\Infrastructure\External\SteamMarketClient;
use App\Infrastructure\Persistence\Repository\ItemCatalogRepository;
use App\Infrastructure\Persistence\Repository\ItemLiveCacheRepository;
use App\Shared\Dto\WatchlistSearchCandidateDto;
use App\Shared\Logger;

final class PricingService
{
    private const LIVE_CACHE_TTL_SECONDS = 600;
    private const PRICE_SOURCE_CSFLOAT = 'csfloat';
    private const PRICE_SOURCE_STEAM = 'steam';
    private const CSFLOAT_CIRCUIT_BREAKER_STATUSES = [401, 403, 405, 406, 418, 429, 500, 503];
    private const CSFLOAT_BACKOFF_SECONDS = [
        401 => 300,
        403 => 300,
        405 => 300,
        406 => 300,
        418 => 120,
        429 => 120,
        500 => 60,
        503 => 120,
    ];

    private bool $cacheTablesReady = false;
    private ?float $exchangeRateCache = null;
    private array $warnings = [];
    private ?array $csFloatCircuitBreakerWarning = null;

    public function __construct(
        private readonly CsFloatClient $csFloatClient,
        private readonly ExchangeRateClient $exchangeRateClient,
        private readonly SteamMarketClient $steamMarketClient,
        private readonly MarketItemClassifier $marketItemClassifier,
        private readonly ItemCatalogRepository $itemCatalogRepository,
        private readonly ItemLiveCacheRepository $itemLiveCacheRepository
    ) {
    }

    public function getLivePriceEur(string $itemName): ?float
    {
        $snapshot = $this->getLivePriceSnapshot($itemName);
        return $snapshot['priceEur'] ?? null;
    }

    public function getUsdToEurRate(): float
    {
        if ($this->exchangeRateCache !== null) {
            return $this->exchangeRateCache;
        }

        $this->exchangeRateCache = $this->exchangeRateClient->usdToEur();
        return $this->exchangeRateCache;
    }

    public function getLivePriceSnapshot(string $itemName): ?array
    {
        $presentation = $this->getItemPresentation($itemName);
        if (!isset($presentation['priceUsd'], $presentation['priceEur'], $presentation['exchangeRate'])) {
            return null;
        }

        return [
            'priceUsd' => (float) $presentation['priceUsd'],
            'priceEur' => (float) $presentation['priceEur'],
            'exchangeRate' => (float) $presentation['exchangeRate'],
            'priceSource' => $presentation['priceSource'] ?? null,
            'itemType' => $presentation['itemType'] ?? null,
            'itemTypeLabel' => $presentation['itemTypeLabel'] ?? null,
            'wearName' => $presentation['wearLabel'] ?? null,
            'iconUrl' => $presentation['iconUrl'] ?? null,
        ];
    }

    public function getItemImageUrl(string $itemName): ?string
    {
        $catalog = $this->getCatalogEntry($itemName);
        return $catalog['imageUrl'] ?? null;
    }

    public function consumeWarnings(): array
    {
        $warnings = array_values($this->warnings);
        $this->warnings = [];
        return $warnings;
    }

    public function getItemPresentation(string $itemName, ?array $steamHint = null): array
    {
        $this->ensureCacheTables();

        $catalog = $this->getCatalogEntry($itemName, $steamHint);
        $cachedLive = $this->normalizeLiveCacheRow(
            $this->itemLiveCacheRepository->findByMarketHashName($itemName)
        );

        if ($this->isFreshLiveCache($cachedLive)) {
            Logger::event(
                'info',
                'external',
                'external.pricing.cache_hit',
                'Pricing cache hit',
                [
                    'provider' => (string) ($cachedLive['priceSource'] ?? self::PRICE_SOURCE_CSFLOAT),
                    'cacheHit' => true,
                    'itemName' => $itemName,
                ]
            );
            return $this->buildPresentation($catalog, $cachedLive);
        }

        Logger::event(
            'info',
            'external',
            'external.pricing.cache_miss',
            'Pricing cache miss',
            [
                'provider' => 'pricing',
                'cacheMiss' => true,
                'itemName' => $itemName,
            ]
        );

        if ($this->csFloatCircuitBreakerWarning === null) {
            $this->csFloatCircuitBreakerWarning = $this->loadActiveCsFloatBackoff();
        }

        $listing = null;
        if ($this->csFloatCircuitBreakerWarning === null) {
            $listingResult = $this->csFloatClient->fetchLowestListingResult($itemName);
            $csFloatError = is_array($listingResult['error'] ?? null) ? $listingResult['error'] : null;
            if ($csFloatError !== null) {
                $this->registerWarning($csFloatError, $itemName);
                if ($this->shouldTripCsFloatCircuitBreaker($csFloatError)) {
                    $this->csFloatCircuitBreakerWarning = $csFloatError;
                    $this->activateCsFloatBackoff($csFloatError);
                }
            }

            $listing = is_array($listingResult['snapshot'] ?? null) ? $listingResult['snapshot'] : null;
        } elseif (($cachedLive['priceSource'] ?? null) === self::PRICE_SOURCE_STEAM) {
            $this->registerWarning($this->csFloatCircuitBreakerWarning, $itemName);
            return $this->buildPresentation($catalog, $cachedLive);
        } else {
            $this->registerWarning($this->csFloatCircuitBreakerWarning, $itemName);
        }

        if ($listing !== null) {
            $catalog = $this->persistCatalogEntry($itemName, $catalog, $steamHint, $listing);
            $liveCache = $this->persistLiveCacheEntry(
                $itemName,
                (float) $listing['priceUsd'],
                self::PRICE_SOURCE_CSFLOAT
            );

            return $this->buildPresentation($catalog, $liveCache);
        }

        $steamPriceSnapshot = $this->resolveSteamPriceSnapshot($itemName, $steamHint);
        if ($steamPriceSnapshot !== null) {
            Logger::event(
                'warning',
                'external',
                'external.pricing.fallback_to_steam',
                'Pricing fallback to Steam',
                [
                    'provider' => 'steam',
                    'fallbackUsed' => true,
                    'itemName' => $itemName,
                ]
            );
            $catalog = $this->persistCatalogEntry(
                $itemName,
                $catalog,
                $steamPriceSnapshot['steamHint'],
                null
            );
            $liveCache = $this->persistLiveCacheEntry(
                $itemName,
                $steamPriceSnapshot['priceUsd'],
                self::PRICE_SOURCE_STEAM
            );

            return $this->buildPresentation($catalog, $liveCache);
        }

        return $this->buildPresentation($catalog, $cachedLive);
    }

    public function searchWatchlistCandidates(
        string $query,
        int $limit = 6,
        ?string $itemTypeFilter = null,
        ?string $wearFilter = null,
        int $page = 1,
        ?string $sortBy = null
    ): array {
        $this->ensureCacheTables();

        $normalizedQuery = trim($query);
        $resolvedLimit = max(1, min($limit, 12));
        $normalizedSortBy = $this->normalizeSortBy($sortBy);
        $browseMode = $normalizedQuery === '' && $this->canBrowseByFilter($itemTypeFilter);
        $resolvedQuery = $normalizedQuery !== ''
            ? $normalizedQuery
            : $this->resolveBrowseQuery($itemTypeFilter);

        if ($resolvedQuery === '' || ($normalizedQuery === '' && !$browseMode)) {
            return [
                'items' => [],
                'page' => 1,
                'limit' => $resolvedLimit,
                'totalItems' => 0,
                'totalPages' => 0,
                'sortBy' => $normalizedSortBy,
                'browseMode' => $browseMode,
            ];
        }

        $externalStart = 0;
        $externalBatchSize = max($resolvedLimit * 4, 32);
        $matchedItems = [];
        $totalCount = null;
        $seenMarketHashNames = [];

        while (true) {
            $steamResults = $this->steamMarketClient->searchItems($resolvedQuery, $externalBatchSize, $externalStart);
            $rawItems = $steamResults['items'] ?? [];
            $totalCount = (int) ($steamResults['totalCount'] ?? 0);

            if ($rawItems === []) {
                break;
            }

            foreach ($rawItems as $result) {
                $marketHashName = (string) ($result['marketHashName'] ?? '');
                if ($marketHashName === '') {
                    continue;
                }

                if (isset($seenMarketHashNames[$marketHashName])) {
                    continue;
                }

                $seenMarketHashNames[$marketHashName] = true;

                $classification = $this->marketItemClassifier->classify(
                    $marketHashName,
                    isset($result['typeLabel']) ? (string) $result['typeLabel'] : null,
                    null,
                    isset($result['typeLabel']) ? (string) $result['typeLabel'] : null
                );
                $wear = $this->marketItemClassifier->normalizeWear(null, $marketHashName);
                $normalizedWear = $wear !== null
                    ? [
                        'key' => $wear['key'],
                        'label' => $wear['label'],
                    ]
                    : null;

                if (!$this->marketItemClassifier->matchesFilters($classification, $normalizedWear, $itemTypeFilter, $wearFilter)) {
                    continue;
                }

                $matchedItems[] = [
                    'marketHashName' => $marketHashName,
                    'displayName' => (string) ($result['displayName'] ?? $marketHashName),
                    'itemType' => (string) ($classification['key'] ?? 'other'),
                    'itemTypeLabel' => (string) ($classification['label'] ?? 'Other'),
                    'marketTypeLabel' => (string) ($result['typeLabel'] ?? $classification['label'] ?? 'CS2 Item'),
                    'wear' => $normalizedWear['key'] ?? null,
                    'wearLabel' => $normalizedWear['label'] ?? null,
                    'iconUrl' => isset($result['iconUrl']) ? (string) $result['iconUrl'] : null,
                    'steamHint' => $result,
                ];
            }

            $externalStart += count($rawItems);
            if ($totalCount !== null && $externalStart >= $totalCount) {
                break;
            }
        }

        $matchedItems = $this->prepareSearchMatches($matchedItems);
        $this->sortSearchMatches($matchedItems, $normalizedSortBy);

        $totalItems = count($matchedItems);
        $totalPages = $totalItems > 0 ? (int) ceil($totalItems / $resolvedLimit) : 0;
        $resolvedPage = $totalPages > 0 ? min(max(1, $page), $totalPages) : 1;
        $pageOffset = ($resolvedPage - 1) * $resolvedLimit;
        $pageMatches = array_slice($matchedItems, $pageOffset, $resolvedLimit);

        $candidates = [];
        foreach ($pageMatches as $match) {
            $marketHashName = (string) ($match['marketHashName'] ?? '');
            if ($marketHashName === '') {
                continue;
            }

            $dto = new WatchlistSearchCandidateDto(
                marketHashName: $marketHashName,
                displayName: (string) ($match['displayName'] ?? $marketHashName),
                itemType: (string) ($match['itemType'] ?? 'other'),
                itemTypeLabel: (string) ($match['itemTypeLabel'] ?? 'Other'),
                marketTypeLabel: (string) ($match['marketTypeLabel'] ?? 'CS2 Item'),
                wear: isset($match['wear']) ? (string) $match['wear'] : null,
                wearLabel: isset($match['wearLabel']) ? (string) $match['wearLabel'] : null,
                iconUrl: isset($match['iconUrl']) ? (string) $match['iconUrl'] : null,
                priceSource: isset($match['priceSource']) ? (string) $match['priceSource'] : null,
                livePriceEur: (float) $match['livePriceEur'],
                livePriceUsd: (float) $match['livePriceUsd']
            );

            $candidates[] = $dto->toArray();
        }

        return [
            'items' => $candidates,
            'page' => $resolvedPage,
            'limit' => $resolvedLimit,
            'totalItems' => $totalItems,
            'totalPages' => $totalPages,
            'sortBy' => $normalizedSortBy,
            'browseMode' => $browseMode,
        ];
    }

    private function ensureCacheTables(): void
    {
        if ($this->cacheTablesReady) {
            return;
        }

        $this->itemCatalogRepository->ensureTable();
        $this->itemLiveCacheRepository->ensureTable();
        $this->cacheTablesReady = true;
    }

    private function getCatalogEntry(string $itemName, ?array $steamHint = null, ?array $listingHint = null): ?array
    {
        $this->ensureCacheTables();

        $catalog = $this->normalizeCatalogRow(
            $this->itemCatalogRepository->findByMarketHashName($itemName)
        );
        if ($catalog !== null && $this->hasUsefulCatalogData($catalog)) {
            return $catalog;
        }

        $resolvedSteamHint = $steamHint;
        if ($resolvedSteamHint === null && $listingHint === null) {
            $resolvedSteamHint = $this->steamMarketClient->findExactItem($itemName);
        }

        return $this->persistCatalogEntry($itemName, $catalog, $resolvedSteamHint, $listingHint);
    }

    private function persistCatalogEntry(
        string $itemName,
        ?array $existingCatalog,
        ?array $steamHint,
        ?array $listing
    ): ?array {
        $resolvedExisting = $existingCatalog ?? $this->normalizeCatalogRow(
            $this->itemCatalogRepository->findByMarketHashName($itemName)
        );

        if ($steamHint === null && $listing === null && $resolvedExisting === null) {
            return null;
        }

        $classification = $this->marketItemClassifier->classify(
            $itemName,
            isset($steamHint['typeLabel']) ? (string) $steamHint['typeLabel'] : null,
            isset($listing['itemType']) ? (string) $listing['itemType'] : null,
            isset($listing['itemTypeLabel']) ? (string) $listing['itemTypeLabel'] : null
        );
        $wear = $this->marketItemClassifier->normalizeWear(
            isset($listing['wearName']) ? (string) $listing['wearName'] : null,
            $itemName
        );

        $catalog = [
            'marketHashName' => $itemName,
            'imageUrl' => $listing['iconUrl']
                ?? $steamHint['iconUrl']
                ?? ($resolvedExisting['imageUrl'] ?? null),
            'itemType' => $classification['key'] ?? ($resolvedExisting['itemType'] ?? null),
            'itemTypeLabel' => $classification['label'] ?? ($resolvedExisting['itemTypeLabel'] ?? null),
            'marketTypeLabel' => $steamHint['typeLabel']
                ?? $listing['itemTypeLabel']
                ?? ($resolvedExisting['marketTypeLabel'] ?? null)
                ?? ($classification['label'] ?? null),
            'wear' => $wear['key'] ?? ($resolvedExisting['wear'] ?? null),
            'wearLabel' => $wear['label'] ?? ($resolvedExisting['wearLabel'] ?? null),
        ];

        $this->itemCatalogRepository->upsert(
            $itemName,
            $catalog['imageUrl'],
            $catalog['itemType'],
            $catalog['itemTypeLabel'],
            $catalog['marketTypeLabel'],
            $catalog['wear'],
            $catalog['wearLabel']
        );

        return $catalog;
    }

    private function persistLiveCacheEntry(string $itemName, float $priceUsd, string $priceSource): array
    {
        $exchangeRate = $this->getUsdToEurRate();
        $priceEur = round($priceUsd * $exchangeRate, 2);
        $fetchedAt = date('Y-m-d H:i:s');

        $this->itemLiveCacheRepository->upsert(
            $itemName,
            round($priceUsd, 2),
            $priceEur,
            $exchangeRate,
            $priceSource,
            $fetchedAt
        );

        return [
            'marketHashName' => $itemName,
            'priceUsd' => round($priceUsd, 2),
            'priceEur' => $priceEur,
            'exchangeRate' => $exchangeRate,
            'priceSource' => $priceSource,
            'fetchedAt' => $fetchedAt,
        ];
    }

    private function buildPresentation(?array $catalog, ?array $liveCache): array
    {
        return [
            'priceUsd' => $liveCache['priceUsd'] ?? null,
            'priceEur' => $liveCache['priceEur'] ?? null,
            'exchangeRate' => $liveCache['exchangeRate'] ?? null,
            'priceSource' => $liveCache['priceSource'] ?? null,
            'itemType' => $catalog['itemType'] ?? null,
            'itemTypeLabel' => $catalog['itemTypeLabel'] ?? null,
            'marketTypeLabel' => $catalog['marketTypeLabel'] ?? null,
            'wear' => $catalog['wear'] ?? null,
            'wearLabel' => $catalog['wearLabel'] ?? null,
            'iconUrl' => $catalog['imageUrl'] ?? null,
            'fetchedAt' => $liveCache['fetchedAt'] ?? null,
        ];
    }

    private function normalizeCatalogRow(?array $row): ?array
    {
        if ($row === null) {
            return null;
        }

        return [
            'marketHashName' => (string) ($row['market_hash_name'] ?? ''),
            'imageUrl' => isset($row['image_url']) ? (string) $row['image_url'] : null,
            'itemType' => isset($row['item_type']) ? (string) $row['item_type'] : null,
            'itemTypeLabel' => isset($row['item_type_label']) ? (string) $row['item_type_label'] : null,
            'marketTypeLabel' => isset($row['market_type_label']) ? (string) $row['market_type_label'] : null,
            'wear' => isset($row['wear_key']) ? (string) $row['wear_key'] : null,
            'wearLabel' => isset($row['wear_label']) ? (string) $row['wear_label'] : null,
        ];
    }

    private function normalizeLiveCacheRow(?array $row): ?array
    {
        if ($row === null) {
            return null;
        }

        return [
            'marketHashName' => (string) ($row['market_hash_name'] ?? ''),
            'priceUsd' => isset($row['price_usd']) ? (float) $row['price_usd'] : null,
            'priceEur' => isset($row['price_eur']) ? (float) $row['price_eur'] : null,
            'exchangeRate' => isset($row['exchange_rate']) ? (float) $row['exchange_rate'] : null,
            'priceSource' => isset($row['price_source']) ? (string) $row['price_source'] : null,
            'fetchedAt' => isset($row['fetched_at']) ? (string) $row['fetched_at'] : null,
        ];
    }

    private function hasUsefulCatalogData(array $catalog): bool
    {
        return ($catalog['imageUrl'] ?? null) !== null
            && ($catalog['itemType'] ?? null) !== null
            && ($catalog['itemTypeLabel'] ?? null) !== null;
    }

    private function isFreshLiveCache(?array $liveCache): bool
    {
        if (
            $liveCache === null ||
            !isset($liveCache['fetchedAt']) ||
            ($liveCache['priceSource'] ?? null) !== self::PRICE_SOURCE_CSFLOAT
        ) {
            return false;
        }

        $fetchedAt = strtotime((string) $liveCache['fetchedAt']);
        if ($fetchedAt === false) {
            return false;
        }

        return (time() - $fetchedAt) < self::LIVE_CACHE_TTL_SECONDS;
    }

    private function registerWarning(array $warning, string $itemName): void
    {
        $warningKey = sprintf(
            '%s:%s',
            (string) ($warning['code'] ?? 'UNKNOWN_WARNING'),
            (string) ($warning['statusCode'] ?? 'na')
        );

        if (!isset($this->warnings[$warningKey])) {
            $this->warnings[$warningKey] = [
                'source' => (string) ($warning['source'] ?? 'system'),
                'code' => (string) ($warning['code'] ?? 'UNKNOWN_WARNING'),
                'statusCode' => isset($warning['statusCode']) ? (int) $warning['statusCode'] : null,
                'label' => (string) ($warning['label'] ?? 'Warning'),
                'message' => (string) ($warning['message'] ?? 'Ein externer Preisdienst hat eine Warnung geliefert.'),
                'occurrences' => 0,
                'items' => [],
            ];
        }

        $this->warnings[$warningKey]['occurrences']++;
        if (
            $itemName !== '' &&
            !in_array($itemName, $this->warnings[$warningKey]['items'], true) &&
            count($this->warnings[$warningKey]['items']) < 3
        ) {
            $this->warnings[$warningKey]['items'][] = $itemName;
        }
    }

    private function shouldTripCsFloatCircuitBreaker(array $warning): bool
    {
        $statusCode = isset($warning['statusCode']) ? (int) $warning['statusCode'] : null;
        if ($statusCode !== null && in_array($statusCode, self::CSFLOAT_CIRCUIT_BREAKER_STATUSES, true)) {
            return true;
        }

        return in_array(
            (string) ($warning['code'] ?? ''),
            ['CSFLOAT_REQUEST_FAILED', 'CSFLOAT_INVALID_RESPONSE', 'CSFLOAT_EMPTY_RESPONSE'],
            true
        );
    }

    private function loadActiveCsFloatBackoff(): ?array
    {
        $path = $this->getCsFloatBackoffPath();
        if (!is_file($path)) {
            return null;
        }

        $content = @file_get_contents($path);
        $payload = is_string($content) ? json_decode($content, true) : null;
        if (!is_array($payload)) {
            @unlink($path);
            return null;
        }

        $expiresAt = isset($payload['expiresAt']) ? (int) $payload['expiresAt'] : 0;
        if ($expiresAt <= time()) {
            @unlink($path);
            return null;
        }

        $warning = is_array($payload['warning'] ?? null) ? $payload['warning'] : null;
        return $warning;
    }

    private function activateCsFloatBackoff(array $warning): void
    {
        $statusCode = isset($warning['statusCode']) ? (int) $warning['statusCode'] : null;
        $duration = $statusCode !== null
            ? (self::CSFLOAT_BACKOFF_SECONDS[$statusCode] ?? null)
            : null;

        if ($duration === null && !in_array(
            (string) ($warning['code'] ?? ''),
            ['CSFLOAT_REQUEST_FAILED', 'CSFLOAT_INVALID_RESPONSE', 'CSFLOAT_EMPTY_RESPONSE'],
            true
        )) {
            return;
        }

        $payload = [
            'expiresAt' => time() + ($duration ?? 60),
            'warning' => $warning,
        ];

        @file_put_contents($this->getCsFloatBackoffPath(), json_encode($payload));
    }

    private function getCsFloatBackoffPath(): string
    {
        return rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'cs***REMOVED***_csfloat_backoff.json';
    }

    private function resolveSteamPriceSnapshot(string $itemName, ?array $steamHint = null): ?array
    {
        $resolvedSteamHint = $this->isExactSteamHint($itemName, $steamHint)
            ? $steamHint
            : $this->steamMarketClient->findExactItem($itemName);

        if (!$this->isExactSteamHint($itemName, $resolvedSteamHint)) {
            return null;
        }

        $priceUsd = isset($resolvedSteamHint['sellPriceUsd'])
            ? (float) $resolvedSteamHint['sellPriceUsd']
            : null;

        if ($priceUsd === null || $priceUsd <= 0) {
            return null;
        }

        return [
            'priceUsd' => round($priceUsd, 2),
            'steamHint' => $resolvedSteamHint,
        ];
    }

    private function isExactSteamHint(string $itemName, ?array $steamHint): bool
    {
        if (!is_array($steamHint)) {
            return false;
        }

        return trim((string) ($steamHint['marketHashName'] ?? '')) === trim($itemName);
    }

    private function canBrowseByFilter(?string $itemTypeFilter): bool
    {
        return $this->resolveBrowseQuery($itemTypeFilter) !== '';
    }

    private function resolveBrowseQuery(?string $itemTypeFilter): string
    {
        return match (trim((string) $itemTypeFilter)) {
            'case' => 'case',
            'souvenir_package' => 'souvenir package',
            'sticker_capsule' => 'sticker capsule',
            'sticker' => 'sticker',
            'patch' => 'patch',
            'music_kit' => 'music kit',
            'agent' => 'agent',
            'key' => 'key',
            'terminal' => 'terminal',
            'charm' => 'charm',
            'graffiti' => 'graffiti',
            'tool' => 'tool',
            'container' => '',
            'skin' => 'ak-47',
            default => '',
        };
    }

    private function normalizeSortBy(?string $sortBy): string
    {
        return match (trim((string) $sortBy)) {
            'name_asc', 'name_desc', 'price_asc', 'price_desc' => trim((string) $sortBy),
            default => 'relevance',
        };
    }

    private function prepareSearchMatches(array $matchedItems): array
    {
        $preparedMatches = [];
        $presentationCache = [];

        foreach ($matchedItems as $match) {
            $marketHashName = (string) ($match['marketHashName'] ?? '');
            if ($marketHashName === '') {
                continue;
            }

            if (isset($presentationCache[$marketHashName])) {
                $presentation = $presentationCache[$marketHashName];
            } else {
                $presentation = $this->getItemPresentation(
                    $marketHashName,
                    is_array($match['steamHint'] ?? null) ? $match['steamHint'] : null
                );
                $presentationCache[$marketHashName] = $presentation;
            }

            if (!isset($presentation['priceEur'], $presentation['priceUsd'])) {
                continue;
            }

            $match['sortPriceEur'] = (float) $presentation['priceEur'];
            $match['displayName'] = (string) ($match['displayName'] ?? $marketHashName);
            $match['itemType'] = (string) ($presentation['itemType'] ?? $match['itemType'] ?? 'other');
            $match['itemTypeLabel'] = (string) ($presentation['itemTypeLabel'] ?? $match['itemTypeLabel'] ?? 'Other');
            $match['marketTypeLabel'] = (string) ($presentation['marketTypeLabel'] ?? $match['marketTypeLabel'] ?? 'CS2 Item');
            $match['wear'] = isset($presentation['wear']) ? (string) $presentation['wear'] : ($match['wear'] ?? null);
            $match['wearLabel'] = isset($presentation['wearLabel']) ? (string) $presentation['wearLabel'] : ($match['wearLabel'] ?? null);
            $match['iconUrl'] = isset($presentation['iconUrl']) ? (string) $presentation['iconUrl'] : ($match['iconUrl'] ?? null);
            $match['priceSource'] = isset($presentation['priceSource']) ? (string) $presentation['priceSource'] : null;
            $match['livePriceEur'] = (float) $presentation['priceEur'];
            $match['livePriceUsd'] = (float) $presentation['priceUsd'];
            $preparedMatches[] = $match;
        }

        return $preparedMatches;
    }

    private function sortSearchMatches(array &$matchedItems, string $sortBy): void
    {
        if ($sortBy === 'relevance') {
            return;
        }

        usort(
            $matchedItems,
            static function (array $left, array $right) use ($sortBy): int {
                if ($sortBy === 'price_asc' || $sortBy === 'price_desc') {
                    $leftPrice = isset($left['sortPriceEur']) ? (float) $left['sortPriceEur'] : INF;
                    $rightPrice = isset($right['sortPriceEur']) ? (float) $right['sortPriceEur'] : INF;

                    if ($leftPrice !== $rightPrice) {
                        $comparison = $leftPrice <=> $rightPrice;
                        return $sortBy === 'price_desc' ? -$comparison : $comparison;
                    }
                }

                $comparison = strcasecmp(
                    (string) ($left['displayName'] ?? ''),
                    (string) ($right['displayName'] ?? '')
                );

                return in_array($sortBy, ['name_desc', 'price_desc'], true)
                    ? -$comparison
                    : $comparison;
            }
        );
    }
}
