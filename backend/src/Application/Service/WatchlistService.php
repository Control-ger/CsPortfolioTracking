<?php
declare(strict_types=1);

namespace App\Application\Service;

use App\Infrastructure\Persistence\Repository\PriceHistoryRepository;
use App\Infrastructure\Persistence\Repository\WatchlistRepository;
use App\Shared\Dto\WatchlistItemDto;

final class WatchlistService
{
    public function __construct(
        private readonly WatchlistRepository $watchlistRepository,
        private readonly PriceHistoryRepository $priceHistoryRepository,
        private readonly PricingService $pricingService
    ) {
    }

    public function listWithMetrics(bool $syncLive = false): array
    {
        $this->watchlistRepository->ensureTable();
        $this->priceHistoryRepository->ensureTable();

        if ($syncLive) {
            $this->syncLivePrices();
        }

        $items = $this->watchlistRepository->findAll();
        $today = date('Y-m-d');
        $sevenDaysAgo = date('Y-m-d', strtotime('-7 days'));
        $result = [];

        foreach ($items as $item) {
            $name = (string) ($item['name'] ?? '');
            if ($name === '') {
                continue;
            }

            $imageUrl = $this->pricingService->getItemImageUrl($name);

            $currentPrice = $this->priceHistoryRepository->findLatestPriceByItem($name, $today);
            $oldPrice = $this->priceHistoryRepository->findLatestPriceByItem($name, $sevenDaysAgo);
            $priceChange = null;
            $priceChangePercent = null;

            if ($currentPrice !== null && $oldPrice !== null && $oldPrice > 0) {
                $priceChange = $currentPrice - $oldPrice;
                $priceChangePercent = ($priceChange / $oldPrice) * 100;
            }

            $dto = new WatchlistItemDto(
                id: (int) $item['id'],
                name: $name,
                type: (string) ($item['type'] ?? 'skin'),
                imageUrl: $imageUrl,
                currentPrice: $currentPrice,
                priceChange: $priceChange,
                priceChangePercent: $priceChangePercent,
                priceHistory: $this->priceHistoryRepository->findHistoryByItem($name, $sevenDaysAgo)
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

    public function addItem(string $name, string $type = 'skin'): array
    {
        $trimmedName = trim($name);
        if ($trimmedName === '') {
            throw new \InvalidArgumentException('Name ist erforderlich.');
        }

        $this->watchlistRepository->ensureTable();
        $this->priceHistoryRepository->ensureTable();

        if ($this->watchlistRepository->existsByName($trimmedName)) {
            throw new \RuntimeException('Item ist bereits in der Watchlist vorhanden.');
        }

        $id = $this->watchlistRepository->insert($trimmedName, $type);
        $liveSnapshot = $this->syncSingleItemPrice($trimmedName);

        return [
            'id' => $id,
            'currentPrice' => $liveSnapshot['priceEur'] ?? null,
            'isLiveSynced' => $liveSnapshot !== null,
        ];
    }

    public function deleteItem(int $id): bool
    {
        return $this->watchlistRepository->deleteById($id);
    }

    public function refreshPrices(): array
    {
        $this->watchlistRepository->ensureTable();
        $this->priceHistoryRepository->ensureTable();

        return $this->syncLivePrices();
    }

    private function syncLivePrices(): array
    {
        $items = $this->watchlistRepository->findAll();
        $updated = 0;

        foreach ($items as $item) {
            $name = (string) ($item['name'] ?? '');
            if ($name === '') {
                continue;
            }

            if ($this->syncSingleItemPrice($name) === null) {
                continue;
            }

            $updated++;
            usleep(200000);
        }

        return ['updated' => $updated, 'totalItems' => count($items)];
    }

    private function syncSingleItemPrice(string $itemName): ?array
    {
        $snapshot = $this->pricingService->getLivePriceSnapshot($itemName);
        if ($snapshot === null) {
            return null;
        }

        $this->priceHistoryRepository->upsertPrice(
            $itemName,
            date('Y-m-d'),
            (float) $snapshot['priceUsd'],
            (float) $snapshot['priceEur'],
            (float) $snapshot['exchangeRate']
        );

        return $snapshot;
    }
}
