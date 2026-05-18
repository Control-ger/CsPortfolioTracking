<?php
declare(strict_types=1);

/**
 * Queue worker for staggered item price history refresh.
 *
 * Usage: php sync-price-queue-worker.php
 */

set_time_limit(180);

$backendRoot = dirname(__DIR__);
$bootstrapPath = $backendRoot . '/backend/src/bootstrap.php';

if (!is_file($bootstrapPath)) {
    $dockerBootstrapPath = __DIR__ . '/src/bootstrap.php';
    if (is_file($dockerBootstrapPath)) {
        $bootstrapPath = $dockerBootstrapPath;
    } else {
        fwrite(STDERR, "ERROR: Bootstrap file not found at {$bootstrapPath} or {$dockerBootstrapPath}\n");
        exit(1);
    }
}

require_once $bootstrapPath;

use App\Application\Service\PriceRefreshQueueService;
use App\Application\Service\PricingService;
use App\Application\Support\MarketItemClassifier;
use App\Config\DatabaseConfig;
use App\Infrastructure\External\CsFloatClient;
use App\Infrastructure\External\ExchangeRateClient;
use App\Infrastructure\External\SteamMarketClient;
use App\Infrastructure\Persistence\DatabaseConnectionFactory;
use App\Infrastructure\Persistence\Repository\ExchangeRateRepository;
use App\Infrastructure\Persistence\Repository\ItemLiveCacheRepository;
use App\Infrastructure\Persistence\Repository\ItemRepository;
use App\Infrastructure\Persistence\Repository\PriceHistoryRepository;
use App\Infrastructure\Persistence\Repository\UserPriceSourcePreferenceRepository;

$startedAt = microtime(true);

try {
    $dbConfig = new DatabaseConfig();
    $pdo = (new DatabaseConnectionFactory($dbConfig))->create();

    $itemRepository = new ItemRepository($pdo);
    $exchangeRateRepository = new ExchangeRateRepository($pdo);
    $itemLiveCacheRepository = new ItemLiveCacheRepository($pdo);
    $priceHistoryRepository = new PriceHistoryRepository($pdo);
    $userPriceSourcePreferenceRepository = new UserPriceSourcePreferenceRepository($pdo);

    $itemRepository->ensureTable();
    $exchangeRateRepository->ensureTable();
    $itemLiveCacheRepository->ensureTable();
    $priceHistoryRepository->ensureTable();

    $pricingService = new PricingService(
        new CsFloatClient(),
        new ExchangeRateClient(),
        new SteamMarketClient(),
        new MarketItemClassifier(),
        $itemRepository,
        $exchangeRateRepository,
        $itemLiveCacheRepository,
        $userPriceSourcePreferenceRepository
    );

    $queueService = new PriceRefreshQueueService(
        $pdo,
        $pricingService,
        $priceHistoryRepository
    );

    $batchSizeRaw = getenv('PRICE_QUEUE_BATCH_SIZE');
    $batchSize = is_numeric($batchSizeRaw) ? (int) $batchSizeRaw : 25;
    $result = $queueService->processDueQueue($batchSize);

    $duration = round(microtime(true) - $startedAt, 2);
    fwrite(
        STDOUT,
        '[' . date('Y-m-d H:i:s') . '] queue worker: ' .
        "processed={$result['processed']}, success={$result['success']}, " .
        "rateLimited={$result['rateLimited']}, failed={$result['failed']}, duration={$duration}s\n"
    );

    exit(0);
} catch (Throwable $exception) {
    fwrite(STDERR, 'FATAL ERROR: ' . $exception->getMessage() . "\n");
    fwrite(STDERR, $exception->getTraceAsString() . "\n");
    exit(1);
}
