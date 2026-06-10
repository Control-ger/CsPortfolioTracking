<?php
declare(strict_types=1);

namespace App\Application\Service;

use App\Application\Support\MarketItemClassifier;
use App\Infrastructure\External\SteamMarketClient;
use App\Infrastructure\Persistence\Repository\ExchangeRateRepository;
use App\Infrastructure\Persistence\Repository\ItemRepository;
use App\Infrastructure\Persistence\Repository\ItemLiveCacheRepository;
use App\Infrastructure\Persistence\Repository\UserPriceSourcePreferenceRepository;
use App\Shared\Dto\WatchlistSearchCandidateDto;
use App\Shared\Logger;

final class WatchlistSearchService
{
    private const PRICE_SOURCE_CSFLOAT = 'csfloat';
    private const PRICE_SOURCE_STEAM = 'steam';

    private bool $cacheTablesReady = false;
    private array $priceSourcePreferenceCache = [];

    public function __construct(
        private readonly PricingService $pricingService,
        private readonly SteamMarketClient $steamMarketClient,
        private readonly MarketItemClassifier $marketItemClassifier,
        private readonly ItemRepository $itemRepository,
        private readonly ExchangeRateRepository $exchangeRateRepository,
        private readonly ItemLiveCacheRepository $itemLiveCacheRepository,
        private readonly UserPriceSourcePreferenceRepository $userPriceSourcePreferenceRepository
    ) {
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

        $this->exchangeRateRepository->ensureTable();
        $this->itemRepository->ensureTable();
        $this->itemLiveCacheRepository->ensureTable();
        $this->userPriceSourcePreferenceRepository->ensureTable();
        $this->cacheTablesReady = true;
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
                    ? round($priceUsd * $this->pricingService->getUsdToEurRate(), 2)
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
                $presentation = $this->pricingService->getItemPresentation(
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
