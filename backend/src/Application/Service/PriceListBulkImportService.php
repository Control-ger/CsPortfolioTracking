<?php
declare(strict_types=1);

namespace App\Application\Service;

use App\Infrastructure\External\CsFloatClient;
use App\Infrastructure\External\ExchangeRateClient;
use App\Infrastructure\Persistence\Repository\ExchangeRateRepository;
use App\Infrastructure\Persistence\Repository\ItemLiveCacheRepository;
use App\Infrastructure\Persistence\Repository\ItemRepository;
use App\Infrastructure\Persistence\Repository\PriceHistoryRepository;
use App\Shared\Logger;
use PDO;
use Throwable;

final class PriceListBulkImportService
{
    private const DEFAULT_BATCH_SIZE = 1000;
    private const DEFAULT_SLEEP_MS = 100;
    private const DEFAULT_MAX_MINUTES = 8;
    private const DEFAULT_PRICE_SOURCE = 'csfloat';

    public function __construct(
        private readonly PDO $pdo,
        private readonly CsFloatClient $csFloatClient,
        private readonly ExchangeRateClient $exchangeRateClient,
        private readonly ExchangeRateRepository $exchangeRateRepository,
        private readonly ItemRepository $itemRepository,
        private readonly ItemLiveCacheRepository $itemLiveCacheRepository,
        private readonly PriceHistoryRepository $priceHistoryRepository
    ) {
    }

    /**
     * @return array{total:int,processed:int,insertedItems:int,skipped:int,historyUpserts:int,cacheUpserts:int,durationMs:int,truncated:bool,error:?string}
     */
    public function importAll(): array
    {
        $startedAt = microtime(true);
        $batchSize = $this->resolveEnvInt('PRICE_LIST_BATCH_SIZE', self::DEFAULT_BATCH_SIZE, 100, 5000);
        $sleepMs = $this->resolveEnvInt('PRICE_LIST_SLEEP_MS', self::DEFAULT_SLEEP_MS, 0, 2000);
        $maxMinutes = $this->resolveEnvInt('PRICE_LIST_MAX_MINUTES', self::DEFAULT_MAX_MINUTES, 1, 30);
        $maxItems = $this->resolveEnvInt('PRICE_LIST_MAX_ITEMS', 0, 0, 100000);

        $priceIndex = $this->csFloatClient->fetchPriceListIndexSnapshot();
        if (!is_array($priceIndex) || $priceIndex === []) {
            return $this->buildResult(0, 0, 0, 0, 0, 0, $startedAt, false, 'price_list_empty');
        }

        $allNames = array_keys($priceIndex);
        if ($maxItems > 0 && count($allNames) > $maxItems) {
            $allNames = array_slice($allNames, 0, $maxItems);
        }

        $this->itemRepository->ensureTable();
        $this->itemLiveCacheRepository->ensureTable();
        $this->exchangeRateRepository->ensureTable();
        $this->priceHistoryRepository->ensureTable();

        $usdToEurRate = $this->exchangeRateClient->usdToEur();
        $exchangeRateId = $this->exchangeRateRepository->ensureTodayRate($usdToEurRate);
        $bucketStart = date('Y-m-d H:00:00');

        $processed = 0;
        $insertedItems = 0;
        $historyUpserts = 0;
        $cacheUpserts = 0;
        $skipped = 0;
        $truncated = false;

        $deadline = $startedAt + ($maxMinutes * 60);
        foreach (array_chunk($allNames, $batchSize) as $chunk) {
            if (microtime(true) >= $deadline) {
                $truncated = true;
                break;
            }

            $chunkStartedAt = microtime(true);
            try {
                $this->pdo->beginTransaction();
                $map = $this->itemRepository->findIdsByMarketHashNames($chunk);
                $missing = array_values(array_diff($chunk, array_keys($map)));
                if ($missing !== []) {
                    $insertedItems += $this->itemRepository->bulkInsertMarketHashNames($missing);
                    $map = $this->itemRepository->findIdsByMarketHashNames($chunk);
                }

                $fetchedAt = date('Y-m-d H:i:s');
                $liveRows = [];
                $historyRows = [];

                foreach ($chunk as $marketHashName) {
                    $itemId = $map[$marketHashName] ?? null;
                    if (!$itemId) {
                        $skipped++;
                        continue;
                    }

                    $entry = $priceIndex[$marketHashName] ?? null;
                    $priceUsd = is_array($entry) && isset($entry['priceUsd']) ? (float) $entry['priceUsd'] : 0.0;
                    if ($priceUsd <= 0.0) {
                        $skipped++;
                        continue;
                    }

                    $liveRows[] = [$itemId, self::DEFAULT_PRICE_SOURCE, $priceUsd, $exchangeRateId, $fetchedAt];
                    $historyRows[] = [$itemId, $bucketStart, $priceUsd, $exchangeRateId, self::DEFAULT_PRICE_SOURCE];
                }

                $cacheUpserts += $this->itemLiveCacheRepository->bulkUpsert($liveRows);
                $historyUpserts += $this->priceHistoryRepository->bulkUpsert($historyRows);

                $this->pdo->commit();
                $processed += count($chunk);
            } catch (Throwable $exception) {
                $this->pdo->rollBack();
                Logger::event(
                    'error',
                    'domain',
                    'domain.pricing.price_list_bulk_failed',
                    'Price list bulk import failed for chunk',
                    [
                        'chunkSize' => count($chunk),
                        'durationMs' => (int) round((microtime(true) - $chunkStartedAt) * 1000),
                        'error' => $exception->getMessage(),
                    ]
                );
                $skipped += count($chunk);
            }

            if ($sleepMs > 0) {
                usleep($sleepMs * 1000);
            }
        }

        return $this->buildResult(
            count($allNames),
            $processed,
            $insertedItems,
            $skipped,
            $historyUpserts,
            $cacheUpserts,
            $startedAt,
            $truncated,
            null
        );
    }

    private function buildResult(
        int $total,
        int $processed,
        int $insertedItems,
        int $skipped,
        int $historyUpserts,
        int $cacheUpserts,
        float $startedAt,
        bool $truncated,
        ?string $error
    ): array {
        $durationMs = (int) round((microtime(true) - $startedAt) * 1000);

        return [
            'total' => $total,
            'processed' => $processed,
            'insertedItems' => $insertedItems,
            'skipped' => $skipped,
            'historyUpserts' => $historyUpserts,
            'cacheUpserts' => $cacheUpserts,
            'durationMs' => $durationMs,
            'truncated' => $truncated,
            'error' => $error,
        ];
    }

    private function resolveEnvInt(string $key, int $default, int $min, int $max): int
    {
        $value = getenv($key);
        if ($value === false && isset($_ENV[$key])) {
            $value = $_ENV[$key];
        }

        if (!is_numeric($value)) {
            return $default;
        }

        $parsed = (int) $value;
        if ($parsed < $min) {
            return $min;
        }
        if ($parsed > $max) {
            return $max;
        }

        return $parsed;
    }
}

