<?php
declare(strict_types=1);

namespace App\Application\Service;

use App\Infrastructure\Persistence\Repository\InvestmentRepository;
use App\Infrastructure\Persistence\Repository\PortfolioHistoryRepository;
use App\Shared\Dto\PortfolioSummaryDto;

final class PortfolioService
{
    public function __construct(
        private readonly InvestmentRepository $investmentRepository,
        private readonly PortfolioHistoryRepository $***REMOVED***HistoryRepository,
        private readonly PricingService $pricingService
    ) {
    }

    public function getEnrichedInvestments(): array
    {
        $investments = $this->investmentRepository->findAll();
        $rows = [];

        foreach ($investments as $investment) {
            $buyPrice = (float) ($investment['buy_price'] ?? 0);
            $quantity = (int) ($investment['quantity'] ?? 0);
            $livePrice = $this->pricingService->getLivePriceEur((string) $investment['name']);
            $displayPrice = $livePrice ?? $buyPrice;
            $isLive = $livePrice !== null;
            $roi = $buyPrice > 0 ? (($displayPrice - $buyPrice) / $buyPrice) * 100 : 0.0;
            $totalInvested = $buyPrice * $quantity;
            $currentValue = $displayPrice * $quantity;
            $profitEuro = $currentValue - $totalInvested;

            $rows[] = [
                'id' => (int) $investment['id'],
                'name' => (string) $investment['name'],
                'type' => (string) $investment['type'],
                'buyPrice' => $buyPrice,
                'quantity' => $quantity,
                'livePrice' => $livePrice,
                'displayPrice' => $displayPrice,
                'roi' => $roi,
                'isLive' => $isLive,
                'pricingStatus' => $isLive ? 'live' : 'fallback',
                'totalInvested' => $totalInvested,
                'currentValue' => $currentValue,
                'profitEuro' => $profitEuro,
                'isProfitPositive' => $profitEuro >= 0,
            ];
        }

        return $rows;
    }

    public function getSummary(array $rows): PortfolioSummaryDto
    {
        $totalValue = 0.0;
        $totalInvested = 0.0;
        $totalQuantity = 0;

        foreach ($rows as $row) {
            $totalValue += ((float) $row['displayPrice']) * ((int) $row['quantity']);
            $totalInvested += ((float) $row['buyPrice']) * ((int) $row['quantity']);
            $totalQuantity += (int) $row['quantity'];
        }

        $totalProfitEuro = $totalValue - $totalInvested;
        $totalRoiPercent = $totalInvested > 0 ? ($totalProfitEuro / $totalInvested) * 100 : 0.0;
        $isPositive = $totalProfitEuro >= 0;

        return new PortfolioSummaryDto(
            totalValue: $totalValue,
            totalInvested: $totalInvested,
            totalQuantity: $totalQuantity,
            totalProfitEuro: $totalProfitEuro,
            totalRoiPercent: $totalRoiPercent,
            isPositive: $isPositive,
            chartColor: $isPositive ? '#22c55e' : '#ef4444'
        );
    }

    public function getHistory(): array
    {
        $this->***REMOVED***HistoryRepository->ensureTable();
        $rows = $this->***REMOVED***HistoryRepository->findAll();
        return array_map(
            static fn(array $row): array => ['id' => (int) $row['id'], 'date' => $row['date'], 'wert' => (float) $row['total_value']],
            $rows
        );
    }

    public function saveDailyValue(?float $value = null): array
    {
        $this->***REMOVED***HistoryRepository->ensureTable();
        $rows = $this->getEnrichedInvestments();
        $summary = $this->getSummary($rows);
        $totalValue = $value ?? $summary->totalValue;
        $today = date('Y-m-d');
        $this->***REMOVED***HistoryRepository->upsertForDate($today, $totalValue);
        return ['date' => $today, 'totalValue' => $totalValue];
    }
}
