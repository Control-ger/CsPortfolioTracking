<?php
declare(strict_types=1);

namespace App\Shared\Dto;

final class PortfolioSummaryDto
{
    public function __construct(
        public readonly float $totalValue,
        public readonly float $totalInvested,
        public readonly int $totalQuantity,
        public readonly float $totalProfitEuro,
        public readonly float $totalRoiPercent,
        public readonly bool $isPositive,
        public readonly string $chartColor
    ) {
    }

    public function toArray(): array
    {
        return [
            'totalValue' => $this->totalValue,
            'totalInvested' => $this->totalInvested,
            'totalQuantity' => $this->totalQuantity,
            'totalProfitEuro' => $this->totalProfitEuro,
            'totalRoiPercent' => $this->totalRoiPercent,
            'isPositive' => $this->isPositive,
            'chartColor' => $this->chartColor,
        ];
    }
}
