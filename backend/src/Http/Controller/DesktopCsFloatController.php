<?php
declare(strict_types=1);

namespace App\Http\Controller;

use App\Infrastructure\External\CsFloatTradeClient;
use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Request;

final class DesktopCsFloatController
{
    public function __construct(private readonly CsFloatTradeClient $tradeClient)
    {
    }

    public function preview(Request $request): void
    {
        $limit = $this->readInt($request, 'limit', 1000, 1, 1000);
        $maxPages = $this->readInt($request, 'maxPages', 10, 1, 20);
        $type = $this->readType($request);

        $trades = [];
        $pages = [];
        $errors = [];

        for ($page = 0; $page < $maxPages; $page++) {
            $response = $this->tradeClient->fetchTradesPage($limit, $page, $type);
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

        $skippedStats = [];
        $skippedExamples = [];
        $importTrades = [];
        foreach ($trades as $trade) {
            if (!is_array($trade)) {
                $this->registerSkipped($skippedStats, $skippedExamples, 'invalid_payload', [
                    'message' => 'Trade payload is not an object.',
                ]);
                continue;
            }

            if (!$this->isVerifiedTrade($trade)) {
                $this->registerSkipped($skippedStats, $skippedExamples, 'non_verified_state', [
                    'externalTradeId' => $this->readTradeId($trade),
                    'state' => implode(', ', $this->readTradeStates($trade)),
                ]);
                continue;
            }

            $importTrades[] = $this->mapTradePreviewRow($trade);
        }

        $clustered = $this->clusterTradesIfApplicable($importTrades, $type);
        $importTrades = $clustered['trades'];
        $sampleTrades = array_slice($importTrades, 0, 20);

        JsonResponseFactory::success([
            'mode' => 'preview',
            'desktopLocal' => true,
            'requested' => [
                'limit' => $limit,
                'maxPages' => $maxPages,
                'type' => $type ?? 'all',
            ],
            'pagesFetched' => count($pages),
            'pageStats' => $pages,
            'totalFetched' => count($trades),
            'normalizedCount' => $clustered['baseNormalizedCount'],
            'insertable' => count($importTrades),
            'duplicates' => 0,
            'skipped' => array_sum($skippedStats),
            'skipReasons' => $skippedStats,
            'skippedExamples' => $skippedExamples,
            'skipReasonDetails' => $this->buildSkipReasonDetails($skippedStats, $skippedExamples),
            'sampleTrades' => $sampleTrades,
            'importTrades' => $importTrades,
            'rawCount' => count($trades),
            'errors' => $errors,
            'clustering' => [
                'applied' => $clustered['applied'],
                'baseNormalizedCount' => $clustered['baseNormalizedCount'],
                'clusteredCount' => count($importTrades),
                'collapsedTrades' => $clustered['collapsedTrades'],
            ],
            'rawTrades' => $trades,
        ]);
    }

    public function execute(Request $request): void
    {
        JsonResponseFactory::error(
            'DESKTOP_LOCAL_IMPORT_REQUIRED',
            'Desktop CSFloat import must be written to local SQLite by the renderer/localStore layer.',
            ['desktopLocal' => true],
            501
        );
    }

    private function readInt(Request $request, string $key, int $default, int $min, int $max): int
    {
        $value = $request->body[$key] ?? $request->query[$key] ?? $default;
        return min(max((int) $value, $min), $max);
    }

    private function readType(Request $request): ?string
    {
        $value = strtolower(trim((string) ($request->body['type'] ?? $request->query['type'] ?? 'buy')));
        if ($value === '' || $value === 'all') {
            return null;
        }

        return in_array($value, ['buy', 'sell'], true) ? $value : 'buy';
    }

    private function mapTradePreviewRow(array $trade): array
    {
        $marketHashName = $this->readString($trade, ['item', 'market_hash_name'])
            ?? $this->readString($trade, ['item', 'name'])
            ?? $this->readString($trade, ['contract', 'item', 'market_hash_name'])
            ?? $this->readString($trade, ['contract', 'item', 'marketHashName'])
            ?? $this->readString($trade, ['contract', 'item', 'name'])
            ?? $this->readString($trade, ['listing', 'item', 'market_hash_name'])
            ?? $this->readString($trade, ['listing', 'item', 'marketHashName'])
            ?? $this->readString($trade, ['listing', 'item', 'name'])
            ?? $this->readString($trade, ['trade', 'item', 'market_hash_name'])
            ?? $this->readString($trade, ['trade', 'item', 'marketHashName'])
            ?? $this->readString($trade, ['trade', 'item', 'name'])
            ?? $this->readString($trade, ['auction', 'item', 'market_hash_name'])
            ?? $this->readString($trade, ['auction', 'item', 'marketHashName'])
            ?? $this->readString($trade, ['auction', 'item', 'name'])
            ?? $this->readString($trade, ['item_name'])
            ?? $this->readString($trade, ['market_hash_name'])
            ?? $this->readString($trade, ['marketHashName'])
            ?? $this->readString($trade, ['name'])
            ?? $this->findFirstStringByKey($trade, ['market_hash_name', 'marketHashName', 'item_name'])
            ?? $this->findFirstStringByKey($trade, ['name'])
            ?? 'Unknown Item';

        return [
            'externalTradeId' => $this->readTradeId($trade),
            'status' => 'new',
            'name' => $marketHashName,
            'marketHashName' => $marketHashName,
            'type' => 'skin',
            'typeLabel' => 'CS2 Item',
            'quantity' => 1,
            'buyPrice' => $this->readPriceUsd($trade),
            'buyPriceTotal' => $this->readPriceUsd($trade),
            'buyPriceUsd' => $this->readPriceUsd($trade),
            'purchasedAt' => $this->readString($trade, ['created_at'])
                ?? $this->readString($trade, ['createdAt'])
                ?? $this->readString($trade, ['completed_at'])
                ?? $this->readString($trade, ['completedAt'])
                ?? $this->readString($trade, ['trade', 'created_at'])
                ?? $this->readString($trade, ['trade', 'createdAt'])
                ?? $this->readString($trade, ['contract', 'created_at'])
                ?? $this->readString($trade, ['contract', 'createdAt'])
                ?? $this->readString($trade, ['timestamp'])
                ?? null,
            'fundingMode' => 'wallet_funded',
            'imageUrl' => $this->readImageUrl($trade),
            'rawCurrency' => $this->readString($trade, ['currency']) ?? 'USD',
        ];
    }

    private function readTradeId(array $trade): string
    {
        return $this->readString($trade, ['id'])
            ?? $this->readString($trade, ['_id'])
            ?? $this->readString($trade, ['trade_id'])
            ?? $this->readString($trade, ['tradeId'])
            ?? $this->readString($trade, ['trade', 'id'])
            ?? $this->readString($trade, ['trade', '_id'])
            ?? $this->readString($trade, ['contract', 'id'])
            ?? $this->readString($trade, ['contract', '_id'])
            ?? sha1(json_encode($trade, JSON_UNESCAPED_SLASHES) ?: serialize($trade));
    }

    private function isVerifiedTrade(array $trade): bool
    {
        // CSFloat may expose an explicit verified boolean flag
        foreach (
            [
                ['verified'],
                ['is_verified'],
                ['trade', 'verified'],
                ['contract', 'verified'],
                ['listing', 'verified'],
            ] as $path
        ) {
            if ($this->readPath($trade, $path) === true) {
                return true;
            }
        }

        $states = $this->readTradeStates($trade);
        if ($states === []) {
            return true;
        }

        $goodStates = [
            'verified',
            'completed',
            'done',
            'finished',
            'sold',
            '2',      // common CSFloat numeric code for sold/completed
            '1124',   // observed CSFloat numeric code for completed trades
        ];

        foreach ($states as $state) {
            $normalized = strtolower(trim((string) $state));
            if (!in_array($normalized, $goodStates, true)) {
                return false;
            }
        }

        return true;
    }

    private function readTradeStates(array $trade): array
    {
        $states = [];
        foreach (
            [
                ['state'],
                ['status'],
                ['trade', 'state'],
                ['trade', 'status'],
                ['contract', 'state'],
                ['contract', 'status'],
                ['seller', 'state'],
                ['seller', 'status'],
                ['buyer', 'state'],
                ['buyer', 'status'],
            ] as $path
        ) {
            $value = $this->readString($trade, $path);
            if ($value !== null) {
                $states[] = $value;
            }
        }

        return array_values(array_unique($states));
    }

    private function readPriceUsd(array $trade): float
    {
        foreach (
            [
                ['price'],
                ['amount'],
                ['total_price'],
                ['totalPrice'],
                ['paid_price'],
                ['paidPrice'],
                ['price', 'amount'],
                ['price', 'value'],
                ['trade', 'price'],
                ['trade', 'price', 'amount'],
                ['trade', 'price', 'value'],
                ['contract', 'price'],
                ['contract', 'price', 'amount'],
                ['contract', 'price', 'value'],
                ['listing', 'price'],
                ['listing', 'price', 'amount'],
                ['listing', 'price', 'value'],
                ['auction', 'price'],
                ['auction', 'price', 'amount'],
                ['auction', 'price', 'value'],
            ] as $path
        ) {
            $value = $this->readPath($trade, $path);
            if (is_numeric($value)) {
                return $this->normalizeCsFloatUsdAmount((float) $value);
            }
        }

        $value = $this->findFirstNumericByKey($trade, [
            'price',
            'total_price',
            'totalPrice',
            'paid_price',
            'paidPrice',
            'amount',
            'value',
        ]);

        if ($value !== null) {
            return $this->normalizeCsFloatUsdAmount($value);
        }

        return 0.0;
    }

    private function normalizeCsFloatUsdAmount(float $amount): float
    {
        if ($amount <= 0) {
            return 0.0;
        }

        $isWholeNumber = abs($amount - round($amount)) < 0.00001;
        if ($isWholeNumber) {
            return round($amount / 100, 4);
        }

        return round($amount, 4);
    }

    private function readImageUrl(array $trade): ?string
    {
        $value = $this->readString($trade, ['item', 'image'])
            ?? $this->readString($trade, ['item', 'image_url'])
            ?? $this->readString($trade, ['item', 'icon_url'])
            ?? $this->readString($trade, ['contract', 'item', 'image'])
            ?? $this->readString($trade, ['contract', 'item', 'image_url'])
            ?? $this->readString($trade, ['contract', 'item', 'icon_url'])
            ?? $this->readString($trade, ['listing', 'item', 'image'])
            ?? $this->readString($trade, ['listing', 'item', 'image_url'])
            ?? $this->readString($trade, ['listing', 'item', 'icon_url'])
            ?? $this->readString($trade, ['trade', 'item', 'image'])
            ?? $this->readString($trade, ['trade', 'item', 'image_url'])
            ?? $this->readString($trade, ['trade', 'item', 'icon_url'])
            ?? $this->readString($trade, ['image'])
            ?? $this->readString($trade, ['image_url'])
            ?? $this->readString($trade, ['icon_url'])
            ?? $this->findFirstStringByKey($trade, ['image_url', 'imageUrl', 'icon_url', 'iconUrl', 'image']);

        if ($value === null) {
            return null;
        }

        if (str_starts_with($value, 'http://') || str_starts_with($value, 'https://')) {
            return $value;
        }

        return 'https://community.cloudflare.steamstatic.com/economy/image/' . ltrim($value, '/');
    }

    private function readString(array $data, array $path): ?string
    {
        $value = $this->readPath($data, $path);
        if ($value === null || trim((string) $value) === '') {
            return null;
        }

        return trim((string) $value);
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

    private function findFirstStringByKey(array $data, array $keys): ?string
    {
        foreach ($keys as $key) {
            if (array_key_exists($key, $data) && is_scalar($data[$key]) && trim((string) $data[$key]) !== '') {
                return trim((string) $data[$key]);
            }
        }

        foreach ($data as $value) {
            if (is_array($value)) {
                $match = $this->findFirstStringByKey($value, $keys);
                if ($match !== null) {
                    return $match;
                }
            }
        }

        return null;
    }

    private function findFirstNumericByKey(array $data, array $keys): ?float
    {
        foreach ($keys as $key) {
            if (array_key_exists($key, $data) && is_numeric($data[$key])) {
                return (float) $data[$key];
            }
        }

        foreach ($data as $value) {
            if (is_array($value)) {
                $match = $this->findFirstNumericByKey($value, $keys);
                if ($match !== null) {
                    return $match;
                }
            }
        }

        return null;
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
            'state' => $context['state'] ?? null,
            'message' => $context['message'] ?? null,
        ], static fn ($value) => $value !== null && $value !== '');
    }

    private function clusterTradesIfApplicable(array $normalized, ?string $type): array
    {
        if ($type !== 'buy') {
            return [
                'applied' => false,
                'trades' => $normalized,
                'baseNormalizedCount' => count($normalized),
                'collapsedTrades' => 0,
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
            $base['buyPriceTotal'] = round(($base['buyPrice'] ?? 0.0) * $base['quantity'], 4);
            $base['purchasedAt'] = $cluster['purchasedAt'] ?? null;
            $base['rawPayloadJson'] = json_encode([
                'clustered' => true,
                'clusterKey' => $clusterKey,
                'legacyClusterKey' => $legacyClusterKey,
                'sourceTradeIds' => $tradeIds,
                'sourceTradeCount' => count($tradeIds),
                'unitBuyPrice' => $base['buyPrice'] ?? null,
                'totalBuyPrice' => ($base['buyPrice'] ?? 0) * $base['quantity'],
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
            'baseNormalizedCount' => count($normalized),
            'collapsedTrades' => max(0, count($normalized) - count($clustered)),
        ];
    }

    private function buildClusterKey(array $trade): string
    {
        $name = trim((string) ($trade['marketHashName'] ?? $trade['name'] ?? 'Unknown Item'));
        $price = number_format(round((float) ($trade['buyPriceUsd'] ?? $trade['buyPrice'] ?? 0.0), 4), 4, '.', '');
        $fundingMode = trim((string) ($trade['fundingMode'] ?? 'wallet_funded'));
        $type = trim((string) ($trade['type'] ?? 'other'));

        return strtolower($name . '|' . $price . '|' . $fundingMode . '|' . $type);
    }

    private function buildLegacyClusterKey(array $trade): string
    {
        $name = trim((string) ($trade['marketHashName'] ?? $trade['name'] ?? 'Unknown Item'));
        $price = number_format(round((float) ($trade['buyPriceUsd'] ?? $trade['buyPriceTotal'] ?? $trade['buyPrice'] ?? 0.0), 4), 4, '.', '');
        $fundingMode = trim((string) ($trade['fundingMode'] ?? 'wallet_funded'));
        $type = trim((string) ($trade['type'] ?? 'other'));

        return strtolower($name . '|' . $price . '|' . $fundingMode . '|' . $type);
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

    private function buildSkipReasonDetails(array $skippedStats, array $skippedExamples): array
    {
        $labels = [
            'invalid_payload' => 'Ungueltige Trade-Daten',
            'non_verified_state' => 'Nicht verifiziert / abgebrochen',
            'refunded' => 'Rueckerstattet',
            'duplicate_in_payload' => 'Duplikat',
            'missing_price' => 'Preis fehlt',
        ];

        $details = [];
        foreach ($skippedStats as $reason => $count) {
            $details[$reason] = [
                'count' => $count,
                'label' => $labels[$reason] ?? $reason,
                'states' => [],
            ];
        }

        foreach ($skippedExamples as $example) {
            $reason = $example['reason'] ?? '';
            $state = $example['state'] ?? '';
            if ($state !== '' && isset($details[$reason]) && !in_array($state, $details[$reason]['states'], true)) {
                $details[$reason]['states'][] = $state;
            }
        }

        return $details;
    }
}
