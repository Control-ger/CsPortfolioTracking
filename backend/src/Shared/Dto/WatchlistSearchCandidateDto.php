<?php
declare(strict_types=1);

namespace App\Shared\Dto;

final class WatchlistSearchCandidateDto
{
    public function __construct(
        public readonly string $marketHashName,
        public readonly string $displayName,
        public readonly string $itemType,
        public readonly string $itemTypeLabel,
        public readonly string $marketTypeLabel,
        public readonly ?string $wear,
        public readonly ?string $wearLabel,
        public readonly ?string $iconUrl,
        public readonly float $livePriceEur,
        public readonly float $livePriceUsd
    ) {
    }

    public function toArray(): array
    {
        return [
            'marketHashName' => $this->marketHashName,
            'displayName' => $this->displayName,
            'itemType' => $this->itemType,
            'itemTypeLabel' => $this->itemTypeLabel,
            'marketTypeLabel' => $this->marketTypeLabel,
            'wear' => $this->wear,
            'wearLabel' => $this->wearLabel,
            'iconUrl' => $this->iconUrl,
            'livePriceEur' => $this->livePriceEur,
            'livePriceUsd' => $this->livePriceUsd,
        ];
    }
}
