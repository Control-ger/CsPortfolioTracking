<?php
declare(strict_types=1);

namespace App\Application\Service;

use App\Infrastructure\Persistence\Repository\InvestmentRepository;
use App\Infrastructure\Persistence\Repository\PositionHistoryRepository;
use App\Infrastructure\Persistence\Repository\PortfolioHistoryRepository;
use App\Infrastructure\Persistence\Repository\PriceHistoryRepository;
use App\Shared\Dto\PortfolioSummaryDto;
use App\Shared\Logger;

final class PortfolioService
{
    private const FRESH_THRESHOLD_SECONDS = 600;
    private const AGING_THRESHOLD_SECONDS = 3600;

    private bool $priceHistoryReady = false;

    public function __construct(
        private readonly InvestmentRepository $investmentRepository,
        private readonly PositionHistoryRepository $positionHistoryRepository,
        private readonly PortfolioHistoryRepository $portfolioHistoryRepository,
        private readonly PriceHistoryRepository $priceHistoryRepository,
        private readonly PricingService $pricingService,
        private readonly FeeSettingsService $feeSettingsService
    ) {
    }

    public function getEnrichedInvestments(): array
    {
        $this->ensurePriceHistoryTable();

        $investments = $this->investmentRepository->findAll();
        $feeSettings = $this->feeSettingsService->getSettings();
        $rows = [];
        $today = date('Y-m-d');

        foreach ($investments as $investment) {
            $name = (string) ($investment['name'] ?? '');
            $buyPrice = (float) ($investment['buy_price'] ?? 0);
            $quantity = (int) ($investment['quantity'] ?? 0);
            $presentation = $this->pricingService->getItemPresentation($name);
            $livePrice = isset($presentation['priceEur']) ? (float) $presentation['priceEur'] : null;
            $priceSource = isset($presentation['priceSource']) ? (string) $presentation['priceSource'] : null;
            $displayPrice = $livePrice ?? $buyPrice;
            $isLive = $livePrice !== null;
            $roi = $buyPrice > 0 ? (($displayPrice - $buyPrice) / $buyPrice) * 100 : 0.0;
            $fundingMode = $this->normalizeFundingMode($investment['funding_mode'] ?? null);
            $totalInvested = $buyPrice * $quantity;
            $currentValue = $displayPrice * $quantity;
            $profitEuro = $currentValue - $totalInvested;
            $breakEvenPrice = $quantity > 0 ? $totalInvested / $quantity : $buyPrice;
            $breakEvenDeltaEuro = $displayPrice - $breakEvenPrice;
            $breakEvenDeltaPercent = $breakEvenPrice > 0
                ? ($breakEvenDeltaEuro / $breakEvenPrice) * 100
                : null;

            $this->persistPriceHistorySnapshot($name, $today, $presentation, $priceSource);

            $changeMetrics = $this->buildChangeMetrics($name, $livePrice);

            $fetchedAt = isset($presentation['fetchedAt']) ? (string) $presentation['fetchedAt'] : null;
            $priceAgeSeconds = $this->resolveFreshnessSeconds($fetchedAt);
            $freshnessStatus = $this->resolveFreshnessStatus($priceAgeSeconds, $isLive);

            $acquisitionFees = $this->resolveAcquisitionFees($totalInvested, $fundingMode, $feeSettings);
            $costBasisTotal = $totalInvested + $acquisitionFees;
            $costBasisUnit = $quantity > 0 ? ($costBasisTotal / $quantity) : 0.0;
            $netPositionValue = $this->calculateNetProceeds($currentValue, $feeSettings);
            $netProfitEuro = $netPositionValue - $costBasisTotal;
            $netRoiPercent = $costBasisTotal > 0 ? ($netProfitEuro / $costBasisTotal) * 100 : 0.0;
            $breakEvenPriceNet = $this->calculateBreakEvenNetUnitPrice($costBasisUnit, $feeSettings);

            $rows[] = [
                'id' => (int) $investment['id'],
                'name' => $name,
                'type' => (string) $investment['type'],
                'imageUrl' => $presentation['iconUrl'] ?? null,
                'marketTypeLabel' => $presentation['marketTypeLabel'] ?? null,
                'wearName' => $presentation['wearLabel'] ?? null,
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
                'breakEvenPrice' => $breakEvenPrice,
                'breakEvenDeltaEuro' => $breakEvenDeltaEuro,
                'breakEvenDeltaPercent' => $breakEvenDeltaPercent,
                'fundingMode' => $fundingMode,
                'costBasisTotal' => $costBasisTotal,
                'costBasisUnit' => $costBasisUnit,
                'netPositionValue' => $netPositionValue,
                'netProfitEuro' => $netProfitEuro,
                'netRoiPercent' => $netRoiPercent,
                'breakEvenPriceNet' => $breakEvenPriceNet,
                'appliedFees' => [
                    'fxFeePercent' => (float) $feeSettings['fxFeePercent'],
                    'sellerFeePercent' => (float) $feeSettings['sellerFeePercent'],
                    'withdrawalFeePercent' => (float) $feeSettings['withdrawalFeePercent'],
                    'depositFeePercent' => (float) $feeSettings['depositFeePercent'],
                    'depositFeeFixedEur' => (float) $feeSettings['depositFeeFixedEur'],
                    'acquisitionFees' => $acquisitionFees,
                    'source' => $feeSettings['source'] ?? 'defaults',
                ],
                'change24hEuro' => $changeMetrics['24h']['amount'],
                'change24hPercent' => $changeMetrics['24h']['percent'],
                'change7dEuro' => $changeMetrics['7d']['amount'],
                'change7dPercent' => $changeMetrics['7d']['percent'],
                'change30dEuro' => $changeMetrics['30d']['amount'],
                'change30dPercent' => $changeMetrics['30d']['percent'],
                'changes' => $changeMetrics,
                'lastPriceUpdateAt' => $fetchedAt,
                'priceAgeSeconds' => $priceAgeSeconds,
                'freshnessStatus' => $freshnessStatus,
                'freshnessLabel' => $this->resolveFreshnessLabel($freshnessStatus, $priceAgeSeconds),
            ];
        }

        return $rows;
    }

    public function getSummary(array $rows): PortfolioSummaryDto
    {
        $totalValue = 0.0;
        $totalInvested = 0.0;
        $totalCostBasis = 0.0;
        $totalQuantity = 0;
        $totalNetValue = 0.0;
        $liveItemsCount = 0;
        $staleLiveItemsCount = 0;
        $freshestDataAgeSeconds = null;
        $oldestDataAgeSeconds = null;

        foreach ($rows as $row) {
            $totalValue += ((float) $row['displayPrice']) * ((int) $row['quantity']);
            $totalInvested += ((float) $row['buyPrice']) * ((int) $row['quantity']);
            $totalCostBasis += (float) ($row['costBasisTotal'] ?? (((float) $row['buyPrice']) * ((int) $row['quantity'])));
            $totalQuantity += (int) $row['quantity'];
            $totalNetValue += (float) ($row['netPositionValue'] ?? (((float) $row['displayPrice']) * ((int) $row['quantity'])));

            if (($row['isLive'] ?? false) !== true) {
                continue;
            }

            $liveItemsCount++;
            if (($row['freshnessStatus'] ?? '') === 'stale') {
                $staleLiveItemsCount++;
            }

            if (!isset($row['priceAgeSeconds']) || !is_numeric($row['priceAgeSeconds'])) {
                continue;
            }

            $age = (int) $row['priceAgeSeconds'];
            if ($freshestDataAgeSeconds === null || $age < $freshestDataAgeSeconds) {
                $freshestDataAgeSeconds = $age;
            }
            if ($oldestDataAgeSeconds === null || $age > $oldestDataAgeSeconds) {
                $oldestDataAgeSeconds = $age;
            }
        }

        $totalProfitEuro = $totalValue - $totalInvested;
        $totalRoiPercent = $totalInvested > 0 ? ($totalProfitEuro / $totalInvested) * 100 : 0.0;
        $totalNetProfitEuro = $totalNetValue - $totalCostBasis;
        $totalNetRoiPercent = $totalCostBasis > 0 ? ($totalNetProfitEuro / $totalCostBasis) * 100 : 0.0;
        $isPositive = $totalProfitEuro >= 0;
        $staleLiveItemsRatioPercent = $liveItemsCount > 0
            ? ($staleLiveItemsCount / $liveItemsCount) * 100
            : 0.0;

        return new PortfolioSummaryDto(
            totalValue: $totalValue,
            totalInvested: $totalInvested,
            totalQuantity: $totalQuantity,
            totalProfitEuro: $totalProfitEuro,
            totalRoiPercent: $totalRoiPercent,
            totalNetValue: $totalNetValue,
            totalNetProfitEuro: $totalNetProfitEuro,
            totalNetRoiPercent: $totalNetRoiPercent,
            isPositive: $isPositive,
            chartColor: $isPositive ? '#22c55e' : '#ef4444',
            liveItemsCount: $liveItemsCount,
            staleLiveItemsCount: $staleLiveItemsCount,
            staleLiveItemsRatioPercent: $staleLiveItemsRatioPercent,
            freshestDataAgeSeconds: $freshestDataAgeSeconds,
            oldestDataAgeSeconds: $oldestDataAgeSeconds
        );
    }

    public function getHistory(): array
    {
        $this->portfolioHistoryRepository->ensureTable();
        $rows = $this->portfolioHistoryRepository->findAll();
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
        $this->portfolioHistoryRepository->ensureTable();
        $this->positionHistoryRepository->ensureTable();
        $rows = $this->getEnrichedInvestments();
        $summary = $this->getSummary($rows);
        $totalValue = $value ?? $summary->totalValue;
        $today = date('Y-m-d');
        $this->portfolioHistoryRepository->upsertForDate($today, $totalValue);
        foreach ($rows as $row) {
            $this->positionHistoryRepository->upsertSnapshot(
                investmentId: (int) $row['id'],
                date: $today,
                quantity: (int) $row['quantity'],
                unitPrice: (float) $row['displayPrice'],
                totalValue: (float) $row['currentValue']
            );
        }

        Logger::event(
            'info',
            'domain',
            'domain.portfolio.daily_value_saved',
            'Portfolio daily value saved',
            [
                'date' => $today,
                'totalValue' => $totalValue,
                'positions' => count($rows),
            ]
        );

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

    private function ensurePriceHistoryTable(): void
    {
        if ($this->priceHistoryReady) {
            return;
        }

        $this->priceHistoryRepository->ensureTable();
        $this->priceHistoryReady = true;
    }

    private function persistPriceHistorySnapshot(
        string $itemName,
        string $date,
        array $presentation,
        ?string $priceSource
    ): void {
        $priceEur = $presentation['priceEur'] ?? null;
        $priceUsd = $presentation['priceUsd'] ?? null;
        $exchangeRate = $presentation['exchangeRate'] ?? null;

        if (
            $priceEur === null || $priceEur <= 0
            || $priceUsd === null || $priceUsd <= 0
            || $exchangeRate === null || $exchangeRate <= 0
            || $itemName === ''
        ) {
            return;
        }

        $this->priceHistoryRepository->upsertPrice(
            $itemName,
            $date,
            $priceUsd,
            $priceEur,
            $exchangeRate,
            $priceSource
        );
    }

    private function buildChangeMetrics(string $itemName, ?float $currentPrice): array
    {
        $metrics = [
            '24h' => ['amount' => null, 'percent' => null, 'baselinePrice' => null, 'windowDays' => 1],
            '7d' => ['amount' => null, 'percent' => null, 'baselinePrice' => null, 'windowDays' => 7],
            '30d' => ['amount' => null, 'percent' => null, 'baselinePrice' => null, 'windowDays' => 30],
        ];

        if ($itemName === '' || $currentPrice === null || $currentPrice <= 0) {
            return $metrics;
        }

        foreach ($metrics as $label => $metric) {
            $beforeDate = date('Y-m-d', strtotime('-' . $metric['windowDays'] . ' days'));
            $baselinePrice = $this->priceHistoryRepository->findLatestPriceByItem($itemName, $beforeDate);
            $metrics[$label]['baselinePrice'] = $baselinePrice;

            if ($baselinePrice === null || $baselinePrice <= 0) {
                continue;
            }

            $amount = $currentPrice - $baselinePrice;
            $metrics[$label]['amount'] = $amount;
            $metrics[$label]['percent'] = ($amount / $baselinePrice) * 100;
        }

        return $metrics;
    }

    private function resolveFreshnessSeconds(?string $fetchedAt): ?int
    {
        if (!is_string($fetchedAt) || trim($fetchedAt) === '') {
            return null;
        }

        $timestamp = strtotime($fetchedAt);
        if ($timestamp === false) {
            return null;
        }

        return max(0, time() - $timestamp);
    }

    private function resolveFreshnessStatus(?int $ageSeconds, bool $isLive): string
    {
        if (!$isLive || $ageSeconds === null) {
            return 'unknown';
        }

        if ($ageSeconds <= self::FRESH_THRESHOLD_SECONDS) {
            return 'fresh';
        }

        if ($ageSeconds <= self::AGING_THRESHOLD_SECONDS) {
            return 'aging';
        }

        return 'stale';
    }

    private function resolveFreshnessLabel(string $status, ?int $ageSeconds): string
    {
        if ($status === 'unknown') {
            return 'keine live daten';
        }

        if ($ageSeconds === null) {
            return 'unbekannt';
        }

        $minutes = (int) floor($ageSeconds / 60);

        return match ($status) {
            'fresh' => sprintf('frisch (%d min)', $minutes),
            'aging' => sprintf('alternd (%d min)', $minutes),
            'stale' => sprintf('veraltet (%d min)', $minutes),
            default => 'unbekannt',
        };
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

    private function normalizeFundingMode(mixed $value): string
    {
        return in_array($value, ['cash_in', 'wallet_funded'], true)
            ? (string) $value
            : 'wallet_funded';
    }

    private function resolveAcquisitionFees(float $totalInvested, string $fundingMode, array $settings): float
    {
        if ($fundingMode !== 'cash_in' || $totalInvested <= 0) {
            return 0.0;
        }

        $depositPercent = max(0.0, ((float) ($settings['depositFeePercent'] ?? 0.0)) / 100.0);
        $fxPercent = max(0.0, ((float) ($settings['fxFeePercent'] ?? 0.0)) / 100.0);
        $depositFixed = max(0.0, (float) ($settings['depositFeeFixedEur'] ?? 0.0));

        return ($totalInvested * $depositPercent) + ($totalInvested * $fxPercent) + $depositFixed;
    }

    private function calculateNetProceeds(float $grossSell, array $settings): float
    {
        $sellerFeeRate = max(0.0, ((float) ($settings['sellerFeePercent'] ?? 0.0)) / 100.0);
        $withdrawalFeeRate = max(0.0, ((float) ($settings['withdrawalFeePercent'] ?? 0.0)) / 100.0);

        $afterSeller = $grossSell * (1 - $sellerFeeRate);
        return $afterSeller * (1 - $withdrawalFeeRate);
    }

    private function calculateBreakEvenNetUnitPrice(float $costBasisUnit, array $settings): ?float
    {
        if ($costBasisUnit <= 0) {
            return null;
        }

        $sellerFeeRate = max(0.0, ((float) ($settings['sellerFeePercent'] ?? 0.0)) / 100.0);
        $withdrawalFeeRate = max(0.0, ((float) ($settings['withdrawalFeePercent'] ?? 0.0)) / 100.0);
        $multiplier = (1 - $sellerFeeRate) * (1 - $withdrawalFeeRate);

        if ($multiplier <= 0) {
            return null;
        }

        return $costBasisUnit / $multiplier;
    }
}
