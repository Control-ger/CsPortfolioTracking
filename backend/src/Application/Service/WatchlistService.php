<?php
declare(strict_types=1);

namespace App\Application\Service;

use App\Infrastructure\Persistence\Repository\ItemRepository;
use App\Infrastructure\Persistence\Repository\PriceHistoryRepository;
use App\Infrastructure\Persistence\Repository\WatchlistRepository;
use App\Shared\Dto\WatchlistItemDto;
use App\Shared\Logger;

final class WatchlistService
{
    public function __construct(
        private readonly WatchlistRepository $watchlistRepository,
        private readonly ItemRepository $itemRepository,
        private readonly PriceHistoryRepository $priceHistoryRepository,
        private readonly PricingService $pricingService
    ) {
    }

    public function listWithMetrics(int $userId = 1, bool $syncLive = false): array
    {
        $this->watchlistRepository->ensureTable();
        $this->priceHistoryRepository->ensureTable();

        if ($syncLive) {
            $this->syncLivePrices($userId);
        }

        $items = $this->watchlistRepository->findAll($userId);
        $now = date('Y-m-d H:i:s');
        $sevenDaysAgo = date('Y-m-d H:i:s', strtotime('-7 days'));
        $historyFrom = date('Y-m-d H:i:s', strtotime('-370 days'));
        $result = [];

        foreach ($items as $item) {
            $name = (string) ($item['name'] ?? '');
            $itemId = (int) ($item['item_id'] ?? 0);
            if ($name === '') {
                continue;
            }

            $imageUrl = $this->pricingService->getItemImageUrl($name);

            $currentPrice = $itemId > 0 ? $this->priceHistoryRepository->findLatestPriceByItemId($itemId, $now) : null;
            $priceSource = null;
            $oldPrice = $itemId > 0 ? $this->priceHistoryRepository->findLatestPriceByItemId($itemId, $sevenDaysAgo) : null;
            $priceChange = null;
            $priceChangePercent = null;

            if ($currentPrice !== null && $oldPrice !== null && $oldPrice > 0) {
                $priceChange = $currentPrice - $oldPrice;
                $priceChangePercent = ($priceChange / $oldPrice) * 100;
            }

            $priceHistory = $itemId > 0 ? $this->priceHistoryRepository->findHistoryByItemId($itemId, $historyFrom) : [];
            $priceHistoryWithGrowth = $this->enrichHistoryWithGrowthPercent($priceHistory);

            $dto = new WatchlistItemDto(
                id: (int) $item['id'],
                name: $name,
                type: (string) ($item['type'] ?? 'skin'),
                imageUrl: $imageUrl,
                currentPrice: $currentPrice,
                priceSource: is_string($priceSource) ? $priceSource : null,
                priceChange: $priceChange,
                priceChangePercent: $priceChangePercent,
                priceHistory: $priceHistoryWithGrowth
            );

            $result[] = $dto->toArray();
        }

        return $result;
    }

    public function searchAvailableItems(
        string $query,
        int $limit = 6,
        ?string $itemTypeFilter = null,
        ?string $wearFilter = null,
        int $page = 1,
        ?string $sortBy = null
    ): array
    {
        $normalizedQuery = trim($query);
        $normalizedItemType = trim((string) $itemTypeFilter);
        $canBrowseByFilter = $this->canBrowseByFilter($normalizedItemType);

        if ($normalizedQuery === '' && !$canBrowseByFilter) {
            return [
                'items' => [],
                'page' => max(1, $page),
                'limit' => max(1, min($limit, 12)),
                'totalItems' => 0,
                'totalPages' => 0,
                'sortBy' => trim((string) $sortBy) !== '' ? trim((string) $sortBy) : 'relevance',
                'browseMode' => false,
            ];
        }

        if ($normalizedQuery !== '' && strlen($normalizedQuery) < 2) {
            return [
                'items' => [],
                'page' => max(1, $page),
                'limit' => max(1, min($limit, 12)),
                'totalItems' => 0,
                'totalPages' => 0,
                'sortBy' => trim((string) $sortBy) !== '' ? trim((string) $sortBy) : 'relevance',
                'browseMode' => false,
            ];
        }

        return $this->pricingService->searchWatchlistCandidates(
            $normalizedQuery,
            $limit,
            $itemTypeFilter,
            $wearFilter,
            $page,
            $sortBy
        );
    }

    private function canBrowseByFilter(string $itemTypeFilter): bool
    {
        return in_array(
            $itemTypeFilter,
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
            ],
            true
        );
    }

    public function consumePricingWarnings(): array
    {
        return $this->pricingService->consumeWarnings();
    }

    public function addItem(int $userId = 1, string $name = '', string $type = 'skin'): array
    {
        $trimmedName = trim($name);
        if ($trimmedName === '') {
            throw new \InvalidArgumentException('Name ist erforderlich.');
        }

        $this->watchlistRepository->ensureTable();
        $this->priceHistoryRepository->ensureTable();

        $itemId = $this->itemRepository->findOrCreateByName($trimmedName, $type);

        if ($this->watchlistRepository->existsByItemId($userId, $itemId)) {
            throw new \RuntimeException('Item ist bereits in der Watchlist vorhanden.');
        }

        $id = $this->watchlistRepository->insert($userId, $itemId, null);
        $liveSnapshot = $this->syncSingleItemPrice($itemId, $trimmedName);

        Logger::event(
            'info',
            'domain',
            'domain.watchlist.item_created',
            'Watchlist item created',
            [
                'itemId' => $id,
                'userId' => $userId,
                'itemName' => $trimmedName,
                'itemType' => $type,
                'isLiveSynced' => $liveSnapshot !== null,
            ]
        );

        return [
            'id' => $id,
            'currentPrice' => $liveSnapshot['priceEur'] ?? null,
            'isLiveSynced' => $liveSnapshot !== null,
        ];
    }

    public function deleteItem(int $id): bool
    {
        $deleted = $this->watchlistRepository->deleteById($id);
        Logger::event(
            'info',
            'domain',
            'domain.watchlist.item_deleted',
            'Watchlist item deleted',
            [
                'itemId' => $id,
                'deleted' => $deleted,
            ]
        );

        return $deleted;
    }

    public function refreshPrices(int $userId = 1): array
    {
        $this->watchlistRepository->ensureTable();
        $this->priceHistoryRepository->ensureTable();

        Logger::event(
            'info',
            'domain',
            'domain.watchlist.price_refresh_started',
            'Watchlist price refresh started'
        );
        $result = $this->syncLivePrices($userId);
        Logger::event(
            'info',
            'domain',
            'domain.watchlist.price_refresh_completed',
            'Watchlist price refresh completed',
            [
                'updated' => $result['updated'] ?? null,
                'totalItems' => $result['totalItems'] ?? null,
            ]
        );

        return $result;
    }

    private function syncLivePrices(int $userId): array
    {
        $items = $this->watchlistRepository->findAll($userId);
        $updated = 0;

        foreach ($items as $item) {
            $name = (string) ($item['name'] ?? '');
            $itemId = (int) ($item['item_id'] ?? 0);
            if ($name === '') {
                continue;
            }

            if ($itemId <= 0 || $this->syncSingleItemPrice($itemId, $name) === null) {
                continue;
            }

            $updated++;
            usleep(200000);
        }

        return ['updated' => $updated, 'totalItems' => count($items)];
    }

    private function syncSingleItemPrice(int $itemId, string $itemName): ?array
    {
        $snapshot = $this->pricingService->getLivePriceSnapshot($itemName);
        if ($snapshot === null) {
            return null;
        }

        $this->priceHistoryRepository->upsertPrice(
            $itemId,
            $this->currentHourBucket(),
            (float) $snapshot['priceUsd'],
            (int) ($snapshot['exchangeRateId'] ?? 0),
            isset($snapshot['priceSource']) ? (string) $snapshot['priceSource'] : null
        );

        return $snapshot;
    }

    private function currentHourBucket(): string
    {
        return date('Y-m-d H:00:00');
    }

    private function enrichHistoryWithGrowthPercent(array $priceHistory): array
    {
        if (empty($priceHistory)) {
            return [];
        }

        $firstPrice = $priceHistory[0]['wert'] ?? null;
        if ($firstPrice === null || $firstPrice == 0) {
            return $priceHistory;
        }

        return array_map(
            static function (array $entry) use ($firstPrice): array {
                $currentPrice = $entry['wert'] ?? 0;
                $growthPercent = (($currentPrice - $firstPrice) / $firstPrice) * 100;

                return [
                    'date' => $entry['date'],
                    'wert' => $currentPrice,
                    'growthPercent' => $growthPercent,
                ];
            },
            $priceHistory
        );
    }
}
