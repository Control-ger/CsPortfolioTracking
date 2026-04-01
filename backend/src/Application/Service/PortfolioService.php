<?php
declare(strict_types=1);

namespace App\Application\Service;

use App\Infrastructure\Persistence\Repository\InvestmentRepository;
use App\Infrastructure\Persistence\Repository\PositionHistoryRepository;
use App\Infrastructure\Persistence\Repository\PortfolioHistoryRepository;
use App\Shared\Dto\PortfolioSummaryDto;

final class PortfolioService
{
    public function __construct(
        private readonly InvestmentRepository $investmentRepository,
        private readonly PositionHistoryRepository $positionHistoryRepository,
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
            $presentation = $this->pricingService->getItemPresentation((string) $investment['name']);
            $livePrice = isset($presentation['priceEur']) ? (float) $presentation['priceEur'] : null;
            $priceSource = isset($presentation['priceSource']) ? (string) $presentation['priceSource'] : null;
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
                'imageUrl' => $presentation['iconUrl'] ?? null,
                'buyPrice' => $buyPrice,
                'quantity' => $quantity,
                'livePrice' => $livePrice,
                'priceSource' => $priceSource,
                'displayPrice' => $displayPrice,
                'roi' => $roi,
                'isLive' => $isLive,
                'pricingStatus' => $isLive ? ($priceSource ?? 'live') : 'fallback',
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

    public function getInvestmentHistory(int $investmentId): array
    {
        $this->positionHistoryRepository->ensureTable();
        $rows = $this->positionHistoryRepository->findHistoryByInvestmentId($investmentId);

        return array_map(
            static fn(array $row): array => [
                'date' => $row['date'],
                'wert' => (float) $row['total_value'],
                'quantity' => (int) $row['quantity'],
                'unitPrice' => (float) $row['unit_price'],
            ],
            $rows
        );
    }

    public function consumePricingWarnings(): array
    {
        return $this->pricingService->consumeWarnings();
    }

    public function saveDailyValue(?float $value = null): array
    {
        $this->***REMOVED***HistoryRepository->ensureTable();
        $this->positionHistoryRepository->ensureTable();
        $rows = $this->getEnrichedInvestments();
        $summary = $this->getSummary($rows);
        $totalValue = $value ?? $summary->totalValue;
        $today = date('Y-m-d');
        $this->***REMOVED***HistoryRepository->upsertForDate($today, $totalValue);
        foreach ($rows as $row) {
            $this->positionHistoryRepository->upsertSnapshot(
                investmentId: (int) $row['id'],
                date: $today,
                quantity: (int) $row['quantity'],
                unitPrice: (float) $row['displayPrice'],
                totalValue: (float) $row['currentValue']
            );
        }
        return ['date' => $today, 'totalValue' => $totalValue];
    }

    public function getComposition(): array
    {
        $investments = $this->getEnrichedInvestments();
        $composition = [];
        $totalValue = 0.0;

        // Group by name (individual item) instead of type
        foreach ($investments as $investment) {
            $name = (string) $investment['name'];
            $type = (string) $investment['type'];
            $currentValue = (float) $investment['currentValue'];
            $totalValue += $currentValue;

            if (!isset($composition[$name])) {
                $composition[$name] = [
                    'count' => 0,
                    'value' => 0.0,
                    'type' => $type,
                ];
            }

            $composition[$name]['count'] += (int) $investment['quantity'];
            $composition[$name]['value'] += $currentValue;
        }

        // Calculate percentages and format
        $result = [];
        foreach ($composition as $name => $data) {
            $percentage = $totalValue > 0 ? ($data['value'] / $totalValue) * 100 : 0;
            $result[] = [
                'name' => $name,
                'type' => $data['type'],
                'count' => $data['count'],
                'value' => round($data['value'], 2),
                'percentage' => round($percentage, 1),
                'color' => $this->getTypeColor($data['type']),
            ];
        }

        // Sort by value descending
        usort($result, fn($a, $b) => $b['value'] <=> $a['value']);

        return $result;
    }

    private function formatTypeLabel(string $type): string
    {
        $labels = [
            'weapon_skin' => 'Weapon Skins',
            'sticker' => 'Stickers',
            'patch' => 'Patches',
            'agent' => 'Agents',
            'glove' => 'Gloves',
            'case' => 'Cases',
            'container' => 'Containers',
            'key' => 'Keys',
            'souvenir' => 'Souvenirs',
        ];

        return $labels[$type] ?? ucfirst(str_replace('_', ' ', $type));
    }

    private function getTypeColor(string $type): string
    {
        $colors = [
            'weapon_skin' => '#3b82f6',
            'sticker' => '#ec4899',
            'patch' => '#f59e0b',
            'agent' => '#10b981',
            'glove' => '#8b5cf6',
            'case' => '#06b6d4',
            'container' => '#6366f1',
            'key' => '#f97316',
            'souvenir' => '#a855f7',
        ];

        return $colors[$type] ?? '#6b7280';
    }
}
