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

    public function listWithMetrics(): array
    {
        $this->watchlistRepository->ensureTable();
        $this->priceHistoryRepository->ensureTable();

        $items = $this->watchlistRepository->findAll();
        $today = date('Y-m-d');
        $sevenDaysAgo = date('Y-m-d', strtotime('-7 days'));
        $result = [];

        foreach ($items as $item) {
            $name = (string) $item['name'];
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
                type: (string) $item['type'],
                currentPrice: $currentPrice,
                priceChange: $priceChange,
                priceChangePercent: $priceChangePercent,
                priceHistory: $this->priceHistoryRepository->findHistoryByItem($name, $sevenDaysAgo)
            );
            $result[] = $dto->toArray();
        }

        return $result;
    }

    public function addItem(string $name, string $type = 'skin'): int
    {
        $trimmedName = trim($name);
        if ($trimmedName === '') {
            throw new \InvalidArgumentException('Name ist erforderlich.');
        }
        if ($this->watchlistRepository->existsByName($trimmedName)) {
            throw new \RuntimeException('Item ist bereits in der Watchlist vorhanden.');
        }
        return $this->watchlistRepository->insert($trimmedName, $type);
    }

    public function deleteItem(int $id): bool
    {
        return $this->watchlistRepository->deleteById($id);
    }

    public function refreshPrices(): array
    {
        $this->watchlistRepository->ensureTable();
        $this->priceHistoryRepository->ensureTable();
        $items = $this->watchlistRepository->findAll();
        $today = date('Y-m-d');
        $rate = $this->pricingService->getUsdToEurRate();
        $updated = 0;

        foreach ($items as $item) {
            $name = (string) $item['name'];
            $usd = $this->pricingService->getLivePriceEur($name);
            if ($usd === null) {
                continue;
            }
            // pricingService gibt bereits EUR zurück. Für historische Spalten halten wir USD approximiert.
            $priceEur = $usd;
            $priceUsd = $rate > 0 ? ($priceEur / $rate) : $priceEur;
            $this->priceHistoryRepository->upsertPrice($name, $today, $priceUsd, $priceEur, $rate);
            $updated++;
            usleep(200000);
        }

        return ['updated' => $updated, 'totalItems' => count($items)];
    }
}
