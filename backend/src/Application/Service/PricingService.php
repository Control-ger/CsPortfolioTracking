<?php
declare(strict_types=1);

namespace App\Application\Service;

use App\Application\Support\MarketItemClassifier;
use App\Infrastructure\External\CsFloatClient;
use App\Infrastructure\External\ExchangeRateClient;
use App\Infrastructure\External\SteamMarketClient;
use App\Infrastructure\Persistence\Repository\ExchangeRateRepository;
use App\Infrastructure\Persistence\Repository\ItemRepository;
use App\Infrastructure\Persistence\Repository\ItemLiveCacheRepository;
use App\Infrastructure\Persistence\Repository\UserPriceSourcePreferenceRepository;
use App\Shared\Dto\WatchlistSearchCandidateDto;
use App\Shared\Logger;

final class PricingService
{
    private const LIVE_CACHE_TTL_SECONDS = 3600;
    private const CATALOG_CACHE_TTL_SECONDS = 86400;
    private const PRICE_SOURCE_CSFLOAT = 'csfloat';
    private const PRICE_SOURCE_STEAM = 'steam';
    private const PRICE_MODE_AUTO = 'auto';
    private const PRICE_SCOPE_ITEM = 'item';
    private const PRICE_SCOPE_INSTANCE = 'instance';
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
    private array $priceSourcePreferenceCache = [];

    public function __construct(
        private readonly CsFloatClient $csFloatClient,
        private readonly ExchangeRateClient $exchangeRateClient,
        private readonly SteamMarketClient $steamMarketClient,
        private readonly MarketItemClassifier $marketItemClassifier,
        private readonly ItemRepository $itemRepository,
        private readonly ExchangeRateRepository $exchangeRateRepository,
        private readonly ItemLiveCacheRepository $itemLiveCacheRepository,
        private readonly UserPriceSourcePreferenceRepository $userPriceSourcePreferenceRepository
    ) {
    }

    public function getLivePriceEur(string $itemName, int $userId = 1, ?array $instanceHint = null): ?float
    {
        $snapshot = $this->getLivePriceSnapshot($itemName, $userId, $instanceHint);
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

    public function getLivePriceSnapshot(string $itemName, int $userId = 1, ?array $instanceHint = null): ?array
    {
        $presentation = $this->getItemPresentation($itemName, null, $userId, $instanceHint);
        if (!isset($presentation['priceUsd'], $presentation['priceEur'], $presentation['exchangeRate'])) {
            return null;
        }

        return [
            'priceUsd' => (float) $presentation['priceUsd'],
            'priceEur' => (float) $presentation['priceEur'],
            'exchangeRate' => (float) $presentation['exchangeRate'],
            'exchangeRateId' => isset($presentation['exchangeRateId']) ? (int) $presentation['exchangeRateId'] : null,
            'priceSource' => $presentation['priceSource'] ?? null,
            'itemId' => isset($presentation['itemId']) ? (int) $presentation['itemId'] : null,
            'itemType' => $presentation['itemType'] ?? null,
            'itemTypeLabel' => $presentation['itemTypeLabel'] ?? null,
            'wearName' => $presentation['wearLabel'] ?? null,
            'iconUrl' => $presentation['iconUrl'] ?? null,
            'priceScope' => $presentation['priceScope'] ?? self::PRICE_SCOPE_ITEM,
            'priceStrategy' => $presentation['priceStrategy'] ?? null,
            'priceConfidence' => $presentation['priceConfidence'] ?? null,
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

    public function getItemPresentation(
        string $itemName,
        ?array $steamHint = null,
        int $userId = 1,
        ?array $instanceHint = null
    ): array
    {
        $this->ensureCacheTables();
        $priceMode = $this->resolvePriceModeForUser($userId);

        $catalog = $this->getCatalogEntry($itemName, $steamHint);
        $resolvedInstanceHint = $this->normalizeInstanceHint($instanceHint);
        $itemId = isset($catalog['itemId']) ? (int) $catalog['itemId'] : 0;
        $cachedBySource = $itemId > 0
            ? $this->indexLiveCacheRowsBySource(
                $this->normalizeLiveCacheRows($this->itemLiveCacheRepository->findAllByItemId($itemId))
            )
            : [];
        $cachedLive = $this->selectLiveCacheForMode($cachedBySource, $priceMode);
        $instancePricingEligible = $this->isInstancePricingEligible($resolvedInstanceHint, $catalog);

        if (!$instancePricingEligible && $this->isFreshLiveCache($cachedLive)) {
            Logger::event(
                'info',
                'external',
                'external.pricing.cache_hit',
                'Pricing cache hit',
                [
                    'provider' => (string) ($cachedLive['priceSource'] ?? self::PRICE_SOURCE_CSFLOAT),
                    'cacheHit' => true,
                    'itemName' => $itemName,
                    'priceMode' => $priceMode,
                ]
            );
            return $this->buildPresentation($catalog, $cachedLive, $priceMode);
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
                'priceMode' => $priceMode,
            ]
        );

        $csFloatUpdated = false;
        $instanceLive = null;
        if ($this->csFloatCircuitBreakerWarning === null) {
            $this->csFloatCircuitBreakerWarning = $this->loadActiveCsFloatBackoff();
        }

        $listing = null;
        $shouldFetchCsFloatPrice = $instancePricingEligible
            ? true
            : $this->shouldFetchCsFloatPrice($priceMode, $cachedBySource);
        if ($shouldFetchCsFloatPrice && $this->csFloatCircuitBreakerWarning === null) {
            $listingResult = $instancePricingEligible
                ? $this->csFloatClient->fetchComparableListingResult(
                    $itemName,
                    $resolvedInstanceHint['floatValue'] ?? null,
                    $resolvedInstanceHint['paintSeed'] ?? null
                )
                : $this->csFloatClient->fetchLowestListingResult($itemName);
            $csFloatError = is_array($listingResult['error'] ?? null) ? $listingResult['error'] : null;
            if ($csFloatError !== null) {
                $this->registerWarning($csFloatError, $itemName);
                if ($this->shouldTripCsFloatCircuitBreaker($csFloatError)) {
                    $this->csFloatCircuitBreakerWarning = $csFloatError;
                    $this->activateCsFloatBackoff($csFloatError);
                }
            }

            $listing = is_array($listingResult['snapshot'] ?? null) ? $listingResult['snapshot'] : null;
        } elseif ($this->csFloatCircuitBreakerWarning !== null) {
            $this->registerWarning($this->csFloatCircuitBreakerWarning, $itemName);
        }

        if ($listing !== null) {
            $catalog = $this->persistCatalogEntry($itemName, $catalog, $steamHint, $listing);
            if ($instancePricingEligible) {
                $instanceLive = $this->buildTransientLiveCacheEntry(
                    $itemId,
                    (float) $listing['priceUsd'],
                    self::PRICE_SOURCE_CSFLOAT,
                    [
                        'priceScope' => self::PRICE_SCOPE_INSTANCE,
                        'priceStrategy' => isset($listing['strategy']) ? (string) $listing['strategy'] : 'market_lowest',
                        'priceConfidence' => isset($listing['confidence']) ? (string) $listing['confidence'] : null,
                        'sampleSize' => isset($listing['sampleSize']) ? (int) $listing['sampleSize'] : null,
                        'floatValue' => $listing['floatValue'] ?? ($resolvedInstanceHint['floatValue'] ?? null),
                        'paintSeed' => $listing['paintSeed'] ?? ($resolvedInstanceHint['paintSeed'] ?? null),
                        'inspectLink' => $listing['inspectLink'] ?? ($resolvedInstanceHint['inspectLink'] ?? null),
                    ]
                );
            } else {
                $liveCache = $this->persistLiveCacheEntry($itemId, (float) $listing['priceUsd'], self::PRICE_SOURCE_CSFLOAT);
                $cachedBySource[self::PRICE_SOURCE_CSFLOAT] = $liveCache;
                $csFloatUpdated = true;
            }
        }

        $selectedLive = $instanceLive ?? $this->selectLiveCacheForMode($cachedBySource, $priceMode);
        if ($instancePricingEligible && $selectedLive === null && is_array($cachedLive)) {
            $selectedLive = $cachedLive;
        }
        $presentation = $this->buildPresentation($catalog, $selectedLive, $priceMode);
        if ($instancePricingEligible) {
            $presentation['priceScope'] = $selectedLive['priceScope'] ?? self::PRICE_SCOPE_ITEM;
            $presentation['priceStrategy'] = $selectedLive['priceStrategy'] ?? null;
            $presentation['priceConfidence'] = $selectedLive['priceConfidence'] ?? null;
            $presentation['sampleSize'] = $selectedLive['sampleSize'] ?? null;
        }

        return $presentation;
    }

    public function searchWatchlistCandidates(
        string $query,
        int $limit = 6,
        ?string $itemTypeFilter = null,
        ?string $wearFilter = null,
        int $page = 1,
        ?string $sortBy = null,
        int $userId = 1
    ): array {
        $this->ensureCacheTables();

        $normalizedQuery = trim($query);
        $resolvedLimit = max(1, min($limit, 12));
        $normalizedSortBy = $this->normalizeSortBy($sortBy);
        $browseMode = $normalizedQuery === '' && $this->canBrowseByFilter($itemTypeFilter);
        $resolvedQuery = $normalizedQuery !== ''
            ? $normalizedQuery
            : $this->resolveBrowseQuery($itemTypeFilter);
        $resolvedQuery = $this->normalizeSearchQuery($resolvedQuery);

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

        $matchedItems = $this->prepareSearchMatches($matchedItems, $userId);
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
                livePriceEur: isset($match['livePriceEur']) && is_numeric($match['livePriceEur'])
                    ? (float) $match['livePriceEur']
                    : null,
                livePriceUsd: isset($match['livePriceUsd']) && is_numeric($match['livePriceUsd'])
                    ? (float) $match['livePriceUsd']
                    : null
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

        // item_live_cache has a FK to exchange_rates; ensure parent table first.
        $this->exchangeRateRepository->ensureTable();
        $this->itemRepository->ensureTable();
        $this->itemLiveCacheRepository->ensureTable();
        $this->userPriceSourcePreferenceRepository->ensureTable();
        $this->cacheTablesReady = true;
    }

    private function getCatalogEntry(string $itemName, ?array $steamHint = null, ?array $listingHint = null): ?array
    {
        $this->ensureCacheTables();

        $item = $this->itemRepository->findByMarketHashName($itemName)
            ?? $this->itemRepository->findByName($itemName);

        if ($item === null) {
            $itemId = $this->itemRepository->findOrCreateByName($itemName, 'other');
            $item = $this->itemRepository->findById($itemId);
        }

        $catalog = $this->normalizeCatalogRow($item);
        if ($catalog !== null && $this->hasUsefulCatalogData($catalog) && $this->isFreshCatalogCache($catalog)) {
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
            $this->itemRepository->findByMarketHashName($itemName) ?? $this->itemRepository->findByName($itemName)
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

        $itemId = isset($resolvedExisting['itemId']) ? (int) $resolvedExisting['itemId'] : $this->itemRepository->findOrCreateByName($itemName, (string) ($classification['key'] ?? 'other'));

        $catalog = [
            'itemId' => $itemId,
            'marketHashName' => $itemName,
            'cachedAt' => date('Y-m-d H:i:s'),
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

        $this->itemRepository->updateCatalogData($itemId, [
            'image_url' => $catalog['imageUrl'],
            'item_type' => $catalog['itemType'],
            'item_type_label' => $catalog['itemTypeLabel'],
            'market_type_label' => $catalog['marketTypeLabel'],
            'wear_key' => $catalog['wear'],
            'wear_label' => $catalog['wearLabel'],
            'catalog_cached_at' => $catalog['cachedAt'],
        ]);

        return $catalog;
    }

    private function persistLiveCacheEntry(int $itemId, float $priceUsd, string $priceSource): array
    {
        $exchangeRate = $this->getUsdToEurRate();
        $exchangeRateId = $this->exchangeRateRepository->ensureTodayRate($exchangeRate);
        $priceEur = round($priceUsd * $exchangeRate, 2);
        $fetchedAt = date('Y-m-d H:i:s');

        $this->itemLiveCacheRepository->upsert(
            $itemId,
            round($priceUsd, 2),
            $exchangeRateId,
            $priceSource,
            $fetchedAt
        );

        return [
            'itemId' => $itemId,
            'priceUsd' => round($priceUsd, 2),
            'priceEur' => $priceEur,
            'exchangeRate' => $exchangeRate,
            'exchangeRateId' => $exchangeRateId,
            'priceSource' => $priceSource,
            'fetchedAt' => $fetchedAt,
        ];
    }

    private function buildTransientLiveCacheEntry(
        int $itemId,
        float $priceUsd,
        string $priceSource,
        array $meta = []
    ): array {
        $exchangeRate = $this->getUsdToEurRate();
        $exchangeRateId = $this->exchangeRateRepository->ensureTodayRate($exchangeRate);

        return [
            'itemId' => $itemId,
            'priceUsd' => round($priceUsd, 2),
            'priceEur' => round($priceUsd * $exchangeRate, 2),
            'exchangeRate' => $exchangeRate,
            'exchangeRateId' => $exchangeRateId,
            'priceSource' => $priceSource,
            'fetchedAt' => date('Y-m-d H:i:s'),
            'priceScope' => $meta['priceScope'] ?? self::PRICE_SCOPE_ITEM,
            'priceStrategy' => $meta['priceStrategy'] ?? null,
            'priceConfidence' => $meta['priceConfidence'] ?? null,
            'sampleSize' => $meta['sampleSize'] ?? null,
            'floatValue' => $meta['floatValue'] ?? null,
            'paintSeed' => $meta['paintSeed'] ?? null,
            'inspectLink' => $meta['inspectLink'] ?? null,
        ];
    }

    private function buildPresentation(?array $catalog, ?array $liveCache, string $priceMode): array
    {
        return [
            'itemId' => $catalog['itemId'] ?? null,
            'marketHashName' => $catalog['marketHashName'] ?? null,
            'priceUsd' => $liveCache['priceUsd'] ?? null,
            'priceEur' => $liveCache['priceEur'] ?? null,
            'exchangeRate' => $liveCache['exchangeRate'] ?? null,
            'exchangeRateId' => $liveCache['exchangeRateId'] ?? null,
            'priceSource' => $liveCache['priceSource'] ?? null,
            'itemType' => $catalog['itemType'] ?? null,
            'itemTypeLabel' => $catalog['itemTypeLabel'] ?? null,
            'marketTypeLabel' => $catalog['marketTypeLabel'] ?? null,
            'wear' => $catalog['wear'] ?? null,
            'wearLabel' => $catalog['wearLabel'] ?? null,
            'iconUrl' => $catalog['imageUrl'] ?? null,
            'fetchedAt' => $liveCache['fetchedAt'] ?? null,
            'priceMode' => $priceMode,
            'priceSourceFallbackUsed' => false,
            'priceScope' => $liveCache['priceScope'] ?? self::PRICE_SCOPE_ITEM,
            'priceStrategy' => $liveCache['priceStrategy'] ?? null,
            'priceConfidence' => $liveCache['priceConfidence'] ?? null,
            'sampleSize' => $liveCache['sampleSize'] ?? null,
        ];
    }

    private function normalizeInstanceHint(?array $instanceHint): ?array
    {
        if (!is_array($instanceHint)) {
            return null;
        }

        $floatValue = $this->normalizeFloatValue($instanceHint['floatValue'] ?? $instanceHint['float'] ?? $instanceHint['wearFloat'] ?? null);
        $paintSeed = $this->normalizePaintSeed($instanceHint['paintSeed'] ?? $instanceHint['patternSeed'] ?? null);
        $inspectLink = isset($instanceHint['inspectLink']) ? trim((string) $instanceHint['inspectLink']) : '';

        if ($floatValue === null && $paintSeed === null && $inspectLink === '') {
            return null;
        }

        return [
            'floatValue' => $floatValue,
            'paintSeed' => $paintSeed,
            'inspectLink' => $inspectLink !== '' ? $inspectLink : null,
        ];
    }

    private function isInstancePricingEligible(?array $instanceHint, ?array $catalog): bool
    {
        if ($instanceHint === null) {
            return false;
        }
        $hasValuationHint = isset($instanceHint['floatValue']) || isset($instanceHint['paintSeed']);
        if (!$hasValuationHint) {
            return false;
        }

        $itemType = strtolower(trim((string) ($catalog['itemType'] ?? '')));
        return in_array($itemType, ['skin', 'weapon_skin', 'glove', 'knife'], true);
    }

    private function normalizeFloatValue(mixed $value): ?float
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

    private function normalizeCatalogRow(?array $row): ?array
    {
        if ($row === null) {
            return null;
        }

        return [
            'itemId' => isset($row['id']) ? (int) $row['id'] : null,
            'marketHashName' => (string) ($row['market_hash_name'] ?? $row['name'] ?? ''),
            'imageUrl' => isset($row['image_url']) ? (string) $row['image_url'] : null,
            'itemType' => isset($row['item_type']) ? (string) $row['item_type'] : (isset($row['type']) ? (string) $row['type'] : null),
            'itemTypeLabel' => isset($row['item_type_label']) ? (string) $row['item_type_label'] : null,
            'marketTypeLabel' => isset($row['market_type_label']) ? (string) $row['market_type_label'] : null,
            'wear' => isset($row['wear_key']) ? (string) $row['wear_key'] : null,
            'wearLabel' => isset($row['wear_label']) ? (string) $row['wear_label'] : null,
            'cachedAt' => isset($row['catalog_cached_at']) ? (string) $row['catalog_cached_at'] : (isset($row['updated_at']) ? (string) $row['updated_at'] : null),
        ];
    }

    private function normalizeLiveCacheRow(?array $row): ?array
    {
        if ($row === null) {
            return null;
        }

        $priceSource = isset($row['price_source']) ? strtolower(trim((string) $row['price_source'])) : '';
        if ($priceSource === '') {
            $priceSource = self::PRICE_SOURCE_CSFLOAT;
        }

        return [
            'itemId' => isset($row['item_id']) ? (int) $row['item_id'] : null,
            'priceUsd' => isset($row['price_usd']) ? (float) $row['price_usd'] : null,
            'priceEur' => isset($row['price_usd'], $row['usd_to_eur']) ? ((float) $row['price_usd']) * ((float) $row['usd_to_eur']) : null,
            'exchangeRate' => isset($row['usd_to_eur']) ? (float) $row['usd_to_eur'] : null,
            'exchangeRateId' => isset($row['exchange_rate_id']) ? (int) $row['exchange_rate_id'] : null,
            'priceSource' => $priceSource,
            'fetchedAt' => isset($row['fetched_at']) ? (string) $row['fetched_at'] : null,
        ];
    }

    private function normalizeLiveCacheRows(array $rows): array
    {
        $normalized = [];
        foreach ($rows as $row) {
            if (!is_array($row)) {
                continue;
            }
            $normalizedRow = $this->normalizeLiveCacheRow($row);
            if ($normalizedRow === null) {
                continue;
            }
            $normalized[] = $normalizedRow;
        }

        return $normalized;
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
            !isset($liveCache['fetchedAt'])
        ) {
            return false;
        }

        $fetchedAt = strtotime((string) $liveCache['fetchedAt']);
        if ($fetchedAt === false) {
            return false;
        }

        return (time() - $fetchedAt) < self::LIVE_CACHE_TTL_SECONDS;
    }

    private function isFreshCatalogCache(?array $catalog): bool
    {
        if (
            $catalog === null ||
            !isset($catalog['cachedAt'])
        ) {
            return false;
        }

        $cachedAt = strtotime((string) $catalog['cachedAt']);
        if ($cachedAt === false) {
            return false;
        }

        return (time() - $cachedAt) < self::CATALOG_CACHE_TTL_SECONDS;
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
        return rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'csportfolio_csfloat_backoff.json';
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

    private function normalizeSearchQuery(string $query): string
    {
        $normalized = trim(preg_replace('/\s+/', ' ', $query) ?? '');
        if ($normalized === '') {
            return '';
        }

        $lower = mb_strtolower($normalized, 'UTF-8');

        return match ($lower) {
            'cases' => 'case',
            'stickers' => 'sticker',
            'capsules' => 'capsule',
            'music kits' => 'music kit',
            'souvenir packages' => 'souvenir package',
            'handschuhe', 'handschuh', 'gloves' => 'glove',
            default => $normalized,
        };
    }

    private function prepareSearchMatches(array $matchedItems, int $userId): array
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
                    is_array($match['steamHint'] ?? null) ? $match['steamHint'] : null,
                    $userId
                );
                $presentationCache[$marketHashName] = $presentation;
            }

            $priceEur = isset($presentation['priceEur']) ? (float) $presentation['priceEur'] : null;
            $priceUsd = isset($presentation['priceUsd']) ? (float) $presentation['priceUsd'] : null;
            $priceSource = isset($presentation['priceSource']) ? (string) $presentation['priceSource'] : null;

            if ($priceEur !== null) {
                $match['sortPriceEur'] = $priceEur;
            }
            $match['displayName'] = (string) ($match['displayName'] ?? $marketHashName);
            $match['itemType'] = (string) ($presentation['itemType'] ?? $match['itemType'] ?? 'other');
            $match['itemTypeLabel'] = (string) ($presentation['itemTypeLabel'] ?? $match['itemTypeLabel'] ?? 'Other');
            $match['marketTypeLabel'] = (string) ($presentation['marketTypeLabel'] ?? $match['marketTypeLabel'] ?? 'CS2 Item');
            $match['wear'] = isset($presentation['wear']) ? (string) $presentation['wear'] : ($match['wear'] ?? null);
            $match['wearLabel'] = isset($presentation['wearLabel']) ? (string) $presentation['wearLabel'] : ($match['wearLabel'] ?? null);
            $match['iconUrl'] = isset($presentation['iconUrl']) ? (string) $presentation['iconUrl'] : ($match['iconUrl'] ?? null);
            $match['priceSource'] = $priceSource;
            $match['livePriceEur'] = $priceEur;
            $match['livePriceUsd'] = $priceUsd;
            $preparedMatches[] = $match;
        }

        return $preparedMatches;
    }

    /**
     * @param array<int, array<string, mixed>> $rows
     * @return array<string, array<string, mixed>>
     */
    private function indexLiveCacheRowsBySource(array $rows): array
    {
        $map = [];
        foreach ($rows as $row) {
            $source = strtolower(trim((string) ($row['priceSource'] ?? '')));
            if ($source !== self::PRICE_SOURCE_CSFLOAT) {
                continue;
            }

            if (!isset($map[$source])) {
                $map[$source] = $row;
                continue;
            }

            $existingFetchedAt = strtotime((string) ($map[$source]['fetchedAt'] ?? ''));
            $candidateFetchedAt = strtotime((string) ($row['fetchedAt'] ?? ''));
            if ($candidateFetchedAt !== false && ($existingFetchedAt === false || $candidateFetchedAt > $existingFetchedAt)) {
                $map[$source] = $row;
            }
        }

        return $map;
    }

    private function selectLiveCacheForMode(array $cachedBySource, string $priceMode): ?array
    {
        $orderedSources = $this->resolveSourceOrderForMode($priceMode);

        foreach ($orderedSources as $source) {
            $candidate = $cachedBySource[$source] ?? null;
            if ($this->isFreshLiveCache($candidate)) {
                return $candidate;
            }
        }

        foreach ($orderedSources as $source) {
            $candidate = $cachedBySource[$source] ?? null;
            if (is_array($candidate)) {
                return $candidate;
            }
        }

        $fallbackRows = [];
        foreach ($orderedSources as $source) {
            $candidate = $cachedBySource[$source] ?? null;
            if (is_array($candidate)) {
                $fallbackRows[] = $candidate;
            }
        }
        if ($fallbackRows === []) {
            return null;
        }

        usort(
            $fallbackRows,
            static function (array $left, array $right): int {
                $leftTs = strtotime((string) ($left['fetchedAt'] ?? ''));
                $rightTs = strtotime((string) ($right['fetchedAt'] ?? ''));
                if ($leftTs === $rightTs) {
                    return 0;
                }
                if ($leftTs === false) {
                    return 1;
                }
                if ($rightTs === false) {
                    return -1;
                }

                return $rightTs <=> $leftTs;
            }
        );

        return $fallbackRows[0] ?? null;
    }

    private function resolveSourceOrderForMode(string $priceMode): array
    {
        // Steam fallback is globally disabled: all modes resolve to CSFloat only.
        return [self::PRICE_SOURCE_CSFLOAT];
    }

    private function shouldFetchCsFloatPrice(string $priceMode, array $cachedBySource): bool
    {
        $existing = $cachedBySource[self::PRICE_SOURCE_CSFLOAT] ?? null;
        return !$this->isFreshLiveCache($existing);
    }

    private function shouldFetchSteamPrice(string $priceMode, array $cachedBySource, bool $csFloatUpdated): bool
    {
        return false;
    }

    private function resolvePriceModeForUser(int $userId): string
    {
        if ($userId <= 0) {
            return self::PRICE_SOURCE_CSFLOAT;
        }

        if (isset($this->priceSourcePreferenceCache[$userId])) {
            return $this->priceSourcePreferenceCache[$userId];
        }

        $preference = $this->userPriceSourcePreferenceRepository->getByUserId($userId);
        $mode = $this->normalizePriceMode($preference['mode'] ?? null);
        $this->priceSourcePreferenceCache[$userId] = $mode;

        return $mode;
    }

    public function getPriceModePreference(int $userId): array
    {
        $this->ensureCacheTables();
        $preference = $this->userPriceSourcePreferenceRepository->getByUserId($userId);
        $mode = $this->normalizePriceMode($preference['mode'] ?? null);
        $this->priceSourcePreferenceCache[$userId] = $mode;

        return [
            'userId' => $userId,
            'mode' => $mode,
            'updatedAt' => $preference['updatedAt'] ?? null,
            'source' => $preference['source'] ?? 'defaults',
        ];
    }

    public function updatePriceModePreference(int $userId, string $mode): array
    {
        $this->ensureCacheTables();
        $normalizedMode = $this->normalizePriceMode($mode);
        $saved = $this->userPriceSourcePreferenceRepository->upsertByUserId($userId, $normalizedMode);
        $resolvedMode = $this->normalizePriceMode($saved['mode'] ?? null);
        $this->priceSourcePreferenceCache[$userId] = $resolvedMode;

        return [
            'userId' => $userId,
            'mode' => $resolvedMode,
            'updatedAt' => $saved['updatedAt'] ?? null,
            'source' => $saved['source'] ?? 'db',
        ];
    }

    private function normalizePriceMode(?string $mode): string
    {
        $normalized = strtolower(trim((string) $mode));

        return self::PRICE_SOURCE_CSFLOAT;
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
