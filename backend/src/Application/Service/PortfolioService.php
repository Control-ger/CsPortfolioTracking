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
        private readonly FeeSettingsService $feeSettingsService,
        private readonly FeeCalculationService $feeCalculationService
    ) {
    }

    public function getEnrichedInvestments(
        int $userId = 1,
        bool $aggregateByName = false,
        string $scope = 'investments',
        bool $allowLiveRefresh = true
    ): array
    {
        $this->ensurePriceHistoryTable();

        $resolvedScope = $this->normalizeScope($scope);
        $investments = $this->investmentRepository->findAll($userId);
        $activeInvestments = [];
        foreach ($investments as $investment) {
            if ($this->isExcludedInvestment($investment)) {
                continue;
            }
            if ($resolvedScope === 'investments' && $this->resolveInvestmentBucket($investment) !== 'investment') {
                continue;
            }
            $activeInvestments[] = $investment;
        }

        $itemIds = array_values(array_unique(array_filter(array_map(
            static fn(array $investment): int => (int) ($investment['item_id'] ?? 0),
            $activeInvestments
        ), static fn(int $itemId): bool => $itemId > 0)));

        $baseline24h = $this->priceHistoryRepository->findLatestPriceMapByItemIds(
            $itemIds,
            date('Y-m-d H:i:s', strtotime('-1 days'))
        );
        $baseline7d = $this->priceHistoryRepository->findLatestPriceMapByItemIds(
            $itemIds,
            date('Y-m-d H:i:s', strtotime('-7 days'))
        );
        $baseline30d = $this->priceHistoryRepository->findLatestPriceMapByItemIds(
            $itemIds,
            date('Y-m-d H:i:s', strtotime('-30 days'))
        );

        $feeSettings = $this->feeSettingsService->getSettings($userId);
        $rows = [];
        $snapshotTime = $this->currentHourBucket();
        $presentationCache = [];

        foreach ($activeInvestments as $investment) {
            $excluded = false;
            $itemId = (int) ($investment['item_id'] ?? 0);
            $name = (string) ($investment['name'] ?? '');
            $investmentPayload = $this->decodeInvestmentPayload($investment);
            $instanceHint = $this->extractInstanceHint($investmentPayload);
            $presentationCacheKey = $this->buildPresentationCacheKey($name, $instanceHint);
            $buyPriceUsd = isset($investment['buy_price_usd']) ? (float) $investment['buy_price_usd'] : null;
            $usdToEurRate = $this->pricingService->getUsdToEurRate();
            $buyPrice = $buyPriceUsd !== null ? round($buyPriceUsd * $usdToEurRate, 2) : 0.0;
            $quantity = (int) ($investment['quantity'] ?? 0);
            if (!isset($presentationCache[$presentationCacheKey])) {
                $presentationCache[$presentationCacheKey] = $this->pricingService->getItemPresentation(
                    $name,
                    null,
                    $userId,
                    $instanceHint,
                    $allowLiveRefresh
                );
            }
            $presentation = $presentationCache[$presentationCacheKey];
            $livePrice = isset($presentation['priceEur']) ? (float) $presentation['priceEur'] : null;
            $baseLivePrice = $livePrice;
            $overpayProfile = $this->resolveOverpayProfile($investmentPayload);
            $priceSource = isset($presentation['priceSource']) ? (string) $presentation['priceSource'] : null;
            $displayPrice = $livePrice;
            $overpayApplied = false;
            if ($overpayProfile['enabled'] && $overpayProfile['floorEur'] !== null) {
                $overpayCandidatePrice = max($displayPrice, (float) $overpayProfile['floorEur']);
                if ($overpayCandidatePrice > $displayPrice) {
                    $overpayApplied = true;
                }
                $displayPrice = $overpayCandidatePrice;
                if ($baseLivePrice !== null) {
                    $livePrice = $overpayCandidatePrice;
                }
            }
            $isLive = $baseLivePrice !== null;
            $roi = ($isLive && $buyPrice > 0) ? (($displayPrice - $buyPrice) / $buyPrice) * 100 : null;
            $fundingMode = $this->normalizeFundingMode($investment['funding_mode'] ?? null);
            $totalInvested = $buyPrice * $quantity;
            $currentValue = $isLive ? ($displayPrice * $quantity) : 0.0;
            $profitEuro = $isLive ? ($currentValue - $totalInvested) : null;
            $breakEvenPrice = $quantity > 0 ? $totalInvested / $quantity : $buyPrice;
            $breakEvenDeltaEuro = $isLive ? ($displayPrice - $breakEvenPrice) : null;
            $breakEvenDeltaPercent = ($isLive && $breakEvenPrice > 0)
                ? ($breakEvenDeltaEuro / $breakEvenPrice) * 100
                : null;

            $this->persistPriceHistorySnapshot($itemId, $snapshotTime, $presentation, $priceSource);

            $changeMetrics = $this->buildChangeMetricsFromBaselines(
                $itemId,
                $isLive ? $displayPrice : null,
                $baseline24h,
                $baseline7d,
                $baseline30d
            );
            $bucket = $this->resolveInvestmentBucket($investment);

            $fetchedAt = isset($presentation['fetchedAt']) ? (string) $presentation['fetchedAt'] : null;
            $priceAgeSeconds = $this->resolveFreshnessSeconds($fetchedAt);
            $freshnessStatus = $this->resolveFreshnessStatus($priceAgeSeconds, $isLive);

            $acquisitionFees = $this->resolveAcquisitionFees($totalInvested, $fundingMode, $feeSettings);
            $costBasisTotal = $totalInvested + $acquisitionFees;
            $costBasisUnit = $quantity > 0 ? ($costBasisTotal / $quantity) : 0.0;
            $netPositionValue = $isLive ? $this->calculateNetProceeds($currentValue, $feeSettings) : 0.0;
            $netProfitEuro = $isLive ? ($netPositionValue - $costBasisTotal) : null;
            $netRoiPercent = ($isLive && $costBasisTotal > 0) ? ($netProfitEuro / $costBasisTotal) * 100 : null;
            $breakEvenPriceNet = $this->calculateBreakEvenNetUnitPrice($costBasisUnit, $feeSettings);

            $rows[] = [
                'id' => (int) $investment['id'],
                'itemId' => $itemId,
                'name' => $name,
                'type' => (string) $investment['type'],
                'bucket' => $bucket,
                'imageUrl' => $this->resolveInvestmentImageUrl($investmentPayload, $presentation['iconUrl'] ?? null),
                'marketTypeLabel' => $presentation['marketTypeLabel'] ?? null,
                'wearName' => $presentation['wearLabel'] ?? null,
                'buyPrice' => $buyPrice,
                'buyPriceUsd' => $buyPriceUsd,
                'quantity' => $quantity,
                'baseLivePrice' => $baseLivePrice,
                'livePrice' => $livePrice,
                'priceSource' => $priceSource,
                'priceScope' => $presentation['priceScope'] ?? 'item',
                'priceStrategy' => $presentation['priceStrategy'] ?? null,
                'priceConfidence' => $presentation['priceConfidence'] ?? null,
                'sampleSize' => $presentation['sampleSize'] ?? null,
                'overpayEnabled' => $overpayProfile['enabled'],
                'isOverpayCandidate' => $overpayProfile['enabled'],
                'overpayFloorEur' => $overpayProfile['floorEur'],
                'overpayNote' => $overpayProfile['note'],
                'overpayApplied' => $overpayApplied,
                'displayPrice' => $displayPrice,
                'roi' => $roi,
                'isLive' => $isLive,
                'pricingStatus' => $isLive ? ($priceSource ?? 'csfloat') : 'no_price',
                'totalInvested' => $totalInvested,
                'currentValue' => $currentValue,
                'profitEuro' => $profitEuro,
                'isProfitPositive' => $profitEuro !== null ? ($profitEuro >= 0) : null,
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
                'excluded' => $excluded,
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
        $comparableValue = 0.0;
        $comparableInvested = 0.0;
        $comparableNetValue = 0.0;
        $comparableCostBasis = 0.0;
        $liveItemsCount = 0;
        $staleLiveItemsCount = 0;
        $freshestDataAgeSeconds = null;
        $oldestDataAgeSeconds = null;

        foreach ($rows as $row) {
            $rowValue = ((float) $row['displayPrice']) * ((int) $row['quantity']);
            $rowInvested = ((float) $row['buyPrice']) * ((int) $row['quantity']);
            $rowCostBasis = (float) ($row['costBasisTotal'] ?? $rowInvested);
            $rowNetValue = (float) ($row['netPositionValue'] ?? $rowValue);

            $totalValue += $rowValue;
            $totalInvested += $rowInvested;
            $totalCostBasis += $rowCostBasis;
            $totalQuantity += (int) $row['quantity'];
            $totalNetValue += $rowNetValue;

            // Relative growth should only include rows with known cost basis.
            if ($rowInvested > 0.0 || $rowCostBasis > 0.0) {
                $comparableValue += $rowValue;
                $comparableInvested += $rowInvested;
                $comparableCostBasis += $rowCostBasis;
                $comparableNetValue += $rowNetValue;
            }

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

        $totalProfitEuro = $comparableValue - $comparableInvested;
        $totalRoiPercent = $comparableInvested > 0 ? ($totalProfitEuro / $comparableInvested) * 100 : 0.0;
        $totalNetProfitEuro = $comparableNetValue - $comparableCostBasis;
        $totalNetRoiPercent = $comparableCostBasis > 0 ? ($totalNetProfitEuro / $comparableCostBasis) * 100 : 0.0;
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

    public function getItemPriceHistory(int $itemId, ?string $fromDate = null): array
    {
        $this->ensurePriceHistoryTable();

        if ($itemId <= 0) {
            return [];
        }

        $resolvedFromDate = is_string($fromDate) && trim($fromDate) !== ''
            ? $fromDate
            : date('Y-m-d H:i:s', strtotime('-370 days'));

        return $this->priceHistoryRepository->findHistoryByItemId($itemId, $resolvedFromDate);
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

    public function refreshStalePrices(
        int $userId = 1,
        string $scope = 'investments',
        int $limit = 200
    ): array {
        $resolvedScope = $this->normalizeScope($scope);
        $resolvedLimit = max(1, min($limit, 2000));
        $rows = $this->getEnrichedInvestments($userId, false, $resolvedScope, false);

        $staleNames = [];
        foreach ($rows as $row) {
            if (!is_array($row)) {
                continue;
            }

            $name = trim((string) ($row['name'] ?? ''));
            if ($name === '') {
                continue;
            }

            if (strtolower((string) ($row['freshnessStatus'] ?? '')) !== 'stale') {
                continue;
            }

            if (isset($staleNames[$name])) {
                continue;
            }

            $staleNames[$name] = true;
            if (count($staleNames) >= $resolvedLimit) {
                break;
            }
        }

        $requested = count($staleNames);
        $updated = 0;
        foreach (array_keys($staleNames) as $name) {
            $snapshot = $this->pricingService->getLivePriceSnapshot($name, $userId);
            if ($snapshot !== null) {
                $updated++;
            }
        }

        return [
            'scope' => $resolvedScope,
            'limit' => $resolvedLimit,
            'staleItemsFound' => $requested,
            'requested' => $requested,
            'updated' => $updated,
        ];
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

    public function getComposition(int $userId = 1, string $scope = 'investments'): array
    {
        $investments = $this->getEnrichedInvestments($userId, false, $scope);
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

        // price_history_hourly references exchange_rates via FK; ensure parent table first.
        $this->exchangeRateRepository->ensureTable();
        $this->priceHistoryRepository->ensureTable();
        $this->priceHistoryReady = true;
    }

    private function persistPriceHistorySnapshot(
        int $itemId,
        string $date,
        array $presentation,
        ?string $priceSource
    ): void {
        if (strtolower(trim((string) ($presentation['priceScope'] ?? 'item'))) !== 'item') {
            // price_history_hourly remains item-level; instance-only valuations would corrupt shared baselines.
            return;
        }

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

    private function buildChangeMetricsFromBaselines(
        int $itemId,
        ?float $currentPrice,
        array $baseline24h,
        array $baseline7d,
        array $baseline30d
    ): array {
        $metrics = [
            '24h' => ['amount' => null, 'percent' => null, 'baselinePrice' => null, 'windowDays' => 1],
            '7d' => ['amount' => null, 'percent' => null, 'baselinePrice' => null, 'windowDays' => 7],
            '30d' => ['amount' => null, 'percent' => null, 'baselinePrice' => null, 'windowDays' => 30],
        ];

        if ($itemId <= 0 || $currentPrice === null || $currentPrice <= 0) {
            return $metrics;
        }

        $baselineMapByLabel = [
            '24h' => $baseline24h,
            '7d' => $baseline7d,
            '30d' => $baseline30d,
        ];

        foreach ($baselineMapByLabel as $label => $baselineMap) {
            $baselinePrice = isset($baselineMap[$itemId]) ? (float) $baselineMap[$itemId] : null;
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
            $bucket = strtolower(trim((string) ($row['bucket'] ?? 'investment')));
            $key = $bucket . ':' . strtolower($name !== '' ? $name : ('id_' . (string) ($row['id'] ?? '0')));

            $quantity = max(0, (int) ($row['quantity'] ?? 0));
            $totalInvested = (float) ($row['totalInvested'] ?? (((float) ($row['buyPrice'] ?? 0.0)) * $quantity));
            $currentValue = (float) ($row['currentValue'] ?? (((float) ($row['displayPrice'] ?? 0.0)) * $quantity));
            $costBasisTotal = (float) ($row['costBasisTotal'] ?? $totalInvested);
            $netPositionValue = (float) ($row['netPositionValue'] ?? $currentValue);
            $acquisitionFees = (float) ($row['appliedFees']['acquisitionFees'] ?? 0.0);

            if (!isset($groups[$key])) {
                $groups[$key] = [
                    'base' => $row,
                    'rowCount' => 0,
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
                    'instancePriceCount' => 0,
                    'priceStrategies' => [],
                    'priceConfidences' => [],
                    'overpayEnabled' => false,
                    'overpayApplied' => false,
                    'overpayFloorEur' => null,
                    'overpayNotes' => [],
                    'livePriceWeightedSum' => 0.0,
                    'livePriceWeightedQuantity' => 0,
                    'liveQuantity' => 0,
                ];
            }

            $groups[$key]['rowCount'] += 1;
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
            if (($row['isLive'] ?? false) === true) {
                $groups[$key]['liveQuantity'] += $quantity;
            }
            $rowOverpayEnabled = $this->toBooleanFlag($row['overpayEnabled'] ?? $row['isOverpayCandidate'] ?? false);
            $rowOverpayApplied = $this->toBooleanFlag($row['overpayApplied'] ?? false);
            $rowOverpayFloorEur = $this->normalizeOverpayFloorEur($row['overpayFloorEur'] ?? null);
            $rowOverpayNote = trim((string) ($row['overpayNote'] ?? ''));
            if ($rowOverpayEnabled) {
                $groups[$key]['overpayEnabled'] = true;
            }
            if ($rowOverpayApplied) {
                $groups[$key]['overpayApplied'] = true;
            }
            if ($rowOverpayFloorEur !== null) {
                $currentOverpayFloor = $groups[$key]['overpayFloorEur'];
                if ($currentOverpayFloor === null || $rowOverpayFloorEur > (float) $currentOverpayFloor) {
                    $groups[$key]['overpayFloorEur'] = $rowOverpayFloorEur;
                }
            }
            if ($rowOverpayNote !== '') {
                $groups[$key]['overpayNotes'][$rowOverpayNote] = true;
            }
            $rowBaseLivePrice = null;
            if (isset($row['baseLivePrice']) && is_numeric($row['baseLivePrice'])) {
                $rowBaseLivePrice = (float) $row['baseLivePrice'];
            } elseif (isset($row['livePrice']) && is_numeric($row['livePrice'])) {
                $rowBaseLivePrice = (float) $row['livePrice'];
            }
            if ($rowBaseLivePrice !== null && $quantity > 0) {
                $groups[$key]['livePriceWeightedSum'] += $rowBaseLivePrice * $quantity;
                $groups[$key]['livePriceWeightedQuantity'] += $quantity;
            }
            if (strtolower(trim((string) ($row['priceScope'] ?? 'item'))) === 'instance') {
                $groups[$key]['instancePriceCount'] += 1;
            }
            $strategy = trim((string) ($row['priceStrategy'] ?? ''));
            if ($strategy !== '') {
                $groups[$key]['priceStrategies'][$strategy] = true;
            }
            $confidence = trim((string) ($row['priceConfidence'] ?? ''));
            if ($confidence !== '') {
                $groups[$key]['priceConfidences'][$confidence] = true;
            }

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
            $hasLivePrice = (int) ($group['liveQuantity'] ?? 0) > 0;
            $displayPrice = $hasLivePrice ? ($currentValue / $quantity) : null;
            $buyPrice = $totalInvested / $quantity;
            $profitEuro = $hasLivePrice ? ($currentValue - $totalInvested) : null;
            $roi = ($hasLivePrice && $totalInvested > 0) ? ($profitEuro / $totalInvested) * 100 : null;

            $costBasisTotal = (float) $group['costBasisTotal'];
            $costBasisUnit = $costBasisTotal / $quantity;
            $netPositionValue = (float) $group['netPositionValue'];
            $netProfitEuro = $hasLivePrice ? ($netPositionValue - $costBasisTotal) : null;
            $netRoiPercent = ($hasLivePrice && $costBasisTotal > 0) ? ($netProfitEuro / $costBasisTotal) * 100 : null;
            $breakEvenPrice = $buyPrice;
            $breakEvenPriceNet = $this->calculateBreakEvenNetUnitPrice($costBasisUnit, $base['appliedFees'] ?? []);

            $priceAgeSeconds = $group['maxPriceAgeSeconds'];
            $freshnessStatus = $this->resolveFreshnessStatus($priceAgeSeconds, $hasLivePrice);
            $allInstanceScoped = ((int) ($group['rowCount'] ?? 0)) > 0
                && ((int) ($group['instancePriceCount'] ?? 0)) === ((int) ($group['rowCount'] ?? 0));
            $priceStrategies = array_keys((array) ($group['priceStrategies'] ?? []));
            $priceConfidences = array_keys((array) ($group['priceConfidences'] ?? []));
            $resolvedPriceStrategy = count($priceStrategies) === 1 ? $priceStrategies[0] : null;
            $resolvedPriceConfidence = count($priceConfidences) === 1 ? $priceConfidences[0] : null;

            $change24hPercent = $group['change24hPercentWeighted'] / $quantity;
            $change7dPercent = $group['change7dPercentWeighted'] / $quantity;
            $change30dPercent = $group['change30dPercentWeighted'] / $quantity;
            $baseLivePrice = $group['livePriceWeightedQuantity'] > 0
                ? ($group['livePriceWeightedSum'] / $group['livePriceWeightedQuantity'])
                : null;
            $overpayNotes = array_keys((array) ($group['overpayNotes'] ?? []));
            $resolvedOverpayNote = count($overpayNotes) === 1 ? $overpayNotes[0] : null;

            $result[] = array_merge($base, [
                'quantity' => $quantity,
                'buyPrice' => $buyPrice,
                'baseLivePrice' => $baseLivePrice,
                'livePrice' => $hasLivePrice ? $displayPrice : null,
                'displayPrice' => $displayPrice,
                'roi' => $roi,
                'overpayEnabled' => (bool) ($group['overpayEnabled'] ?? false),
                'isOverpayCandidate' => (bool) ($group['overpayEnabled'] ?? false),
                'overpayFloorEur' => isset($group['overpayFloorEur']) && is_numeric($group['overpayFloorEur'])
                    ? (float) $group['overpayFloorEur']
                    : null,
                'overpayApplied' => (bool) ($group['overpayApplied'] ?? false),
                'overpayNote' => $resolvedOverpayNote,
                'totalInvested' => $totalInvested,
                'currentValue' => $currentValue,
                'profitEuro' => $profitEuro,
                'isProfitPositive' => $profitEuro !== null ? ($profitEuro >= 0) : null,
                'breakEvenPrice' => $breakEvenPrice,
                'breakEvenDeltaEuro' => $displayPrice !== null ? ($displayPrice - $breakEvenPrice) : null,
                'breakEvenDeltaPercent' => ($displayPrice !== null && $breakEvenPrice > 0) ? (($displayPrice - $breakEvenPrice) / $breakEvenPrice) * 100 : null,
                'priceScope' => $allInstanceScoped ? 'instance' : 'item',
                'priceStrategy' => $resolvedPriceStrategy,
                'priceConfidence' => $resolvedPriceConfidence,
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
        return $this->feeCalculationService->resolveAcquisitionFees($totalInvested, $fundingMode, $settings);
    }

    private function calculateNetProceeds(float $grossSell, array $settings): float
    {
        return $this->feeCalculationService->calculateNetProceeds($grossSell, $settings);
    }

    private function calculateBreakEvenNetUnitPrice(float $costBasisUnit, array $settings): ?float
    {
        return $this->feeCalculationService->calculateBreakEvenNetUnitPrice($costBasisUnit, $settings);
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
        if ($id <= 0) {
            return false;
        }

        return $this->investmentRepository->updateExcludedFlag($userId, $id, $exclude);
    }

    public function updateInvestmentBucket(int $userId = 1, int $id = 0, string $bucket = 'investment'): bool
    {
        if ($id <= 0) {
            return false;
        }

        return $this->investmentRepository->updateBucket($userId, $id, $this->normalizeBucket($bucket));
    }

    public function updateInvestmentOverpayProfile(
        int $userId = 1,
        int $id = 0,
        bool $overpayEnabled = false,
        ?float $overpayFloorEur = null,
        ?string $overpayNote = null
    ): bool {
        if ($id <= 0) {
            return false;
        }

        return $this->investmentRepository->updateOverpayProfile(
            $userId,
            $id,
            $overpayEnabled,
            $this->normalizeOverpayFloorEur($overpayFloorEur),
            $overpayNote
        );
    }

    public function buildInvestmentSyncPayload(int $userId, int $id, ?bool $excluded = null, ?string $bucket = null): ?array
    {
        $row = $this->investmentRepository->findByUserAndId($userId, $id);
        if ($row === null) {
            return null;
        }

        $rawPayload = $row['raw_payload_json'] ?? null;
        $payload = [];
        if (is_string($rawPayload) && trim($rawPayload) !== '') {
            $decoded = json_decode($rawPayload, true);
            if (is_array($decoded)) {
                $payload = $decoded;
            }
        }

        $resolvedName = trim((string) ($row['name'] ?? ''));
        $resolvedType = trim((string) ($row['type'] ?? 'skin'));
        if ($resolvedType === '') {
            $resolvedType = 'skin';
        }

        $resolvedBucket = $bucket !== null
            ? $this->normalizeBucket($bucket)
            : $this->resolveInvestmentBucket($row);
        $resolvedExcluded = $excluded ?? $this->isExcludedInvestment($row);
        $resolvedOverpay = $this->resolveOverpayProfile($payload);

        return array_merge($payload, [
            'id' => (string) $id,
            'userId' => (string) $userId,
            'itemId' => isset($row['item_id']) ? (string) ((int) $row['item_id']) : null,
            'name' => $resolvedName,
            'marketHashName' => $resolvedName !== '' ? $resolvedName : (string) ($row['market_hash_name'] ?? ''),
            'type' => $resolvedType,
            'quantity' => max(1, (int) ($row['quantity'] ?? 1)),
            'buyPriceUsd' => isset($row['buy_price_usd']) ? (float) $row['buy_price_usd'] : 0.0,
            'fundingMode' => $this->normalizeFundingMode($row['funding_mode'] ?? null),
            'platform' => (string) ($row['platform'] ?? 'desktop_sync'),
            'externalTradeId' => (string) ($row['external_trade_id'] ?? $id),
            'purchasedAt' => (string) ($row['purchased_at'] ?? gmdate('c')),
            'imageUrl' => isset($row['image_url']) ? (string) $row['image_url'] : null,
            'bucket' => $resolvedBucket,
            'serverId' => $id,
            'excluded' => $resolvedExcluded,
            'isExcluded' => $resolvedExcluded,
            'overpayEnabled' => $resolvedOverpay['enabled'],
            'isOverpayCandidate' => $resolvedOverpay['enabled'],
            'overpayFloorEur' => $resolvedOverpay['floorEur'],
            'overpayNote' => $resolvedOverpay['note'],
            'updatedAt' => gmdate('c'),
        ]);
    }

    private function decodeInvestmentPayload(array $investment): array
    {
        $rawPayload = $investment['raw_payload_json'] ?? null;
        if (!is_string($rawPayload) || trim($rawPayload) === '') {
            return [];
        }

        $decoded = json_decode($rawPayload, true);
        return is_array($decoded) ? $decoded : [];
    }

    private function extractInstanceHint(array $payload): ?array
    {
        $floatValue = $this->resolveFloatValueFromPayload($payload);
        $paintSeed = $this->resolvePaintSeedFromPayload($payload);
        $inspectLink = trim((string) ($payload['inspectLink'] ?? $payload['inspect_link'] ?? ''));

        if ($floatValue === null && $paintSeed === null && $inspectLink === '') {
            return null;
        }

        return [
            'floatValue' => $floatValue,
            'paintSeed' => $paintSeed,
            'inspectLink' => $inspectLink !== '' ? $inspectLink : null,
        ];
    }

    private function resolveOverpayProfile(array $payload): array
    {
        return [
            'enabled' => false,
            'floorEur' => null,
            'note' => null,
        ];
    }

    private function buildPresentationCacheKey(string $name, ?array $instanceHint): string
    {
        $normalizedName = trim($name);
        if ($instanceHint === null) {
            return $normalizedName;
        }

        $floatPart = isset($instanceHint['floatValue']) && is_numeric($instanceHint['floatValue'])
            ? number_format((float) $instanceHint['floatValue'], 6, '.', '')
            : 'na';
        $seedPart = isset($instanceHint['paintSeed']) && is_numeric($instanceHint['paintSeed'])
            ? (string) (int) $instanceHint['paintSeed']
            : 'na';

        return $normalizedName . '|f:' . $floatPart . '|s:' . $seedPart;
    }

    private function resolveInvestmentImageUrl(array $payload, ?string $fallbackImageUrl): ?string
    {
        foreach (['imageUrl', 'image_url', 'iconUrl', 'icon_url'] as $key) {
            $value = trim((string) ($payload[$key] ?? ''));
            if ($value !== '') {
                return $value;
            }
        }

        return $fallbackImageUrl;
    }

    private function resolveFloatValueFromPayload(array $payload): ?float
    {
        foreach (['floatValue', 'float', 'wearFloat', 'float_value'] as $key) {
            if (!array_key_exists($key, $payload) || !is_numeric($payload[$key])) {
                continue;
            }
            $parsed = (float) $payload[$key];
            if ($parsed >= 0.0 && $parsed <= 1.0) {
                return $parsed;
            }
        }

        return null;
    }

    private function resolvePaintSeedFromPayload(array $payload): ?int
    {
        foreach (['paintSeed', 'patternSeed', 'paint_seed', 'pattern_seed'] as $key) {
            if (!array_key_exists($key, $payload) || !is_numeric($payload[$key])) {
                continue;
            }
            $parsed = (int) $payload[$key];
            if ($parsed >= 0) {
                return $parsed;
            }
        }

        return null;
    }

    private function isExcludedInvestment(array $investment): bool
    {
        $rawPayload = $investment['raw_payload_json'] ?? null;
        if (!is_string($rawPayload) || trim($rawPayload) === '') {
            return false;
        }

        $decoded = json_decode($rawPayload, true);
        if (!is_array($decoded)) {
            return false;
        }

        return $this->toBooleanFlag($decoded['excluded'] ?? $decoded['isExcluded'] ?? false);
    }

    private function resolveInvestmentBucket(array $investment): string
    {
        $rawPayload = $investment['raw_payload_json'] ?? null;
        if (is_string($rawPayload) && trim($rawPayload) !== '') {
            $decoded = json_decode($rawPayload, true);
            if (is_array($decoded)) {
                $bucket = strtolower(trim((string) ($decoded['bucket'] ?? '')));
                if ($bucket === 'inventory' || $bucket === 'investment') {
                    return $bucket;
                }
            }
        }

        $platform = strtolower(trim((string) ($investment['platform'] ?? '')));
        if ($platform === 'steam_inventory') {
            return 'inventory';
        }
        return 'investment';
    }

    private function normalizeBucket(string $bucket): string
    {
        $normalized = strtolower(trim($bucket));
        return $normalized === 'inventory' ? 'inventory' : 'investment';
    }

    private function normalizeOverpayFloorEur(mixed $value): ?float
    {
        if (!is_numeric($value)) {
            return null;
        }

        $parsed = round((float) $value, 2);
        if ($parsed <= 0) {
            return null;
        }

        return $parsed;
    }

    private function toBooleanFlag(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if (is_numeric($value)) {
            return (int) $value === 1;
        }
        if (is_string($value)) {
            $normalized = strtolower(trim($value));
            return in_array($normalized, ['1', 'true', 'yes', 'on'], true);
        }

        return false;
    }

    private function normalizeScope(string $scope): string
    {
        $normalized = strtolower(trim($scope));
        return $normalized === 'all' ? 'all' : 'investments';
    }
}
