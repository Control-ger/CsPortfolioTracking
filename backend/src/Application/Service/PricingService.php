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
    private const MAX_INTERACTIVE_CSFLOAT_LOOKUPS = 8;
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
        429 => 600,
        500 => 60,
        503 => 120,
    ];

    private bool $cacheTablesReady = false;
    private ?float $exchangeRateCache = null;
    private array $warnings = [];
    private ?array $csFloatCircuitBreakerWarning = null;
    private array $priceSourcePreferenceCache = [];
    private bool $csFloatBackoffWarningRegistered = false;
    private int $csFloatLookupCount = 0;

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
        ?array $instanceHint = null,
        bool $allowLiveRefresh = true
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
        $interactiveBudgetReached = $this->isInteractiveRuntime()
            && $this->csFloatLookupCount >= self::MAX_INTERACTIVE_CSFLOAT_LOOKUPS;
        if ($shouldFetchCsFloatPrice && $this->csFloatCircuitBreakerWarning === null && $allowLiveRefresh && !$interactiveBudgetReached) {
            $this->csFloatLookupCount++;
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
            if (!$this->csFloatBackoffWarningRegistered) {
                $this->registerWarning($this->csFloatCircuitBreakerWarning, $itemName);
                $this->csFloatBackoffWarningRegistered = true;
            }
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
        int $userId = 1,
        ?string $priceSourceOverride = null
    ): array {
        $this->ensureCacheTables();

        $searchStartedAt = microtime(true);
        $normalizedQuery = trim($query);
        $resolvedLimit = max(1, min($limit, 20));
        $normalizedSortBy = $this->normalizeSortBy($sortBy);
        $browseMode = $normalizedQuery === '' && $this->canBrowseByFilter($itemTypeFilter);
        $resolvedQuery = $normalizedQuery !== ''
            ? $normalizedQuery
            : $this->resolveBrowseQuery($itemTypeFilter);
        $resolvedQuery = $this->normalizeSearchQuery($resolvedQuery);
        $searchContextBase = [
            'rawQuery' => $this->truncateForSearchLog($normalizedQuery),
            'resolvedQuery' => $this->truncateForSearchLog($resolvedQuery),
            'queryHash' => $this->buildSearchQueryHash($resolvedQuery !== '' ? $resolvedQuery : $normalizedQuery),
            'tokenCount' => $this->countSearchTokens($resolvedQuery !== '' ? $resolvedQuery : $normalizedQuery),
            'itemTypeFilter' => trim((string) $itemTypeFilter) !== '' ? trim((string) $itemTypeFilter) : null,
            'wearFilter' => trim((string) $wearFilter) !== '' ? trim((string) $wearFilter) : null,
            'sortBy' => $normalizedSortBy,
            'page' => max(1, $page),
            'limit' => $resolvedLimit,
            'browseMode' => $browseMode,
            'userId' => $userId,
        ];

        if ($normalizedQuery === '' && !$browseMode) {
            $result = [
                'items' => [],
                'page' => 1,
                'limit' => $resolvedLimit,
                'totalItems' => 0,
                'totalPages' => 0,
                'sortBy' => $normalizedSortBy,
                'browseMode' => $browseMode,
            ];
            $this->logWatchlistSearchMetrics(
                $searchStartedAt,
                array_merge($searchContextBase, [
                    'source' => 'empty_query',
                    'resultItems' => 0,
                    'resultTotalItems' => 0,
                ])
            );
            return $result;
        }

        // Browse mode for categories like "other" can intentionally run without a keyword query.
        if ($resolvedQuery === '' && $browseMode) {
            $catalogMetrics = null;
            $result = $this->searchWatchlistCandidatesFromCatalog(
                '',
                $resolvedLimit,
                $itemTypeFilter,
                $wearFilter,
                $page,
                $normalizedSortBy,
                $userId,
                $priceSourceOverride,
                $browseMode,
                $catalogMetrics
            );
            $this->logWatchlistSearchMetrics(
                $searchStartedAt,
                array_merge($searchContextBase, [
                    'source' => 'catalog_browse',
                    'resultItems' => count($result['items'] ?? []),
                    'resultTotalItems' => (int) ($result['totalItems'] ?? 0),
                    'catalogMetrics' => $catalogMetrics,
                ])
            );
            return $result;
        }

        if ($resolvedQuery === '') {
            $result = [
                'items' => [],
                'page' => 1,
                'limit' => $resolvedLimit,
                'totalItems' => 0,
                'totalPages' => 0,
                'sortBy' => $normalizedSortBy,
                'browseMode' => $browseMode,
            ];
            $this->logWatchlistSearchMetrics(
                $searchStartedAt,
                array_merge($searchContextBase, [
                    'source' => 'resolved_query_empty',
                    'resultItems' => 0,
                    'resultTotalItems' => 0,
                ])
            );
            return $result;
        }

        // DB-first search: local catalog is now the primary index after bulk price-list imports.
        // Steam search stays as fallback when local search yields no results.
        $catalogMetrics = null;
        $catalogResult = $this->searchWatchlistCandidatesFromCatalog(
            $resolvedQuery,
            $resolvedLimit,
            $itemTypeFilter,
            $wearFilter,
            $page,
            $normalizedSortBy,
            $userId,
            $priceSourceOverride,
            $browseMode,
            $catalogMetrics
        );
        if ((int) ($catalogResult['totalItems'] ?? 0) > 0) {
            $this->logWatchlistSearchMetrics(
                $searchStartedAt,
                array_merge($searchContextBase, [
                    'source' => 'catalog_primary',
                    'resultItems' => count($catalogResult['items'] ?? []),
                    'resultTotalItems' => (int) ($catalogResult['totalItems'] ?? 0),
                    'catalogMetrics' => $catalogMetrics,
                ])
            );
            return $catalogResult;
        }

        $steamStartedAt = microtime(true);
        $externalStart = 0;
        $externalBatchSize = max($resolvedLimit * 4, 32);
        $matchedItems = [];
        $totalCount = null;
        $seenMarketHashNames = [];
        $steamPagesFetched = 0;
        $steamRowsScanned = 0;

        while (true) {
            $steamResults = $this->steamMarketClient->searchItems($resolvedQuery, $externalBatchSize, $externalStart);
            $rawItems = $steamResults['items'] ?? [];
            $totalCount = (int) ($steamResults['totalCount'] ?? 0);
            $steamPagesFetched++;
            $steamRowsScanned += count($rawItems);

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

        // Local fallback: if Steam still has no usable matches, return the earlier catalog result.
        if ($matchedItems === []) {
            $this->logWatchlistSearchMetrics(
                $searchStartedAt,
                array_merge($searchContextBase, [
                    'source' => 'catalog_after_steam_empty',
                    'resultItems' => count($catalogResult['items'] ?? []),
                    'resultTotalItems' => (int) ($catalogResult['totalItems'] ?? 0),
                    'catalogMetrics' => $catalogMetrics,
                    'steamMetrics' => [
                        'durationMs' => (int) round((microtime(true) - $steamStartedAt) * 1000),
                        'pagesFetched' => $steamPagesFetched,
                        'rowsScanned' => $steamRowsScanned,
                        'totalCountHint' => $totalCount,
                        'matchedBeforePricing' => 0,
                    ],
                ]),
                true
            );
            return $catalogResult;
        }

        $matchedItems = $this->prepareSearchMatches($matchedItems, $userId, $priceSourceOverride);
        $this->sortSearchMatches($matchedItems, $normalizedSortBy);

        $totalItems = count($matchedItems);
        $totalPages = $totalItems > 0 ? (int) ceil($totalItems / $resolvedLimit) : 0;
        $resolvedPage = $totalPages > 0 ? min(max(1, $page), $totalPages) : 1;
        $pageOffset = ($resolvedPage - 1) * $resolvedLimit;
        $pageMatches = array_slice($matchedItems, $pageOffset, $resolvedLimit);

        $result = [
            'items' => $this->buildWatchlistSearchCandidates($pageMatches),
            'page' => $resolvedPage,
            'limit' => $resolvedLimit,
            'totalItems' => $totalItems,
            'totalPages' => $totalPages,
            'sortBy' => $normalizedSortBy,
            'browseMode' => $browseMode,
        ];
        $this->logWatchlistSearchMetrics(
            $searchStartedAt,
            array_merge($searchContextBase, [
                'source' => 'steam_fallback',
                'resultItems' => count($result['items'] ?? []),
                'resultTotalItems' => (int) ($result['totalItems'] ?? 0),
                'catalogMetrics' => $catalogMetrics,
                'steamMetrics' => [
                    'durationMs' => (int) round((microtime(true) - $steamStartedAt) * 1000),
                    'pagesFetched' => $steamPagesFetched,
                    'rowsScanned' => $steamRowsScanned,
                    'totalCountHint' => $totalCount,
                    'matchedBeforePricing' => count($matchedItems),
                ],
            ]),
            true
        );
        return $result;
    }

    private function searchWatchlistCandidatesFromCatalog(
        string $query,
        int $limit,
        ?string $itemTypeFilter,
        ?string $wearFilter,
        int $page,
        string $sortBy,
        int $userId,
        ?string $priceSourceOverride,
        bool $browseMode,
        ?array &$metrics = null
    ): array {
        $catalogStartedAt = microtime(true);
        $catalogSortBy = $sortBy;
        $totalItems = $this->itemRepository->countCatalog($query, $itemTypeFilter, $wearFilter);
        $totalPages = $totalItems > 0 ? (int) ceil($totalItems / $limit) : 0;
        $resolvedPage = $totalPages > 0 ? min(max(1, $page), $totalPages) : 1;
        $offset = $totalPages > 0 ? ($resolvedPage - 1) * $limit : 0;

        $rows = $this->itemRepository->searchCatalog(
            $query,
            $itemTypeFilter,
            $wearFilter,
            $catalogSortBy,
            $limit,
            $offset
        );

        $matchedItems = [];
        foreach ($rows as $row) {
            $marketHashName = trim((string) ($row['market_hash_name'] ?? $row['name'] ?? ''));
            if ($marketHashName === '') {
                continue;
            }

            $classification = $this->marketItemClassifier->classify(
                $marketHashName,
                isset($row['market_type_label']) ? (string) $row['market_type_label'] : null,
                isset($row['item_type']) ? (string) $row['item_type'] : null,
                isset($row['item_type_label']) ? (string) $row['item_type_label'] : null
            );
            $wear = $this->marketItemClassifier->normalizeWear(
                isset($row['wear_label']) ? (string) $row['wear_label'] : null,
                $marketHashName
            );

            $itemType = trim((string) ($row['item_type'] ?? $row['type'] ?? ''));
            if ($itemType === '') {
                $itemType = trim((string) $itemTypeFilter) === 'other'
                    ? 'other'
                    : (string) ($classification['key'] ?? 'other');
            }
            $itemTypeLabel = trim((string) ($row['item_type_label'] ?? ''));
            if ($itemTypeLabel === '') {
                $itemTypeLabel = trim((string) $itemTypeFilter) === 'other'
                    ? 'Other'
                    : (string) ($classification['label'] ?? 'Other');
            }
            $marketTypeLabel = trim((string) ($row['market_type_label'] ?? ''));
            if ($marketTypeLabel === '') {
                $marketTypeLabel = $itemTypeLabel !== '' ? $itemTypeLabel : 'CS2 Item';
            }

            $wearKey = trim((string) ($row['wear_key'] ?? ''));
            $wearLabel = trim((string) ($row['wear_label'] ?? ''));
            if ($wear !== null) {
                if ($wearKey === '') {
                    $wearKey = (string) ($wear['key'] ?? '');
                }
                if ($wearLabel === '') {
                    $wearLabel = (string) ($wear['label'] ?? '');
                }
            }

            $matchedItems[] = [
                'marketHashName' => $marketHashName,
                'displayName' => (string) ($row['name'] ?? $marketHashName),
                'itemType' => $itemType !== '' ? $itemType : 'other',
                'itemTypeLabel' => $itemTypeLabel !== '' ? $itemTypeLabel : 'Other',
                'marketTypeLabel' => $marketTypeLabel,
                'wear' => $wearKey !== '' ? $wearKey : null,
                'wearLabel' => $wearLabel !== '' ? $wearLabel : null,
                'iconUrl' => isset($row['image_url']) ? (string) $row['image_url'] : null,
                'steamHint' => null,
            ];
        }

        $matchedItems = $this->prepareSearchMatches($matchedItems, $userId, $priceSourceOverride);
        if ($sortBy !== 'relevance') {
            $this->sortSearchMatches($matchedItems, $sortBy);
        }

        $result = [
            'items' => $this->buildWatchlistSearchCandidates($matchedItems),
            'page' => $resolvedPage,
            'limit' => $limit,
            'totalItems' => $totalItems,
            'totalPages' => $totalPages,
            'sortBy' => $sortBy,
            'browseMode' => $browseMode,
        ];
        $metrics = [
            'durationMs' => (int) round((microtime(true) - $catalogStartedAt) * 1000),
            'query' => $this->truncateForSearchLog($query),
            'sortBy' => $catalogSortBy,
            'rowsFetched' => count($rows),
            'matchedItemsAfterPricing' => count($result['items']),
            'totalItems' => $totalItems,
            'page' => $resolvedPage,
            'limit' => $limit,
        ];
        return $result;
    }

    private function buildWatchlistSearchCandidates(array $matches): array
    {
        $candidates = [];
        foreach ($matches as $match) {
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

        return $candidates;
    }

    private function logWatchlistSearchMetrics(float $startedAt, array $context, bool $force = false): void
    {
        $durationMs = (int) round((microtime(true) - $startedAt) * 1000);
        $slowThresholdMs = $this->resolveWatchlistSearchSlowThresholdMs();
        $isSlow = $durationMs >= $slowThresholdMs;
        $metricsEnabled = $this->isWatchlistSearchMetricsEnabled();

        if (!$force && !$isSlow && !$metricsEnabled) {
            return;
        }

        Logger::event(
            $isSlow ? 'warning' : 'info',
            'domain',
            $isSlow ? 'domain.watchlist.search.slow' : 'domain.watchlist.search.metrics',
            $isSlow ? 'Watchlist search exceeded slow-query threshold' : 'Watchlist search executed',
            array_merge(
                $context,
                [
                    'durationMs' => $durationMs,
                    'slowThresholdMs' => $slowThresholdMs,
                    'isSlow' => $isSlow,
                    'metricsForced' => $force,
                ]
            )
        );
    }

    private function isWatchlistSearchMetricsEnabled(): bool
    {
        $value = getenv('WATCHLIST_SEARCH_METRICS_ENABLED');
        if ($value === false || $value === null || trim((string) $value) === '') {
            return true;
        }

        return in_array(
            strtolower(trim((string) $value)),
            ['1', 'true', 'yes', 'on'],
            true
        );
    }

    private function resolveWatchlistSearchSlowThresholdMs(): int
    {
        $value = getenv('WATCHLIST_SEARCH_SLOW_MS');
        if (!is_numeric($value)) {
            return 500;
        }

        return max(50, min(20000, (int) $value));
    }

    private function truncateForSearchLog(string $value, int $maxLength = 120): string
    {
        $normalized = trim(preg_replace('/\s+/', ' ', $value) ?? '');
        if ($normalized === '') {
            return '';
        }

        if (function_exists('mb_substr')) {
            return mb_substr($normalized, 0, $maxLength, 'UTF-8');
        }

        return substr($normalized, 0, $maxLength);
    }

    private function buildSearchQueryHash(string $query): string
    {
        $normalized = trim(preg_replace('/\s+/', ' ', $query) ?? '');
        if ($normalized === '') {
            return 'empty';
        }

        if (function_exists('mb_strtolower')) {
            $normalized = mb_strtolower($normalized, 'UTF-8');
        } else {
            $normalized = strtolower($normalized);
        }

        return hash('sha256', $normalized);
    }

    private function countSearchTokens(string $query): int
    {
        $normalized = preg_replace('/[^\p{L}\p{N}]+/u', ' ', $query) ?? '';
        $parts = preg_split('/\s+/u', trim($normalized)) ?: [];
        $tokens = [];
        foreach ($parts as $part) {
            $candidate = trim((string) $part);
            if ($candidate === '') {
                continue;
            }

            $token = function_exists('mb_strtolower')
                ? mb_strtolower($candidate, 'UTF-8')
                : strtolower($candidate);
            $length = function_exists('mb_strlen')
                ? mb_strlen($token, 'UTF-8')
                : strlen($token);
            if ($length < 2) {
                continue;
            }
            $tokens[$token] = true;
        }

        return count($tokens);
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
        $baseDuration = $statusCode !== null
            ? (self::CSFLOAT_BACKOFF_SECONDS[$statusCode] ?? null)
            : null;
        $retryAfterDuration = isset($warning['retryAfterSeconds']) && is_numeric($warning['retryAfterSeconds'])
            ? max(1, (int) $warning['retryAfterSeconds'])
            : null;
        $duration = $baseDuration;
        if ($retryAfterDuration !== null) {
            $duration = max((int) ($duration ?? 0), $retryAfterDuration);
        }

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

    private function isInteractiveRuntime(): bool
    {
        return PHP_SAPI !== 'cli';
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
        return in_array(
            trim((string) $itemTypeFilter),
            [
                'skin',
                'case',
                'souvenir_package',
                'sticker_capsule',
                'sticker',
                'patch',
                'music_kit',
                'agent',
                'key',
                'terminal',
                'charm',
                'graffiti',
                'tool',
                'other',
            ],
            true
        );
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
            'other' => '',
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

    private function prepareSearchMatches(array $matchedItems, int $userId, ?string $priceSourceOverride = null): array
    {
        $preparedMatches = [];
        $presentationCache = [];
        $forceSteamOnly = strtolower(trim((string) $priceSourceOverride)) === self::PRICE_SOURCE_STEAM;
        foreach ($matchedItems as $match) {
            $marketHashName = (string) ($match['marketHashName'] ?? '');
            if ($marketHashName === '') {
                continue;
            }

            if ($forceSteamOnly) {
                $steamHint = is_array($match['steamHint'] ?? null) ? $match['steamHint'] : null;
                $steamSnapshot = $this->resolveSteamPriceSnapshot($marketHashName, $steamHint);
                $resolvedSteamHint = is_array($steamSnapshot['steamHint'] ?? null)
                    ? $steamSnapshot['steamHint']
                    : $steamHint;

                $priceUsd = isset($steamSnapshot['priceUsd']) && is_numeric($steamSnapshot['priceUsd'])
                    ? round((float) $steamSnapshot['priceUsd'], 2)
                    : null;
                $priceEur = $priceUsd !== null
                    ? round($priceUsd * $this->getUsdToEurRate(), 2)
                    : null;

                if ($priceEur !== null) {
                    $match['sortPriceEur'] = $priceEur;
                }

                if (is_array($resolvedSteamHint)) {
                    $steamDisplayName = trim((string) ($resolvedSteamHint['displayName'] ?? ''));
                    $steamTypeLabel = trim((string) ($resolvedSteamHint['typeLabel'] ?? ''));
                    $steamIconUrl = isset($resolvedSteamHint['iconUrl']) ? (string) $resolvedSteamHint['iconUrl'] : null;

                    if ($steamDisplayName !== '') {
                        $match['displayName'] = $steamDisplayName;
                    }
                    if ($steamTypeLabel !== '') {
                        $match['marketTypeLabel'] = $steamTypeLabel;
                    }
                    if ($steamIconUrl !== null && trim($steamIconUrl) !== '') {
                        $match['iconUrl'] = $steamIconUrl;
                    }
                }

                $match['displayName'] = (string) ($match['displayName'] ?? $marketHashName);
                $match['itemType'] = (string) ($match['itemType'] ?? 'other');
                $match['itemTypeLabel'] = (string) ($match['itemTypeLabel'] ?? 'Other');
                $match['marketTypeLabel'] = (string) ($match['marketTypeLabel'] ?? 'CS2 Item');
                $match['priceSource'] = self::PRICE_SOURCE_STEAM;
                $match['livePriceEur'] = $priceEur;
                $match['livePriceUsd'] = $priceUsd;
                $preparedMatches[] = $match;
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
