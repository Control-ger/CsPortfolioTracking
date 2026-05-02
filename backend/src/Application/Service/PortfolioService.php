<?php
declare(strict_types=1);

namespace App\Application\Service;

use App\Infrastructure\Persistence\Repository\InvestmentRepository;
use App\Infrastructure\Persistence\Repository\ExchangeRateRepository;
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
        private readonly ExchangeRateRepository $exchangeRateRepository,
        private readonly PositionHistoryRepository $positionHistoryRepository,
        private readonly PortfolioHistoryRepository $portfolioHistoryRepository,
        private readonly PriceHistoryRepository $priceHistoryRepository,
        private readonly PricingService $pricingService,
        private readonly FeeSettingsService $feeSettingsService
    ) {
    }

    public function getEnrichedInvestments(int $userId = 1, bool $aggregateByName = false): array
    {
        $this->ensurePriceHistoryTable();

        $investments = $this->investmentRepository->findAll($userId);
        $feeSettings = $this->feeSettingsService->getSettings($userId);
        $rows = [];
        $snapshotTime = $this->currentHourBucket();

        foreach ($investments as $investment) {
            $itemId = (int) ($investment['item_id'] ?? 0);
            $name = (string) ($investment['name'] ?? '');
            $buyPriceUsd = isset($investment['buy_price_usd']) ? (float) $investment['buy_price_usd'] : null;
            $usdToEurRate = $this->pricingService->getUsdToEurRate();
            $buyPrice = $buyPriceUsd !== null ? round($buyPriceUsd * $usdToEurRate, 2) : 0.0;
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

            $this->persistPriceHistorySnapshot($itemId, $snapshotTime, $presentation, $priceSource);

            $changeMetrics = $this->buildChangeMetrics($itemId, $livePrice);

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
                'itemId' => $itemId,
                'name' => $name,
                'type' => (string) $investment['type'],
                'imageUrl' => $presentation['iconUrl'] ?? null,
                'marketTypeLabel' => $presentation['marketTypeLabel'] ?? null,
                'wearName' => $presentation['wearLabel'] ?? null,
                'buyPrice' => $buyPrice,
                'buyPriceUsd' => $buyPriceUsd,
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

        if ($aggregateByName) {
            return $this->aggregateInvestmentsByName($rows);
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

    public function getHistory(int $userId = 1): array
    {
        $this->portfolioHistoryRepository->ensureTable();
        $rows = $this->portfolioHistoryRepository->findAll($userId);
        return array_map(
            static fn(array $row): array => [
                'id' => (int) $row['id'],
                'date' => self::formatSnapshotDate((string) $row['date']),
                'wert' => (float) $row['total_value_usd'],
                'invested' => (float) ($row['invested_value_usd'] ?? 0.0),
                'growthPercent' => self::calculateGrowthPercent(
                    (float) ($row['total_value_usd'] ?? 0.0),
                    (float) ($row['invested_value_usd'] ?? 0.0)
                ),
            ],
            $rows
        );
    }

    public function getInvestmentHistory(int $userId = 1, int $itemId = 0): array
    {
        $this->positionHistoryRepository->ensureTable();
        $rows = $itemId > 0 ? $this->positionHistoryRepository->findHistoryByItemId($userId, $itemId) : [];

        return array_map(
            static fn(array $row): array => [
                'date' => self::formatSnapshotDate((string) $row['date']),
                'wert' => ((float) ($row['quantity_open'] ?? 0.0)) * ((float) ($row['avg_buy_price_usd'] ?? 0.0)),
                'quantity' => (int) $row['quantity_open'],
                'unitPrice' => (float) $row['avg_buy_price_usd'],
                'invested' => ((float) ($row['quantity_open'] ?? 0.0)) * ((float) ($row['avg_buy_price_usd'] ?? 0.0)),
                'growthPercent' => 0.0,
            ],
            $rows
        );
    }

    public function consumePricingWarnings(): array
    {
        return $this->pricingService->consumeWarnings();
    }

    public function saveDailyValue(int $userId = 1, ?float $value = null): array
    {
        $this->portfolioHistoryRepository->ensureTable();
        $this->positionHistoryRepository->ensureTable();
        $rows = $this->getEnrichedInvestments($userId);
        $summary = $this->getSummary($rows);
        $totalValue = $value ?? $summary->totalValue;
        $totalInvested = $summary->totalInvested;
        $snapshotTime = $this->currentHourBucket();
        $portfolioGrowthPercent = self::calculateGrowthPercent($totalValue, $totalInvested);
        $feeSettings = $this->feeSettingsService->getSettings($userId);
        $feeSettingId = (int) ($feeSettings['id'] ?? 0);
        $exchangeRateId = $this->exchangeRateRepository->ensureTodayRate($this->pricingService->getUsdToEurRate());
        $this->portfolioHistoryRepository->upsertForDate($userId, $snapshotTime, $feeSettingId, $totalValue, $totalInvested, 0.0);
        foreach ($rows as $row) {
            $this->positionHistoryRepository->upsertSnapshot(
                $userId,
                (int) ($row['itemId'] ?? 0),
                $snapshotTime,
                (int) $row['quantity'],
                (float) ($row['buyPriceUsd'] ?? 0.0),
                $exchangeRateId
            );
        }

        Logger::event(
            'info',
            'domain',
            'domain.portfolio.daily_value_saved',
            'Portfolio daily value saved',
            [
                'date' => $snapshotTime,
                'totalValue' => $totalValue,
                'growthPercent' => $portfolioGrowthPercent,
                'positions' => count($rows),
            ]
        );

        return ['date' => $snapshotTime, 'totalValue' => $totalValue, 'growthPercent' => $portfolioGrowthPercent];
    }

    public function getComposition(int $userId = 1): array
    {
        $investments = $this->getEnrichedInvestments($userId);
        $composition = [];
        $totalValue = 0.0;

        foreach ($investments as $investment) {
            $name = (string) $investment['name'];
            $itemId = (int) ($investment['itemId'] ?? 0);
            $type = (string) $investment['type'];
            $currentValue = (float) $investment['currentValue'];
            $totalValue += $currentValue;

            $key = $itemId > 0 ? (string) $itemId : $name;
            if (!isset($composition[$key])) {
                $composition[$key] = [
                    'count' => 0,
                    'value' => 0.0,
                    'type' => $type,
                    'name' => $name,
                ];
            }

            $composition[$key]['count'] += (int) $investment['quantity'];
            $composition[$key]['value'] += $currentValue;
        }

        $result = [];
        foreach ($composition as $data) {
            $percentage = $totalValue > 0 ? ($data['value'] / $totalValue) * 100 : 0;
            $result[] = [
                'name' => $data['name'],
                'type' => $data['type'],
                'count' => $data['count'],
                'value' => round($data['value'], 2),
                'percentage' => round($percentage, 1),
                'color' => $this->getTypeColor($data['type']),
            ];
        }

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
        int $itemId,
        string $date,
        array $presentation,
        ?string $priceSource
    ): void {
        $priceUsd = $presentation['priceUsd'] ?? null;
        $exchangeRate = $presentation['exchangeRate'] ?? null;
        $exchangeRateId = $this->exchangeRateRepository->ensureTodayRate((float) ($exchangeRate ?? $this->pricingService->getUsdToEurRate()));

        if ($priceUsd === null || $priceUsd <= 0 || $itemId <= 0) {
            return;
        }

        $this->priceHistoryRepository->upsertPrice(
            $itemId,
            $date,
            $priceUsd,
            $exchangeRateId,
            $priceSource
        );
    }

    private function buildChangeMetrics(int $itemId, ?float $currentPrice): array
    {
        $metrics = [
            '24h' => ['amount' => null, 'percent' => null, 'baselinePrice' => null, 'windowDays' => 1],
            '7d' => ['amount' => null, 'percent' => null, 'baselinePrice' => null, 'windowDays' => 7],
            '30d' => ['amount' => null, 'percent' => null, 'baselinePrice' => null, 'windowDays' => 30],
        ];

        if ($itemId <= 0 || $currentPrice === null || $currentPrice <= 0) {
            return $metrics;
        }

        foreach ($metrics as $label => $metric) {
            $beforeDate = date('Y-m-d H:i:s', strtotime('-' . $metric['windowDays'] . ' days'));
            $baselinePrice = $this->priceHistoryRepository->findLatestPriceByItemId($itemId, $beforeDate);
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

    private function aggregateInvestmentsByName(array $rows): array
    {
        $groups = [];

        foreach ($rows as $row) {
            $name = trim((string) ($row['name'] ?? ''));
            $key = strtolower($name !== '' ? $name : ('id_' . (string) ($row['id'] ?? '0')));

            $quantity = max(0, (int) ($row['quantity'] ?? 0));
            $totalInvested = (float) ($row['totalInvested'] ?? (((float) ($row['buyPrice'] ?? 0.0)) * $quantity));
            $currentValue = (float) ($row['currentValue'] ?? (((float) ($row['displayPrice'] ?? 0.0)) * $quantity));
            $costBasisTotal = (float) ($row['costBasisTotal'] ?? $totalInvested);
            $netPositionValue = (float) ($row['netPositionValue'] ?? $currentValue);
            $acquisitionFees = (float) ($row['appliedFees']['acquisitionFees'] ?? 0.0);

            if (!isset($groups[$key])) {
                $groups[$key] = [
                    'base' => $row,
                    'quantity' => 0,
                    'totalInvested' => 0.0,
                    'currentValue' => 0.0,
                    'costBasisTotal' => 0.0,
                    'netPositionValue' => 0.0,
                    'acquisitionFees' => 0.0,
                    'change24hEuro' => 0.0,
                    'change7dEuro' => 0.0,
                    'change30dEuro' => 0.0,
                    'change24hPercentWeighted' => 0.0,
                    'change7dPercentWeighted' => 0.0,
                    'change30dPercentWeighted' => 0.0,
                    'lastPriceUpdateAt' => $row['lastPriceUpdateAt'] ?? null,
                    'maxPriceAgeSeconds' => isset($row['priceAgeSeconds']) && is_numeric($row['priceAgeSeconds']) ? (int) $row['priceAgeSeconds'] : null,
                ];
            }

            $groups[$key]['quantity'] += $quantity;
            $groups[$key]['totalInvested'] += $totalInvested;
            $groups[$key]['currentValue'] += $currentValue;
            $groups[$key]['costBasisTotal'] += $costBasisTotal;
            $groups[$key]['netPositionValue'] += $netPositionValue;
            $groups[$key]['acquisitionFees'] += $acquisitionFees;
            $groups[$key]['change24hEuro'] += (float) (($row['change24hEuro'] ?? 0.0) * $quantity);
            $groups[$key]['change7dEuro'] += (float) (($row['change7dEuro'] ?? 0.0) * $quantity);
            $groups[$key]['change30dEuro'] += (float) (($row['change30dEuro'] ?? 0.0) * $quantity);
            $groups[$key]['change24hPercentWeighted'] += (float) (($row['change24hPercent'] ?? 0.0) * $quantity);
            $groups[$key]['change7dPercentWeighted'] += (float) (($row['change7dPercent'] ?? 0.0) * $quantity);
            $groups[$key]['change30dPercentWeighted'] += (float) (($row['change30dPercent'] ?? 0.0) * $quantity);

            $existingUpdatedAt = (string) ($groups[$key]['lastPriceUpdateAt'] ?? '');
            $candidateUpdatedAt = (string) ($row['lastPriceUpdateAt'] ?? '');
            if ($candidateUpdatedAt !== '' && ($existingUpdatedAt === '' || strtotime($candidateUpdatedAt) > strtotime($existingUpdatedAt))) {
                $groups[$key]['lastPriceUpdateAt'] = $candidateUpdatedAt;
            }

            if (isset($row['priceAgeSeconds']) && is_numeric($row['priceAgeSeconds'])) {
                $candidateAge = (int) $row['priceAgeSeconds'];
                $currentMaxAge = $groups[$key]['maxPriceAgeSeconds'];
                if ($currentMaxAge === null || $candidateAge > $currentMaxAge) {
                    $groups[$key]['maxPriceAgeSeconds'] = $candidateAge;
                }
            }
        }

        $result = [];

        foreach ($groups as $group) {
            $base = $group['base'];
            $quantity = max(1, (int) $group['quantity']);
            $totalInvested = (float) $group['totalInvested'];
            $currentValue = (float) $group['currentValue'];
            $displayPrice = $currentValue / $quantity;
            $buyPrice = $totalInvested / $quantity;
            $profitEuro = $currentValue - $totalInvested;
            $roi = $totalInvested > 0 ? ($profitEuro / $totalInvested) * 100 : 0.0;

            $costBasisTotal = (float) $group['costBasisTotal'];
            $costBasisUnit = $costBasisTotal / $quantity;
            $netPositionValue = (float) $group['netPositionValue'];
            $netProfitEuro = $netPositionValue - $costBasisTotal;
            $netRoiPercent = $costBasisTotal > 0 ? ($netProfitEuro / $costBasisTotal) * 100 : 0.0;
            $breakEvenPrice = $buyPrice;
            $breakEvenPriceNet = $this->calculateBreakEvenNetUnitPrice($costBasisUnit, $base['appliedFees'] ?? []);

            $priceAgeSeconds = $group['maxPriceAgeSeconds'];
            $freshnessStatus = $this->resolveFreshnessStatus($priceAgeSeconds, (bool) ($base['isLive'] ?? false));

            $change24hPercent = $group['change24hPercentWeighted'] / $quantity;
            $change7dPercent = $group['change7dPercentWeighted'] / $quantity;
            $change30dPercent = $group['change30dPercentWeighted'] / $quantity;

            $result[] = array_merge($base, [
                'quantity' => $quantity,
                'buyPrice' => $buyPrice,
                'livePrice' => isset($base['livePrice']) && $base['livePrice'] !== null ? $displayPrice : null,
                'displayPrice' => $displayPrice,
                'roi' => $roi,
                'totalInvested' => $totalInvested,
                'currentValue' => $currentValue,
                'profitEuro' => $profitEuro,
                'isProfitPositive' => $profitEuro >= 0,
                'breakEvenPrice' => $breakEvenPrice,
                'breakEvenDeltaEuro' => $displayPrice - $breakEvenPrice,
                'breakEvenDeltaPercent' => $breakEvenPrice > 0 ? (($displayPrice - $breakEvenPrice) / $breakEvenPrice) * 100 : null,
                'costBasisTotal' => $costBasisTotal,
                'costBasisUnit' => $costBasisUnit,
                'netPositionValue' => $netPositionValue,
                'netProfitEuro' => $netProfitEuro,
                'netRoiPercent' => $netRoiPercent,
                'breakEvenPriceNet' => $breakEvenPriceNet,
                'change24hEuro' => $group['change24hEuro'] / $quantity,
                'change24hPercent' => $change24hPercent,
                'change7dEuro' => $group['change7dEuro'] / $quantity,
                'change7dPercent' => $change7dPercent,
                'change30dEuro' => $group['change30dEuro'] / $quantity,
                'change30dPercent' => $change30dPercent,
                'changes' => [
                    '24h' => ['amount' => $group['change24hEuro'] / $quantity, 'percent' => $change24hPercent, 'baselinePrice' => null, 'windowDays' => 1],
                    '7d' => ['amount' => $group['change7dEuro'] / $quantity, 'percent' => $change7dPercent, 'baselinePrice' => null, 'windowDays' => 7],
                    '30d' => ['amount' => $group['change30dEuro'] / $quantity, 'percent' => $change30dPercent, 'baselinePrice' => null, 'windowDays' => 30],
                ],
                'lastPriceUpdateAt' => $group['lastPriceUpdateAt'],
                'priceAgeSeconds' => $priceAgeSeconds,
                'freshnessStatus' => $freshnessStatus,
                'freshnessLabel' => $this->resolveFreshnessLabel($freshnessStatus, $priceAgeSeconds),
                'appliedFees' => array_merge($base['appliedFees'] ?? [], [
                    'acquisitionFees' => $group['acquisitionFees'],
                ]),
            ]);
        }

        usort($result, static fn (array $left, array $right): int => strcmp((string) ($left['name'] ?? ''), (string) ($right['name'] ?? '')));

        return $result;
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

    private function currentHourBucket(): string
    {
        return date('Y-m-d H:00:00');
    }

    private static function formatSnapshotDate(string $value): string
    {
        $trimmed = trim($value);

        if ($trimmed === '') {
            return $trimmed;
        }

        if (str_contains($trimmed, 'T')) {
            return $trimmed;
        }

        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $trimmed) === 1) {
            return $trimmed . 'T00:00:00';
        }

        if (preg_match('/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/', $trimmed) === 1) {
            return str_replace(' ', 'T', $trimmed);
        }

        return $trimmed;
    }

    private static function calculateGrowthPercent(float $totalValue, float $investedValue): float
    {
        if ($investedValue <= 0.0) {
            return 0.0;
        }

        return (($totalValue - $investedValue) / $investedValue) * 100;
    }

    public function toggleExcludeInvestment(int $userId = 1, int $id = 0, bool $exclude = false): bool
    {
        return false;
    }
}
