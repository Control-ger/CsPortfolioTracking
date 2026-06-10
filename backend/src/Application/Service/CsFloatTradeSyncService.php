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

    public function __construct(
        private readonly CsFloatTradeClient $tradeClient,
        private readonly ItemRepository $itemRepository,
        private readonly InvestmentRepository $investmentRepository,
        private readonly MarketItemClassifier $marketItemClassifier,
        private readonly CsFloatTradeNormalizer $normalizer,
    ) {
    }

    public function preview(int $userId, int $limit = self::DEFAULT_LIMIT, ?string $type = 'buy', int $maxPages = self::DEFAULT_MAX_PAGES): array
    {
        $this->investmentRepository->ensureImportColumns();
        $this->normalizer->setActiveUserId($userId);
        $this->normalizer->resetLivePriceCache();

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
        $this->normalizer->setActiveUserId($userId);
        $this->normalizer->resetLivePriceCache();

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

            try {
                $itemId = $this->itemRepository->findOrCreateByName(
                    (string) ($trade['marketHashName'] ?? $trade['name'] ?? 'Unknown Item'),
                    (string) ($trade['type'] ?? 'other')
                );
            } catch (RuntimeException $exception) {
                $skipped++;
                $errors[] = [
                    'externalTradeId' => $trade['externalTradeId'],
                    'message' => $exception->getMessage(),
                ];
                Logger::event(
                    'warning',
                    'domain',
                    'domain.csfloat_trade_sync.item_catalog_missing',
                    'CSFloat trade skipped because item is missing in server catalog',
                    [
                        'externalSource' => self::PLATFORM,
                        'externalTradeId' => $trade['externalTradeId'],
                        'marketHashName' => (string) ($trade['marketHashName'] ?? $trade['name'] ?? ''),
                    ]
                );
                continue;
            }
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
        $normalizedType = $this->normalizer->normalizeType($type);

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

            $externalTradeId = $this->normalizer->resolveTradeIdentifier($trade);

            if ($this->normalizer->isRefundedTrade($trade)) {
                $this->registerSkipped($skippedStats, $skippedExamples, 'refunded', [
                    'externalTradeId' => $externalTradeId,
                    'name' => $this->normalizer->resolveDisplayName($trade, $this->normalizer->resolveMarketHashName($trade)),
                    'marketHashName' => $this->normalizer->resolveMarketHashName($trade),
                ]);
                continue;
            }

            if (isset($seen[$externalTradeId])) {
                $this->registerSkipped($skippedStats, $skippedExamples, 'duplicate_in_payload', [
                    'externalTradeId' => $externalTradeId,
                    'name' => $this->normalizer->resolveDisplayName($trade, $this->normalizer->resolveMarketHashName($trade)),
                ]);
                continue;
            }
            $seen[$externalTradeId] = true;

            $marketHashName = $this->normalizer->resolveMarketHashName($trade);
            $quantity = $this->normalizer->resolveQuantity($trade);
            $buyPriceTotal = $this->normalizer->resolvePriceEur($trade, $marketHashName);
            if ($buyPriceTotal <= 0) {
                $this->registerSkipped($skippedStats, $skippedExamples, 'missing_price', [
                    'externalTradeId' => $externalTradeId,
                    'name' => $this->normalizer->resolveDisplayName($trade, $marketHashName),
                    'marketHashName' => $marketHashName,
                ]);
                continue;
            }
            $buyPrice = $this->normalizer->resolveUnitPriceEur($buyPriceTotal, $quantity);

            $typeInfo = $this->marketItemClassifier->classify(
                $marketHashName,
                $this->normalizer->resolveString($trade, ['item', 'type_name'], ['trade', 'type_name'], ['type_name']),
                $this->normalizer->resolveString($trade, ['item', 'type'], ['trade', 'type'], ['type']),
                $this->normalizer->resolveString($trade, ['item', 'type_name'], ['trade', 'type_name'], ['type_name'])
            );

            $buyPriceUsd = $this->normalizer->resolvePriceUsd($trade);

            $normalized[] = [
                'externalSource' => self::PLATFORM,
                'externalTradeId' => $externalTradeId,
                'marketHashName' => $marketHashName,
                'name' => $this->normalizer->resolveDisplayName($trade, $marketHashName),
                'type' => (string) ($typeInfo['key'] ?? 'other'),
                'typeLabel' => (string) ($typeInfo['label'] ?? 'Other'),
                'quantity' => $quantity,
                'buyPrice' => $buyPrice,
                'buyPriceTotal' => $buyPriceTotal,
                'buyPriceUsd' => $buyPriceUsd,
                'purchasedAt' => $this->normalizer->resolvePurchasedAt($trade),
                'floatValue' => $this->normalizer->resolveFloatValue($trade),
                'paintSeed' => $this->normalizer->resolvePaintSeed($trade),
                'fundingMode' => 'wallet_funded',
                'rawPayloadJson' => json_encode($trade, JSON_UNESCAPED_UNICODE),
                'rawCurrency' => $this->normalizer->resolveCurrency($trade),
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
}
