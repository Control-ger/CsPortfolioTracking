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
        public readonly array $priceHistory
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
            'imageUrl' => $this->imageUrl,
            'currentPrice' => $this->currentPrice,
            'priceSource' => $this->priceSource,
            'priceChange' => $this->priceChange,
            'priceChangePercent' => $this->priceChangePercent,
            'priceHistory' => $this->priceHistory,
            'trend' => $trend,
            'changeLabel' => $changeLabel,
        ];
    }
}
