<?php
declare(strict_types=1);

namespace App\Http\Controller;

use App\Infrastructure\External\SkinBaronClient;
use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Request;

final class DesktopSkinBaronController
{
    private const MIN_REQUEST_INTERVAL_US = 120000; // ~8.3 req/s (below 10 req/s limit)
    private const SALES_TYPES = [1, 2, 3, 4, 5, 6, 7];

    public function __construct(private readonly SkinBaronClient $client)
    {
    }

    public function preview(Request $request): void
    {
        $limit = $this->readInt($request, 'limit', 100, 1, 200);
        $maxPages = $this->readInt($request, 'maxPages', 10, 1, 25);

        $salesById = [];
        $salesWithoutId = [];
        $pageStats = [];
        $errors = [];
        $requestCount = 0;

        foreach (self::SALES_TYPES as $saleType) {
            $cursor = null;
            for ($page = 0; $page < $maxPages; $page++) {
                if ($requestCount > 0) {
                    usleep(self::MIN_REQUEST_INTERVAL_US);
                }
                $requestCount += 1;

                $result = $this->client->fetchSalesPage($limit, $cursor, $saleType);
                if (!empty($result['error'])) {
                    $errors[] = [
                        ...$result['error'],
                        'saleType' => $saleType,
                        'page' => $page,
                    ];
                    break;
                }

                $pageSales = is_array($result['sales'] ?? null) ? $result['sales'] : [];
                $pageStats[] = [
                    'type' => $saleType,
                    'page' => $page,
                    'count' => count($pageSales),
                ];

                foreach ($pageSales as $sale) {
                    if (!is_array($sale)) {
                        $salesWithoutId[] = $sale;
                        continue;
                    }

                    $saleId = $this->readString($sale, ['id']);
                    if ($saleId === null) {
                        $salesWithoutId[] = $sale;
                        continue;
                    }

                    if (
                        !isset($salesById[$saleId]) ||
                        $this->shouldReplaceSaleRecord($salesById[$saleId], $sale)
                    ) {
                        $salesById[$saleId] = $sale;
                    }
                }

                if (count($pageSales) < $limit) {
                    break;
                }

                $lastId = $this->readString($pageSales[count($pageSales) - 1] ?? [], ['id']);
                if ($lastId === null) {
                    break;
                }
                $cursor = $lastId;
            }
        }

        $sales = array_merge(array_values($salesById), $salesWithoutId);
        $importTrades = [];
        $skipped = 0;
        foreach ($sales as $sale) {
            if (!is_array($sale)) {
                $skipped += 1;
                continue;
            }
            $mapped = $this->mapSalePreviewRow($sale);
            if ($mapped === null) {
                $skipped += 1;
                continue;
            }
            $importTrades[] = $mapped;
        }

        JsonResponseFactory::success([
            'mode' => 'preview',
            'desktopLocal' => true,
            'requested' => [
                'limit' => $limit,
                'maxPages' => $maxPages,
                'type' => 'sales',
                'salesTypes' => self::SALES_TYPES,
            ],
            'pagesFetched' => count($pageStats),
            'pageStats' => $pageStats,
            'totalFetched' => count($sales),
            'normalizedCount' => count($importTrades),
            'insertable' => count($importTrades),
            'duplicates' => 0,
            'updated' => 0,
            'skipped' => $skipped,
            'skipReasons' => $skipped > 0 ? ['invalid_sale_payload' => $skipped] : [],
            'sampleTrades' => array_slice($importTrades, 0, 20),
            'importTrades' => $importTrades,
            'rawCount' => count($sales),
            'rawDistinctBySaleId' => count($salesById),
            'rawWithoutSaleId' => count($salesWithoutId),
            'errors' => $errors,
            'rawTrades' => $sales,
        ]);
    }

    public function execute(Request $request): void
    {
        JsonResponseFactory::error(
            'DESKTOP_LOCAL_IMPORT_REQUIRED',
            'Desktop SkinBaron import must be written to local SQLite by the renderer/localStore layer.',
            ['desktopLocal' => true],
            501
        );
    }

    private function mapSalePreviewRow(array $sale): ?array
    {
        $saleId = $this->readString($sale, ['id']);
        $name = $this->readString($sale, ['name'])
            ?? $this->readString($sale, ['market_name'])
            ?? $this->readString($sale, ['marketHashName']);
        if ($saleId === null || $name === null) {
            return null;
        }

        $listTimeUnix = $this->readNumeric($sale, ['list_time']);
        $lastUpdatedUnix = $this->readNumeric($sale, ['last_updated']);

        return [
            'externalTradeId' => $saleId,
            'status' => 'new',
            'name' => $name,
            'marketHashName' => $name,
            'type' => 'skin',
            'typeLabel' => 'SkinBaron Sale',
            'quantity' => 1,
            'buyPrice' => $this->readNumeric($sale, ['price']) ?? 0.0,
            'buyPriceTotal' => $this->readNumeric($sale, ['price']) ?? 0.0,
            'buyPriceUsd' => $this->readNumeric($sale, ['price']) ?? 0.0,
            'purchasedAt' => $this->unixToIso($listTimeUnix) ?? $this->unixToIso($lastUpdatedUnix),
            'fundingMode' => 'wallet_funded',
            'imageUrl' => null,
            'rawCurrency' => 'USD',
            'skinBaronSaleId' => $saleId,
            'skinBaronState' => (int) ($this->readNumeric($sale, ['state']) ?? 0),
        ];
    }

    private function readInt(Request $request, string $key, int $default, int $min, int $max): int
    {
        $value = $request->body[$key] ?? $request->query[$key] ?? $default;
        return min(max((int) $value, $min), $max);
    }

    private function readPath(array $payload, array $path): mixed
    {
        $cursor = $payload;
        foreach ($path as $segment) {
            if (!is_array($cursor) || !array_key_exists($segment, $cursor)) {
                return null;
            }
            $cursor = $cursor[$segment];
        }

        return $cursor;
    }

    private function readString(array $payload, array $path): ?string
    {
        $value = $this->readPath($payload, $path);
        if ($value === null || trim((string) $value) === '') {
            return null;
        }

        return trim((string) $value);
    }

    private function readNumeric(array $payload, array $path): ?float
    {
        $value = $this->readPath($payload, $path);
        if (!is_numeric($value)) {
            return null;
        }

        return (float) $value;
    }

    private function unixToIso(?float $value): ?string
    {
        if ($value === null || $value <= 0) {
            return null;
        }
        return gmdate('c', (int) round($value));
    }

    private function shouldReplaceSaleRecord(array $existing, array $incoming): bool
    {
        $existingUpdated = $this->readNumeric($existing, ['last_updated']) ?? 0.0;
        $incomingUpdated = $this->readNumeric($incoming, ['last_updated']) ?? 0.0;
        if ($incomingUpdated !== $existingUpdated) {
            return $incomingUpdated > $existingUpdated;
        }

        $existingListed = $this->readNumeric($existing, ['list_time']) ?? 0.0;
        $incomingListed = $this->readNumeric($incoming, ['list_time']) ?? 0.0;
        if ($incomingListed !== $existingListed) {
            return $incomingListed > $existingListed;
        }

        return false;
    }
}
