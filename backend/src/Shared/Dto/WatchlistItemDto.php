<?php
declare(strict_types=1);

namespace App\Shared\Dto;

final class WatchlistItemDto
{
    public function __construct(
        public readonly int $id,
        public readonly string $name,
        public readonly string $type,
        public readonly ?string $imageUrl,
        public readonly ?float $currentPrice,
        public readonly ?string $priceSource,
        public readonly ?float $priceChange,
        public readonly ?float $priceChangePercent,
        public readonly array $priceHistory,
        // Catalogue classification. `type` above is the legacy `items.type`
        // column and is unreliable (it holds 'skin' for most containers), so
        // consumers categorise on these instead.
        public readonly ?string $catalogItemType = null,
        public readonly ?string $marketTypeLabel = null,
        // Zielpreis. USD, unlike `currentPrice` above — that one is already
        // converted to EUR by PriceHistoryRepository. The client compares the
        // target against the USD price history, never against `currentPrice`.
        public readonly ?float $alertPriceUsd = null,
        public readonly string $alertDirection = 'below',
        public readonly ?float $alertAnchorPriceUsd = null,
        public readonly ?string $alertTriggeredAt = null
    ) {
    }

    public function toArray(): array
    {
        $trend = null;
        $changeLabel = 'N/A';
        if ($this->priceChange !== null && $this->priceChangePercent !== null) {
            $isPositive = $this->priceChange >= 0;
            $trend = $isPositive ? 'up' : 'down';
            $sign = $isPositive ? '+' : '';
            $changeLabel = sprintf('%s%.2f%%', $sign, $this->priceChangePercent);
        }

        return [
            'id' => $this->id,
            'name' => $this->name,
            'type' => $this->type,
            'catalogItemType' => $this->catalogItemType,
            'marketTypeLabel' => $this->marketTypeLabel,
            'imageUrl' => $this->imageUrl,
            'currentPrice' => $this->currentPrice,
            'priceSource' => $this->priceSource,
            'priceChange' => $this->priceChange,
            'priceChangePercent' => $this->priceChangePercent,
            'priceHistory' => $this->priceHistory,
            'trend' => $trend,
            'changeLabel' => $changeLabel,
            'alertPriceUsd' => $this->alertPriceUsd,
            'alertDirection' => $this->alertDirection,
            'alertAnchorPriceUsd' => $this->alertAnchorPriceUsd,
            'alertTriggeredAt' => $this->alertTriggeredAt,
        ];
    }
}
