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

final class PricingService
{
    private const LIVE_CACHE_TTL_SECONDS = 600;

    private bool $cacheTablesReady = false;
    private ?float $exchangeRateCache = null;

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

    public function getItemPresentation(string $itemName, ?array $steamHint = null): array
    {
        $this->ensureCacheTables();

        $catalog = $this->getCatalogEntry($itemName, $steamHint);
        $cachedLive = $this->normalizeLiveCacheRow(
            $this->itemLiveCacheRepository->findByMarketHashName($itemName)
        );

        if ($this->isFreshLiveCache($cachedLive)) {
            return $this->buildPresentation($catalog, $cachedLive);
        }

        $listing = $this->csFloatClient->fetchLowestListingSnapshot($itemName);
        if ($listing === null) {
            return $this->buildPresentation($catalog, $cachedLive);
        }

        $catalog = $this->persistCatalogEntry($itemName, $catalog, $steamHint, $listing);
        $liveCache = $this->persistLiveCacheEntry($itemName, (float) $listing['priceUsd']);

        return $this->buildPresentation($catalog, $liveCache);
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

        $matchedItems = $this->prepareMatchesForSort($matchedItems, $normalizedSortBy);
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

            $presentation = is_array($match['presentation'] ?? null)
                ? $match['presentation']
                : $this->getItemPresentation(
                    $marketHashName,
                    is_array($match['steamHint'] ?? null) ? $match['steamHint'] : null
                );
            if (!isset($presentation['priceUsd'], $presentation['priceEur'])) {
                continue;
            }

            $dto = new WatchlistSearchCandidateDto(
                marketHashName: $marketHashName,
                displayName: (string) ($match['displayName'] ?? $marketHashName),
                itemType: (string) ($presentation['itemType'] ?? $match['itemType'] ?? 'other'),
                itemTypeLabel: (string) ($presentation['itemTypeLabel'] ?? $match['itemTypeLabel'] ?? 'Other'),
                marketTypeLabel: (string) ($presentation['marketTypeLabel'] ?? $match['marketTypeLabel'] ?? 'CS2 Item'),
                wear: isset($presentation['wear']) ? (string) $presentation['wear'] : ($match['wear'] ?? null),
                wearLabel: isset($presentation['wearLabel']) ? (string) $presentation['wearLabel'] : ($match['wearLabel'] ?? null),
                iconUrl: isset($presentation['iconUrl']) ? (string) $presentation['iconUrl'] : ($match['iconUrl'] ?? null),
                livePriceEur: (float) $presentation['priceEur'],
                livePriceUsd: (float) $presentation['priceUsd']
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

    private function persistLiveCacheEntry(string $itemName, float $priceUsd): array
    {
        $exchangeRate = $this->getUsdToEurRate();
        $priceEur = round($priceUsd * $exchangeRate, 2);
        $fetchedAt = date('Y-m-d H:i:s');

        $this->itemLiveCacheRepository->upsert(
            $itemName,
            round($priceUsd, 2),
            $priceEur,
            $exchangeRate,
            $fetchedAt
        );

        return [
            'marketHashName' => $itemName,
            'priceUsd' => round($priceUsd, 2),
            'priceEur' => $priceEur,
            'exchangeRate' => $exchangeRate,
            'fetchedAt' => $fetchedAt,
        ];
    }

    private function buildPresentation(?array $catalog, ?array $liveCache): array
    {
        return [
            'priceUsd' => $liveCache['priceUsd'] ?? null,
            'priceEur' => $liveCache['priceEur'] ?? null,
            'exchangeRate' => $liveCache['exchangeRate'] ?? null,
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
        if ($liveCache === null || !isset($liveCache['fetchedAt'])) {
            return false;
        }

        $fetchedAt = strtotime((string) $liveCache['fetchedAt']);
        if ($fetchedAt === false) {
            return false;
        }

        return (time() - $fetchedAt) < self::LIVE_CACHE_TTL_SECONDS;
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

    private function prepareMatchesForSort(array $matchedItems, string $sortBy): array
    {
        if (!in_array($sortBy, ['price_asc', 'price_desc'], true)) {
            return $matchedItems;
        }

        $preparedMatches = [];

        foreach ($matchedItems as $match) {
            $marketHashName = (string) ($match['marketHashName'] ?? '');
            if ($marketHashName === '') {
                continue;
            }

            $presentation = $this->getItemPresentation(
                $marketHashName,
                is_array($match['steamHint'] ?? null) ? $match['steamHint'] : null
            );
            if (!isset($presentation['priceEur'], $presentation['priceUsd'])) {
                continue;
            }

            $match['presentation'] = $presentation;
            $match['sortPriceEur'] = (float) $presentation['priceEur'];
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
