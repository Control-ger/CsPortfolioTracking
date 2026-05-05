<?php
declare(strict_types=1);

namespace App\Application\Service;

use App\Application\Support\MarketItemClassifier;
use App\Infrastructure\External\CsFloatTradeClient;
use App\Infrastructure\Persistence\Repository\ItemRepository;
use App\Infrastructure\Persistence\Repository\InvestmentRepository;
use App\Shared\Logger;
use RuntimeException;

final class CsFloatTradeSyncService
{
    private const DEFAULT_LIMIT = 1000;
    private const DEFAULT_MAX_PAGES = 10;
    private const PLATFORM = 'csfloat';
    private const DEFAULT_TRADE_CURRENCY = 'usd';

    private array $livePriceHintCache = [];

    public function __construct(
        private readonly CsFloatTradeClient $tradeClient,
        private readonly ItemRepository $itemRepository,
        private readonly InvestmentRepository $investmentRepository,
        private readonly PricingService $pricingService,
        private readonly MarketItemClassifier $marketItemClassifier
    ) {
    }

    public function preview(int $userId, int $limit = self::DEFAULT_LIMIT, ?string $type = 'buy', int $maxPages = self::DEFAULT_MAX_PAGES): array
    {
        $this->investmentRepository->ensureImportColumns();

        $collection = $this->collectTrades($limit, $type, $maxPages);
        $normalization = $this->normalizeAndClassifyTrades($collection['trades']);
        $normalized = $normalization['trades'];
        $clustered = $this->clusterTradesIfApplicable($normalized, $collection['type'] ?? null);

        $clusterLookupIds = $this->collectClusterLookupIds($clustered['trades']);
        $existingIds = $this->investmentRepository->findExistingExternalTradeIds($clusterLookupIds, self::PLATFORM);

        $records = $this->resolveClusterTradeIdentifiers($clustered['trades'], $existingIds);

        $allExistingIds = $this->investmentRepository->findExistingExternalTradeIds(
            array_map(static fn (array $trade): string => $trade['externalTradeId'], $records),
            self::PLATFORM
        );

        $preview = $this->buildPreviewPayload(
            $records,
            $allExistingIds,
            $collection,
            $normalization['skippedStats'],
            $normalization['skippedExamples'],
            [
                'applied' => $clustered['applied'],
                'baseNormalizedCount' => count($normalized),
                'clusteredCount' => count($records),
                'collapsedTrades' => max(0, count($normalized) - count($records)),
            ]
        );
        $preview['mode'] = 'preview';
        $preview['userId'] = $userId;

        return $preview;
    }

    public function execute(int $userId, int $limit = self::DEFAULT_LIMIT, ?string $type = 'buy', int $maxPages = self::DEFAULT_MAX_PAGES): array
    {
        $this->investmentRepository->ensureImportColumns();
        $this->itemRepository->ensureTable();

        $collection = $this->collectTrades($limit, $type, $maxPages);
        $normalization = $this->normalizeAndClassifyTrades($collection['trades']);
        $normalized = $normalization['trades'];
        $clustered = $this->clusterTradesIfApplicable($normalized, $collection['type'] ?? null);

        $clusterLookupIds = $this->collectClusterLookupIds($clustered['trades']);
        $existingIdsBefore = $this->investmentRepository->findExistingExternalTradeIds($clusterLookupIds, self::PLATFORM);

        $records = $this->resolveClusterTradeIdentifiers($clustered['trades'], $existingIdsBefore);
        $existingIdsBefore = $this->investmentRepository->findExistingExternalTradeIds(
            array_map(static fn (array $trade): string => $trade['externalTradeId'], $records),
            self::PLATFORM
        );
        $existingIds = $existingIdsBefore;

        $inserted = 0;
        $duplicates = 0;
        $skipped = 0;
        $updated = 0;
        $sampleInserted = [];
        $sampleDuplicates = [];
        $sampleUpdated = [];
        $errors = [];

        foreach ($records as $trade) {
            if ($trade['externalTradeId'] === '') {
                $skipped++;
                continue;
            }

            $itemId = $this->itemRepository->findOrCreateByName(
                (string) ($trade['marketHashName'] ?? $trade['name'] ?? 'Unknown Item'),
                (string) ($trade['type'] ?? 'other')
            );
            $trade['itemId'] = $itemId;
            $trade['userId'] = $userId;
            $trade['platform'] = self::PLATFORM;

            if (isset($existingIds[$trade['externalTradeId']])) {
                if (!empty($trade['isClustered'])) {
                    try {
                        $this->investmentRepository->upsertImportedTradeSnapshot($trade);
                        $updated++;
                        if (count($sampleUpdated) < 10) {
                            $sampleUpdated[] = $this->previewTradeRow($trade, 'updated');
                        }
                    } catch (\Throwable $exception) {
                        $errors[] = [
                            'externalTradeId' => $trade['externalTradeId'],
                            'message' => $exception->getMessage(),
                        ];
                        Logger::event(
                            'error',
                            'domain',
                            'domain.csfloat_trade_sync.update_failed',
                            'CSFloat clustered trade snapshot update failed',
                            [
                                'externalSource' => self::PLATFORM,
                                'externalTradeId' => $trade['externalTradeId'],
                                'exception' => $exception,
                            ]
                        );
                    }
                    continue;
                }

                $duplicates++;
                if (count($sampleDuplicates) < 10) {
                    $sampleDuplicates[] = $this->previewTradeRow($trade, 'duplicate');
                }
                continue;
            }

            try {
                if (!empty($trade['isClustered'])) {
                    $this->investmentRepository->upsertImportedTradeSnapshot($trade);
                } else {
                    $this->investmentRepository->insertImportedTrade($trade);
                }
                $inserted++;
                if (count($sampleInserted) < 10) {
                    $sampleInserted[] = $this->previewTradeRow($trade, 'inserted');
                }
                $existingIds[$trade['externalTradeId']] = true;
            } catch (\Throwable $exception) {
                $errors[] = [
                    'externalTradeId' => $trade['externalTradeId'],
                    'message' => $exception->getMessage(),
                ];
                Logger::event(
                    'error',
                    'domain',
                    'domain.csfloat_trade_sync.insert_failed',
                    'CSFloat trade import failed',
                    [
                        'externalSource' => self::PLATFORM,
                        'externalTradeId' => $trade['externalTradeId'],
                        'exception' => $exception,
                    ]
                );
            }
        }

        $status = count($errors) === 0 ? 'success' : ($inserted > 0 ? 'partial' : 'failed');
        $payload = $this->buildPreviewPayload(
            $records,
            $existingIdsBefore,
            $collection,
            $normalization['skippedStats'],
            $normalization['skippedExamples'],
            [
                'applied' => $clustered['applied'],
                'baseNormalizedCount' => count($normalized),
                'clusteredCount' => count($records),
                'collapsedTrades' => max(0, count($normalized) - count($records)),
            ]
        );
        $payload['mode'] = 'execute';
        $payload['status'] = $status;
        $payload['inserted'] = $inserted;
        $payload['duplicates'] = $duplicates;
        $payload['updated'] = $updated;
        $payload['skippedDuringInsert'] = $skipped;
        $payload['errors'] = $errors;
        $payload['insertedSample'] = $sampleInserted;
        $payload['duplicateSample'] = $sampleDuplicates;
        $payload['updatedSample'] = $sampleUpdated;
        $payload['userId'] = $userId;

        return $payload;
    }

    private function collectTrades(int $limit, ?string $type, int $maxPages): array
    {
        $limit = max(1, min($limit, 1000));
        $maxPages = max(1, min($maxPages, 20));
        $normalizedType = $this->normalizeType($type);

        $trades = [];
        $pages = [];
        $errors = [];

        for ($page = 0; $page < $maxPages; $page++) {
            $response = $this->tradeClient->fetchTradesPage($limit, $page, $normalizedType);
            if (!empty($response['error'])) {
                $errors[] = $response['error'];
                break;
            }

            $pageTrades = is_array($response['trades'] ?? null) ? $response['trades'] : [];
            $pages[] = [
                'page' => $page,
                'count' => count($pageTrades),
            ];
            $trades = array_merge($trades, $pageTrades);

            if (count($pageTrades) < $limit) {
                break;
            }
        }

        return [
            'trades' => $trades,
            'pages' => $pages,
            'errors' => $errors,
            'type' => $normalizedType,
            'limit' => $limit,
            'maxPages' => $maxPages,
        ];
    }

    private function normalizeAndClassifyTrades(array $trades): array
    {
        $normalized = [];
        $seen = [];
        $skippedStats = [];
        $skippedExamples = [];

        foreach ($trades as $index => $trade) {
            if (!is_array($trade)) {
                $this->registerSkipped($skippedStats, $skippedExamples, 'invalid_payload', [
                    'index' => $index,
                    'message' => 'Trade-Eintrag ist kein Objekt/Array.',
                ]);
                continue;
            }

            $externalTradeId = $this->resolveTradeIdentifier($trade);

            if ($this->isRefundedTrade($trade)) {
                $this->registerSkipped($skippedStats, $skippedExamples, 'refunded', [
                    'externalTradeId' => $externalTradeId,
                    'name' => $this->resolveDisplayName($trade, $this->resolveMarketHashName($trade)),
                    'marketHashName' => $this->resolveMarketHashName($trade),
                ]);
                continue;
            }

            if (isset($seen[$externalTradeId])) {
                $this->registerSkipped($skippedStats, $skippedExamples, 'duplicate_in_payload', [
                    'externalTradeId' => $externalTradeId,
                    'name' => $this->resolveDisplayName($trade, $this->resolveMarketHashName($trade)),
                ]);
                continue;
            }
            $seen[$externalTradeId] = true;

            $marketHashName = $this->resolveMarketHashName($trade);
            $quantity = $this->resolveQuantity($trade);
            $buyPriceTotal = $this->resolvePriceEur($trade, $marketHashName);
            if ($buyPriceTotal <= 0) {
                $this->registerSkipped($skippedStats, $skippedExamples, 'missing_price', [
                    'externalTradeId' => $externalTradeId,
                    'name' => $this->resolveDisplayName($trade, $marketHashName),
                    'marketHashName' => $marketHashName,
                ]);
                continue;
            }
            $buyPrice = $this->resolveUnitPriceEur($buyPriceTotal, $quantity);

            $typeInfo = $this->marketItemClassifier->classify(
                $marketHashName,
                $this->resolveString($trade, ['item', 'type_name'], ['trade', 'type_name'], ['type_name']),
                $this->resolveString($trade, ['item', 'type'], ['trade', 'type'], ['type']),
                $this->resolveString($trade, ['item', 'type_name'], ['trade', 'type_name'], ['type_name'])
            );

            $buyPriceUsd = $this->resolvePriceUsd($trade);

            $normalized[] = [
                'externalSource' => self::PLATFORM,
                'externalTradeId' => $externalTradeId,
                'marketHashName' => $marketHashName,
                'name' => $this->resolveDisplayName($trade, $marketHashName),
                'type' => (string) ($typeInfo['key'] ?? 'other'),
                'typeLabel' => (string) ($typeInfo['label'] ?? 'Other'),
                'quantity' => $quantity,
                'buyPrice' => $buyPrice,
                'buyPriceTotal' => $buyPriceTotal,
                'buyPriceUsd' => $buyPriceUsd,
                'purchasedAt' => $this->resolvePurchasedAt($trade),
                'floatValue' => $this->resolveFloatValue($trade),
                'paintSeed' => $this->resolvePaintSeed($trade),
                'fundingMode' => 'wallet_funded',
                'rawPayloadJson' => json_encode($trade, JSON_UNESCAPED_UNICODE),
                'rawCurrency' => $this->resolveCurrency($trade),
            ];
        }

        return [
            'trades' => $normalized,
            'skippedStats' => $skippedStats,
            'skippedExamples' => $skippedExamples,
        ];
    }

    private function buildPreviewPayload(
        array $normalized,
        array $existingIds,
        array $collection,
        array $skippedStats = [],
        array $skippedExamples = [],
        array $clusterMeta = []
    ): array
    {
        $duplicates = 0;
        $insertable = 0;
        $sampleTrades = [];
        $rawWithFlags = [];

        foreach ($normalized as $trade) {
            $isDuplicate = isset($existingIds[$trade['externalTradeId']]);
            if ($isDuplicate) {
                $duplicates++;
            } else {
                $insertable++;
            }

            $row = $this->previewTradeRow($trade, $isDuplicate ? 'duplicate' : 'new');
            $rawWithFlags[] = $row;
            if (count($sampleTrades) < 20) {
                $sampleTrades[] = $row;
            }
        }

        return [
            'requested' => [
                'limit' => $collection['limit'],
                'maxPages' => $collection['maxPages'],
                'type' => $collection['type'] ?? 'buy',
            ],
            'pagesFetched' => count($collection['pages']),
            'pageStats' => $collection['pages'],
            'totalFetched' => count($collection['trades']),
            'normalizedCount' => count($normalized),
            'insertable' => $insertable,
            'duplicates' => $duplicates,
            'skipped' => array_sum($skippedStats),
            'skipReasons' => $skippedStats,
            'skippedExamples' => $skippedExamples,
            'sampleTrades' => $sampleTrades,
            'rawCount' => count($collection['trades']),
            'errors' => $collection['errors'],
            'clustering' => [
                'applied' => (bool) ($clusterMeta['applied'] ?? false),
                'baseNormalizedCount' => (int) ($clusterMeta['baseNormalizedCount'] ?? count($normalized)),
                'clusteredCount' => (int) ($clusterMeta['clusteredCount'] ?? count($normalized)),
                'collapsedTrades' => (int) ($clusterMeta['collapsedTrades'] ?? 0),
            ],
        ];
    }

    private function clusterTradesIfApplicable(array $normalized, ?string $type): array
    {
        if ($type !== 'buy') {
            return [
                'applied' => false,
                'trades' => $normalized,
            ];
        }

        $clusters = [];

        foreach ($normalized as $trade) {
            $clusterKey = $this->buildClusterKey($trade);
            if (!isset($clusters[$clusterKey])) {
                $clusters[$clusterKey] = [
                    'base' => $trade,
                    'quantity' => max(1, (int) ($trade['quantity'] ?? 1)),
                    'purchasedAt' => $trade['purchasedAt'] ?? null,
                    'tradeIds' => [$trade['externalTradeId']],
                ];
                continue;
            }

            $clusters[$clusterKey]['quantity'] += max(1, (int) ($trade['quantity'] ?? 1));
            $clusters[$clusterKey]['tradeIds'][] = $trade['externalTradeId'];
            $clusters[$clusterKey]['purchasedAt'] = $this->earliestDate(
                $clusters[$clusterKey]['purchasedAt'] ?? null,
                $trade['purchasedAt'] ?? null
            );
        }

        $clustered = [];
        foreach ($clusters as $clusterKey => $cluster) {
            $base = $cluster['base'];
            $legacyClusterKey = $this->buildLegacyClusterKey($base);
            $tradeIds = array_values(array_unique(array_filter(array_map(
                static fn ($value) => trim((string) $value),
                $cluster['tradeIds']
            ))));
            sort($tradeIds);

            $base['externalTradeId'] = 'cluster_' . sha1($clusterKey);
            $base['legacyExternalTradeId'] = 'cluster_' . sha1($legacyClusterKey);
            $base['quantity'] = max(1, (int) ($cluster['quantity'] ?? 1));
            $base['purchasedAt'] = $cluster['purchasedAt'] ?? null;
            $base['rawPayloadJson'] = json_encode([
                'clustered' => true,
                'clusterKey' => $clusterKey,
                'legacyClusterKey' => $legacyClusterKey,
                'sourceTradeIds' => $tradeIds,
                'sourceTradeCount' => count($tradeIds),
                'unitBuyPrice' => $base['buyPrice'] ?? null,
                'totalBuyPrice' => $base['buyPriceTotal'] ?? null,
            ], JSON_UNESCAPED_UNICODE);
            $base['isClustered'] = true;
            $base['clusterSourceTradeCount'] = count($tradeIds);

            $clustered[] = $base;
        }

        usort(
            $clustered,
            static fn (array $left, array $right): int => strcmp((string) ($left['marketHashName'] ?? ''), (string) ($right['marketHashName'] ?? ''))
        );

        return [
            'applied' => true,
            'trades' => $clustered,
        ];
    }

    private function buildClusterKey(array $trade): string
    {
        $name = trim((string) ($trade['marketHashName'] ?? $trade['name'] ?? 'Unknown Item'));
        // Use USD price for clustering if available (no conversion rounding issues)
        $price = number_format(round((float) ($trade['buyPriceUsd'] ?? $trade['buyPrice'] ?? 0.0), 4), 4, '.', '');
        $fundingMode = trim((string) ($trade['fundingMode'] ?? 'wallet_funded'));
        $type = trim((string) ($trade['type'] ?? 'other'));

        return strtolower($name . '|' . $price . '|' . $fundingMode . '|' . $type);
    }

    private function buildLegacyClusterKey(array $trade): string
    {
        $name = trim((string) ($trade['marketHashName'] ?? $trade['name'] ?? 'Unknown Item'));
        // Use USD price for clustering if available (no conversion rounding issues)
        $price = number_format(round((float) ($trade['buyPriceUsd'] ?? $trade['buyPriceTotal'] ?? $trade['buyPrice'] ?? 0.0), 4), 4, '.', '');
        $fundingMode = trim((string) ($trade['fundingMode'] ?? 'wallet_funded'));
        $type = trim((string) ($trade['type'] ?? 'other'));

        return strtolower($name . '|' . $price . '|' . $fundingMode . '|' . $type);
    }

    private function resolveUnitPriceEur(float $buyPriceTotal, int $quantity): float
    {
        if ($quantity <= 1) {
            return round($buyPriceTotal, 4);
        }

        return round($buyPriceTotal / $quantity, 4);
    }

    private function collectClusterLookupIds(array $trades): array
    {
        $ids = [];

        foreach ($trades as $trade) {
            foreach (['externalTradeId', 'legacyExternalTradeId'] as $key) {
                $value = trim((string) ($trade[$key] ?? ''));
                if ($value !== '') {
                    $ids[$value] = true;
                }
            }
        }

        return array_keys($ids);
    }

    private function resolveClusterTradeIdentifiers(array $trades, array $existingIds): array
    {
        if ($existingIds === []) {
            return $trades;
        }

        foreach ($trades as &$trade) {
            $externalTradeId = trim((string) ($trade['externalTradeId'] ?? ''));
            $legacyExternalTradeId = trim((string) ($trade['legacyExternalTradeId'] ?? ''));

            if ($externalTradeId !== '' && isset($existingIds[$externalTradeId])) {
                $trade['resolvedExternalTradeId'] = $externalTradeId;
                continue;
            }

            if ($legacyExternalTradeId !== '' && isset($existingIds[$legacyExternalTradeId])) {
                $trade['externalTradeId'] = $legacyExternalTradeId;
                $trade['resolvedExternalTradeId'] = $legacyExternalTradeId;
                continue;
            }

            $trade['resolvedExternalTradeId'] = $externalTradeId;
        }
        unset($trade);

        return $trades;
    }

    private function earliestDate(?string $current, ?string $candidate): ?string
    {
        if ($current === null || trim($current) === '') {
            return $candidate;
        }
        if ($candidate === null || trim($candidate) === '') {
            return $current;
        }

        $currentTimestamp = strtotime($current);
        $candidateTimestamp = strtotime($candidate);
        if ($currentTimestamp === false || $candidateTimestamp === false) {
            return $current;
        }

        return $candidateTimestamp < $currentTimestamp ? $candidate : $current;
    }

    private function registerSkipped(array &$stats, array &$examples, string $reason, array $context = []): void
    {
        $stats[$reason] = ($stats[$reason] ?? 0) + 1;

        if (count($examples) >= 10) {
            return;
        }

        $examples[] = array_filter([
            'reason' => $reason,
            'externalTradeId' => $context['externalTradeId'] ?? null,
            'name' => $context['name'] ?? null,
            'marketHashName' => $context['marketHashName'] ?? null,
            'index' => $context['index'] ?? null,
            'message' => $context['message'] ?? null,
        ], static fn ($value) => $value !== null && $value !== '');
    }

    private function previewTradeRow(array $trade, string $status): array
    {
        return [
            'externalTradeId' => $trade['externalTradeId'],
            'status' => $status,
            'name' => $trade['name'],
            'marketHashName' => $trade['marketHashName'],
            'type' => $trade['type'],
            'typeLabel' => $trade['typeLabel'],
            'quantity' => $trade['quantity'],
            'buyPrice' => $trade['buyPrice'],
            'purchasedAt' => $trade['purchasedAt'],
            'floatValue' => $trade['floatValue'] ?? null,
            'paintSeed' => $trade['paintSeed'] ?? null,
            'fundingMode' => $trade['fundingMode'],
            'rawCurrency' => $trade['rawCurrency'],
        ];
    }

    private function normalizeType(?string $type): ?string
    {
        $normalized = strtolower(trim((string) $type));
        if ($normalized === '' || $normalized === 'all') {
            return null;
        }

        return in_array($normalized, ['buy', 'sell'], true) ? $normalized : 'buy';
    }

    private function resolveTradeIdentifier(array $trade): string
    {
        foreach (
            [
                ['id'],
                ['_id'],
                ['trade_id'],
                ['tradeId'],
                ['external_id'],
                ['externalId'],
                ['trade_uuid'],
                ['tradeUuid'],
                ['uuid'],
                ['trade', 'id'],
                ['trade', '_id'],
                ['trade', 'trade_id'],
                ['trade', 'tradeId'],
                ['trade', 'uuid'],
                ['listing', 'id'],
                ['listing', '_id'],
                ['order', 'id'],
                ['transaction', 'id'],
                ['sale', 'id'],
                ['purchase', 'id'],
            ] as $path
        ) {
            $value = $this->readPath($trade, $path);
            if ($value !== null && trim((string) $value) !== '') {
                return trim((string) $value);
            }
        }

        $fingerprintSource = json_encode($trade, JSON_UNESCAPED_UNICODE);
        if ($fingerprintSource === false || $fingerprintSource === '') {
            $fingerprintSource = serialize($trade);
        }

        return 'fp_' . sha1($fingerprintSource);
    }

    private function resolveMarketHashName(array $trade): string
    {
        foreach (
            [
                ['item', 'market_hash_name'],
                ['item', 'name'],
                ['item', 'marketHashName'],
                ['contract', 'item', 'market_hash_name'],
                ['contract', 'item', 'name'],
                ['contract', 'name'],
                ['listing', 'item', 'market_hash_name'],
                ['listing', 'item', 'name'],
                ['listing', 'name'],
                ['item_name'],
                ['market_hash_name'],
                ['marketHashName'],
                ['name'],
            ] as $path
        ) {
            $value = $this->resolveString($trade, $path);
            if ($value !== null && $value !== '') {
                return $value;
            }
        }

        return 'Unknown Item';
    }

    private function resolveDisplayName(array $trade, string $fallback): string
    {
        foreach (
            [
                ['item', 'display_name'],
                ['item', 'name'],
                ['item', 'market_hash_name'],
                ['contract', 'item', 'display_name'],
                ['contract', 'item', 'name'],
                ['contract', 'name'],
                ['listing', 'item', 'display_name'],
                ['listing', 'item', 'name'],
                ['listing', 'name'],
                ['display_name'],
                ['name'],
            ] as $path
        ) {
            $value = $this->resolveString($trade, $path);
            if ($value !== null && $value !== '') {
                return $value;
            }
        }

        return $fallback;
    }

    private function resolveQuantity(array $trade): int
    {
        foreach (['quantity', 'amount', 'count', 'size'] as $key) {
            $value = $trade[$key] ?? null;
            if (is_numeric($value) && (int) $value > 0) {
                return (int) $value;
            }
        }

        foreach ([['contract', 'quantity'], ['contract', 'amount'], ['listing', 'quantity'], ['listing', 'amount']] as $path) {
            $value = $this->readPath($trade, $path);
            if (is_numeric($value) && (int) $value > 0) {
                return (int) $value;
            }
        }

        return 1;
    }

    private function resolveCurrency(array $trade): ?string
    {
        foreach (['currency', 'price_currency', 'priceCurrency', 'quote_currency'] as $key) {
            $value = $trade[$key] ?? null;
            if (is_string($value) && trim($value) !== '') {
                return strtoupper(trim($value));
            }
        }

        foreach ([['price', 'currency'], ['contract', 'currency'], ['contract', 'price', 'currency'], ['listing', 'currency'], ['listing', 'price', 'currency']] as $path) {
            $value = $this->readPath($trade, $path);
            if (is_string($value) && trim($value) !== '') {
                return strtoupper(trim($value));
            }
        }

        return null;
    }

    private function resolvePriceEur(array $trade, ?string $marketHashName = null): float
    {
        $currency = strtolower((string) ($this->resolveCurrency($trade) ?? self::DEFAULT_TRADE_CURRENCY));
        $livePriceHintEur = $marketHashName !== null && trim($marketHashName) !== ''
            ? $this->resolveLivePriceHintEur($marketHashName)
            : null;
        $priceCandidates = [
            ['price_eur'],
            ['priceEur'],
            ['total_eur'],
            ['totalEur'],
            ['amount_eur'],
            ['amountEur'],
            ['price', 'eur'],
            ['price', 'euro'],
            ['price', 'amount_eur'],
            ['price', 'value_eur'],
            ['trade', 'price', 'eur'],
            ['trade', 'price', 'euro'],
            ['trade', 'price', 'amount_eur'],
            ['trade', 'price', 'value_eur'],
            ['price'],
            ['total_price'],
            ['totalPrice'],
            ['paid_price'],
            ['paidPrice'],
            ['amount'],
            ['price', 'amount'],
            ['price', 'value'],
            ['trade', 'price', 'amount'],
            ['trade', 'price', 'value'],
            ['trade', 'price'],
            ['contract', 'price_eur'],
            ['contract', 'priceEur'],
            ['contract', 'price'],
            ['contract', 'price', 'amount'],
            ['contract', 'price', 'value'],
            ['contract', 'total'],
            ['contract', 'amount'],
            ['contract', 'price_cents'],
            ['contract', 'price', 'cents'],
            ['listing', 'price_eur'],
            ['listing', 'priceEur'],
            ['listing', 'price'],
            ['listing', 'price', 'amount'],
            ['listing', 'price', 'value'],
            ['listing', 'total'],
            ['listing', 'amount'],
            ['listing', 'price_cents'],
            ['listing', 'price', 'cents'],
            ['price_cents'],
            ['priceCents'],
            ['price', 'cents'],
            ['trade', 'price_cents'],
            ['trade', 'price', 'cents'],
        ];

        foreach ($priceCandidates as $path) {
            $value = $this->readPath($trade, $path);
            if ($value === null) {
                continue;
            }

            $pathCurrencyHint = $this->resolveCurrencyHintFromPath($path);

            if (is_array($value)) {
                $resolved = $this->resolvePriceFromNode($value);
                if ($resolved !== null) {
                    return $this->normalizePriceToEur(
                        $resolved['amount'],
                        $resolved['currency'] ?? $pathCurrencyHint ?? $currency,
                        $resolved['isCents'],
                        $livePriceHintEur
                    );
                }
                continue;
            }

            if (!is_numeric($value)) {
                continue;
            }

            return $this->normalizePriceToEur(
                (float) $value,
                $pathCurrencyHint ?? $currency,
                false,
                $livePriceHintEur
            );
        }

        $directNode = $this->resolvePriceFromNode($trade['price'] ?? null);
        if ($directNode !== null) {
            return $this->normalizePriceToEur(
                $directNode['amount'],
                $directNode['currency'] ?? $currency,
                $directNode['isCents'],
                $livePriceHintEur
            );
        }

        $contractNode = $this->resolvePriceFromNode($this->readPath($trade, ['contract', 'price']));
        if ($contractNode !== null) {
            return $this->normalizePriceToEur(
                $contractNode['amount'],
                $contractNode['currency'] ?? $currency,
                $contractNode['isCents'],
                $livePriceHintEur
            );
        }

        $listingNode = $this->resolvePriceFromNode($this->readPath($trade, ['listing', 'price']));
        if ($listingNode !== null) {
            return $this->normalizePriceToEur(
                $listingNode['amount'],
                $listingNode['currency'] ?? $currency,
                $listingNode['isCents'],
                $livePriceHintEur
            );
        }

        return 0.0;
    }

    private function resolvePriceUsd(array $trade): ?float
    {
        // Extract original USD price before any conversion
        // CSFloat trades are typically in USD
        $usdCandidates = [
            ['price_usd'],
            ['priceUsd'],
            ['total_usd'],
            ['totalUsd'],
            ['amount_usd'],
            ['amountUsd'],
            ['price', 'usd'],
            ['price', 'amount_usd'],
            ['trade', 'price', 'usd'],
            ['contract', 'price_usd'],
            ['contract', 'price', 'usd'],
            ['listing', 'price_usd'],
            ['listing', 'price', 'usd'],
        ];

        foreach ($usdCandidates as $path) {
            $value = $this->readPath($trade, $path);
            if ($value !== null && is_numeric($value) && (float) $value > 0) {
                return (float) $value;
            }
        }

        // If currency is USD and we have a price, return it
        $currency = $this->resolveCurrency($trade);
        if (strtoupper($currency) === 'USD') {
            $directPrice = $this->readPath($trade, ['price'])
                ?? $this->readPath($trade, ['total_price'])
                ?? $this->readPath($trade, ['amount']);
            if (is_numeric($directPrice) && (float) $directPrice > 0) {
                return (float) $directPrice;
            }
        }

        return null;
    }

    private function resolvePriceFromNode(mixed $node): ?array
    {
        if (is_numeric($node)) {
            $amount = (float) $node;
            return [
                'amount' => $amount,
                'currency' => null,
                'isCents' => false,
            ];
        }

        if (!is_array($node)) {
            return null;
        }

        $currency = $this->resolveCurrencyFromNode($node);

        foreach (['amount', 'value', 'total', 'price'] as $key) {
            if (isset($node[$key]) && is_numeric($node[$key])) {
                $amount = (float) $node[$key];
                return [
                    'amount' => $amount,
                    'currency' => $currency,
                    'isCents' => false,
                ];
            }
        }

        foreach (['amount_cents', 'value_cents', 'total_cents', 'price_cents', 'cents'] as $key) {
            if (isset($node[$key]) && is_numeric($node[$key])) {
                return [
                    'amount' => (float) $node[$key],
                    'currency' => $currency,
                    'isCents' => true,
                ];
            }
        }

        return null;
    }

    private function resolveCurrencyFromNode(array $node): ?string
    {
        foreach (['currency', 'currency_code', 'currencyCode', 'quote_currency', 'quoteCurrency'] as $key) {
            $value = $node[$key] ?? null;
            if (is_string($value) && trim($value) !== '') {
                return strtoupper(trim($value));
            }
        }

        return null;
    }

    private function resolveCurrencyHintFromPath(array $path): ?string
    {
        $joined = strtolower(implode('_', array_map(static fn ($segment): string => (string) $segment, $path)));

        if (str_contains($joined, 'eur') || str_contains($joined, 'euro')) {
            return 'eur';
        }

        if (str_contains($joined, 'usd') || str_contains($joined, 'dollar')) {
            return 'usd';
        }

        return null;
    }

    private function normalizePriceToEur(float $amount, ?string $currency, bool $isCents, ?float $livePriceHintEur = null): float
    {
        $normalizedCurrency = strtolower(trim((string) $currency));
        if ($normalizedCurrency === '') {
            $normalizedCurrency = self::DEFAULT_TRADE_CURRENCY;
        }

        $scale = $isCents ? 100 : $this->resolvePriceScale($amount, $normalizedCurrency, $livePriceHintEur);
        if ($scale <= 0) {
            $scale = 100;
        }

        $amount = $amount / $scale;

        if (in_array($normalizedCurrency, ['eur', '€'], true)) {
            return round($amount, 4);
        }

        if ($normalizedCurrency === 'usd' || $normalizedCurrency === '$') {
            return round($amount * $this->pricingService->getUsdToEurRate(), 4);
        }

        if ($normalizedCurrency === '') {
            return round($amount, 4);
        }

        return round($amount, 4);
    }

    private function resolvePriceScale(float $amount, ?string $currency, ?float $livePriceHintEur = null): int
    {
        $normalizedCurrency = strtolower(trim((string) $currency));
        if ($normalizedCurrency === '') {
            $normalizedCurrency = self::DEFAULT_TRADE_CURRENCY;
        }
        $baseCandidates = [100, 1];

        if ($amount >= 1000) {
            $baseCandidates[] = 1000;
        }

        if ($amount >= 10000) {
            $baseCandidates[] = 10000;
        }

        if ($amount >= 1000000) {
            $baseCandidates[] = 100000;
        }

        $candidates = array_values(array_unique($baseCandidates));

        if ($livePriceHintEur !== null && $livePriceHintEur > 0) {
            $bestScale = 100;
            $bestDelta = null;

            foreach ($candidates as $candidateScale) {
                $candidatePrice = $this->convertRawAmountToEur($amount, $normalizedCurrency, $candidateScale);
                if ($candidatePrice <= 0) {
                    continue;
                }

                $delta = abs(log(max($candidatePrice, 0.0001) / max($livePriceHintEur, 0.0001)));
                if ($bestDelta === null || $delta < $bestDelta) {
                    $bestDelta = $delta;
                    $bestScale = $candidateScale;
                }
            }

            return $bestScale;
        }

        return 100;
    }

    private function convertRawAmountToEur(float $amount, ?string $currency, int $scale): float
    {
        if ($scale > 0) {
            $amount = $amount / $scale;
        }

        $normalizedCurrency = strtolower(trim((string) $currency));
        if ($normalizedCurrency === '') {
            $normalizedCurrency = self::DEFAULT_TRADE_CURRENCY;
        }
        if (in_array($normalizedCurrency, ['usd', '$'], true)) {
            return round($amount * $this->pricingService->getUsdToEurRate(), 4);
        }

        return round($amount, 4);
    }

    private function resolveLivePriceHintEur(string $marketHashName): ?float
    {
        if (array_key_exists($marketHashName, $this->livePriceHintCache)) {
            return $this->livePriceHintCache[$marketHashName];
        }

        $livePrice = $this->pricingService->getLivePriceEur($marketHashName);
        $this->livePriceHintCache[$marketHashName] = $livePrice !== null ? (float) $livePrice : null;

        return $this->livePriceHintCache[$marketHashName];
    }

    private function resolvePurchasedAt(array $trade): ?string
    {
        foreach (
            [
                ['purchased_at'],
                ['purchasedAt'],
                ['created_at'],
                ['createdAt'],
                ['completed_at'],
                ['completedAt'],
                ['timestamp'],
                ['date'],
                ['trade', 'created_at'],
                ['trade', 'createdAt'],
                ['trade', 'completed_at'],
                ['trade', 'completedAt'],
                ['trade', 'timestamp'],
                ['trade', 'date'],
            ] as $path
        ) {
            $value = $this->readPath($trade, $path);
            if ($value === null || trim((string) $value) === '') {
                continue;
            }

            $timestamp = is_numeric($value) ? (int) $value : strtotime((string) $value);
            if ($timestamp !== false && $timestamp > 0) {
                return date('Y-m-d H:i:s', $timestamp > 2000000000 ? (int) floor($timestamp / 1000) : $timestamp);
            }
        }

        return null;
    }

    private function resolveFloatValue(array $trade): ?float
    {
        foreach (
            [
                ['float_value'],
                ['floatValue'],
                ['float'],
                ['item', 'float_value'],
                ['item', 'floatValue'],
                ['item', 'float'],
                ['listing', 'float_value'],
                ['listing', 'floatValue'],
                ['listing', 'float'],
            ] as $path
        ) {
            $value = $this->readPath($trade, $path);
            if (!is_numeric($value)) {
                continue;
            }

            $floatValue = (float) $value;
            if ($floatValue >= 0 && $floatValue <= 1) {
                return $floatValue;
            }
        }

        return null;
    }

    private function resolvePaintSeed(array $trade): ?int
    {
        foreach (
            [
                ['paint_seed'],
                ['paintSeed'],
                ['pattern_seed'],
                ['patternSeed'],
                ['item', 'paint_seed'],
                ['item', 'paintSeed'],
                ['item', 'pattern_seed'],
                ['item', 'patternSeed'],
                ['listing', 'paint_seed'],
                ['listing', 'paintSeed'],
                ['listing', 'pattern_seed'],
                ['listing', 'patternSeed'],
            ] as $path
        ) {
            $value = $this->readPath($trade, $path);
            if (!is_numeric($value)) {
                continue;
            }

            $seed = (int) $value;
            if ($seed >= 0) {
                return $seed;
            }
        }

        return null;
    }

    private function isRefundedTrade(array $trade): bool
    {
        $state = strtolower(trim((string) $this->resolveString(
            $trade,
            ['state'],
            ['trade', 'state'],
            ['contract', 'state'],
            ['status'],
            ['trade', 'status'],
            ['contract', 'status']
        )));

        return $state === 'refunded';
    }

    private function resolveString(array $trade, array ...$paths): ?string
    {
        foreach ($paths as $path) {
            $value = $this->readPath($trade, $path);
            if ($value !== null && trim((string) $value) !== '') {
                return trim((string) $value);
            }
        }

        return null;
    }

    private function readPath(array $data, array $path): mixed
    {
        $cursor = $data;
        foreach ($path as $segment) {
            if (!is_array($cursor) || !array_key_exists($segment, $cursor)) {
                return null;
            }
            $cursor = $cursor[$segment];
        }

        return $cursor;
    }
}



