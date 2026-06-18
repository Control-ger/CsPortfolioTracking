<?php
declare(strict_types=1);

/**
 * CSFloat Price Sync CLI Script
 * 
 * Plans the hourly prioritized price-refresh queue and persists portfolio snapshots.
 * Runs hourly via Supervisor. Queue worker processes due items in small batches.
 * Logs all results to sync_status table for monitoring.
 * 
 * Usage: php sync-prices.php
 */
set_time_limit(300); // 5 minutes max

$backendRoot = dirname(__DIR__);
$bootstrapPath = $backendRoot . '/backend/src/bootstrap.php';

// Docker: backend is mounted at /var/www/html/api, so bootstrap is at /var/www/html/api/src/bootstrap.php
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

// Only this cron process may mutate the shared items catalog.
putenv('ITEMS_CATALOG_WRITE_SCOPE=cron');
$_ENV['ITEMS_CATALOG_WRITE_SCOPE'] = 'cron';

use App\Application\Service\PortfolioService;
use App\Application\Service\FeeSettingsService;
use App\Application\Service\PriceListBulkImportService;
use App\Application\Service\PriceRefreshQueueService;
use App\Application\Service\PricingService;
use App\Application\Service\SyncService;
use App\Application\Service\SyncEntityService;
use App\Config\DatabaseConfig;
use App\Infrastructure\External\CsFloatClient;
use App\Infrastructure\External\ExchangeRateClient;
use App\Infrastructure\External\SteamMarketClient;
use App\Infrastructure\Persistence\DatabaseConnectionFactory;
use App\Infrastructure\Persistence\Repository\CacheMaintenanceRepository;
use App\Infrastructure\Persistence\Repository\ExchangeRateRepository;
use App\Infrastructure\Persistence\Repository\InvestmentRepository;
use App\Infrastructure\Persistence\Repository\ItemRepository;
use App\Infrastructure\Persistence\Repository\ItemLiveCacheRepository;
use App\Infrastructure\Persistence\Repository\PortfolioHistoryRepository;
use App\Infrastructure\Persistence\Repository\PositionHistoryRepository;
use App\Infrastructure\Persistence\Repository\PriceHistoryRepository;
use App\Infrastructure\Persistence\Repository\SyncStatusRepository;
use App\Infrastructure\Persistence\Repository\UserFeeSettingsRepository;
use App\Infrastructure\Persistence\Repository\UserPriceSourcePreferenceRepository;
use App\Infrastructure\Persistence\Repository\UserRepository;
use App\Infrastructure\Persistence\Repository\WatchlistRepository;

$startTime = microtime(true);
$syncedCount = 0;
$errorCount = 0;
$rateLimitedCount = 0;
$status = 'success';
$errorMessage = null;
$snapshotSaved = false;
$snapshotTime = null;
$syncStatusRepository = null;
$syncSource = 'hourly-price-sync';
$syncUserId = 1;

function cleanupSyncIdempotency(\PDO $pdo, int $retentionDays): int
{
    $resolvedDays = max(1, min($retentionDays, 365));
    $sql = "DELETE FROM sync_idempotency WHERE created_at < (NOW() - INTERVAL {$resolvedDays} DAY)";
    $stmt = $pdo->prepare($sql);
    $stmt->execute();
    return $stmt->rowCount();
}

try {
    fwrite(STDOUT, "[" . date('Y-m-d H:i:s') . "] Starting CSFloat price sync...\n");

    // Initialize database connection
    $dbConfig = new DatabaseConfig();
    $pdo = (new DatabaseConnectionFactory($dbConfig))->create();

    // Initialize repositories
    $itemRepository = new ItemRepository($pdo);
    $exchangeRateRepository = new ExchangeRateRepository($pdo);
    $itemLiveCacheRepository = new ItemLiveCacheRepository($pdo);
    $investmentRepository = new InvestmentRepository($pdo);
    $portfolioHistoryRepository = new PortfolioHistoryRepository($pdo);
    $positionHistoryRepository = new PositionHistoryRepository($pdo);
    $priceHistoryRepository = new PriceHistoryRepository($pdo);
    $syncStatusRepository = new SyncStatusRepository($pdo);
    $cacheMaintenanceRepository = new CacheMaintenanceRepository($pdo);
    $userFeeSettingsRepository = new UserFeeSettingsRepository($pdo);
    $userPriceSourcePreferenceRepository = new UserPriceSourcePreferenceRepository($pdo);
    $userRepository = new UserRepository($pdo);
    $watchlistRepository = new WatchlistRepository($pdo);

    // Ensure tables exist with new schema
    $itemRepository->ensureTable();
    $itemLiveCacheRepository->ensureTable();
    $syncStatusRepository->ensureTable();
    $watchlistRepository->ensureTable();
    $userRepository->ensureDefaultUser();
    (new SyncService($pdo, new SyncEntityService($pdo)))->ensureTables();

    $idempotencyRetentionDaysRaw = getenv('SYNC_IDEMPOTENCY_RETENTION_DAYS');
    $idempotencyRetentionDays = is_numeric($idempotencyRetentionDaysRaw) ? (int) $idempotencyRetentionDaysRaw : 30;
    $idempotencyDeletedRows = cleanupSyncIdempotency($pdo, $idempotencyRetentionDays);
    fwrite(
        STDOUT,
        "[" . date('Y-m-d H:i:s') . "] sync_idempotency cleanup: deleted {$idempotencyDeletedRows} rows (retention {$idempotencyRetentionDays}d)\n"
    );

    // Run cache maintenance (cleanup old entries)
    fwrite(STDOUT, "[" . date('Y-m-d H:i:s') . "] Running cache maintenance...\n");
    $cleanupStats = $cacheMaintenanceRepository->runAllCleanups();
    if ($cleanupStats['liveCacheDeleted'] > 0) {
        fwrite(STDOUT, "  Cleaned up {$cleanupStats['liveCacheDeleted']} old live cache entries (>72h)\n");
    }
    if ($cleanupStats['catalogCacheDeleted'] > 0) {
        fwrite(STDOUT, "  Cleaned up {$cleanupStats['catalogCacheDeleted']} old catalog cache entries (>7d)\n");
    }
    fwrite(STDOUT, "  Price history: Kept all {$cleanupStats['priceHistoryDeleted']} entries (unbegrenzte Aufbewahrung)\n");

    // Initialize external clients
    $csFloatClient = new CsFloatClient();
    $exchangeRateClient = new ExchangeRateClient();
    $steamMarketClient = new SteamMarketClient();

    // Initialize support services
    $marketItemClassifier = new \App\Application\Support\MarketItemClassifier();

    // Initialize pricing service
    $pricingService = new PricingService(
        $csFloatClient,
        $exchangeRateClient,
        $steamMarketClient,
        $marketItemClassifier,
        $itemRepository,
        $exchangeRateRepository,
        $itemLiveCacheRepository,
        $userPriceSourcePreferenceRepository
    );
    $feeSettingsService = new FeeSettingsService($userFeeSettingsRepository);
    $feeCalculationService = new FeeCalculationService();
    $portfolioService = new PortfolioService(
        $investmentRepository,
        $exchangeRateRepository,
        $positionHistoryRepository,
        $portfolioHistoryRepository,
        $priceHistoryRepository,
        $pricingService,
        $feeSettingsService,
        $feeCalculationService
    );
    $queueService = new PriceRefreshQueueService(
        $pdo,
        $pricingService,
        $priceHistoryRepository
    );

    $priceListImportService = new PriceListBulkImportService(
        $pdo,
        $csFloatClient,
        $exchangeRateClient,
        $exchangeRateRepository,
        $itemRepository,
        $itemLiveCacheRepository,
        $priceHistoryRepository
    );
    $bulkResult = $priceListImportService->importAll();
    if ($bulkResult['error'] !== null) {
        $errorCount++;
        fwrite(STDERR, "  x Bulk price list import failed: {$bulkResult['error']}\n");
    } else {
        $truncatedLabel = $bulkResult['truncated'] ? ' (truncated)' : '';
        fwrite(
            STDOUT,
            "[" . date('Y-m-d H:i:s') . "] Bulk price list: total={$bulkResult['total']}, processed={$bulkResult['processed']}, " .
            "insertedItems={$bulkResult['insertedItems']}, cacheUpserts={$bulkResult['cacheUpserts']}, " .
            "historyUpserts={$bulkResult['historyUpserts']}, skipped={$bulkResult['skipped']}, " .
            "durationMs={$bulkResult['durationMs']}{$truncatedLabel}\n"
        );
    }

    $planStats = $queueService->planHourlyQueue();
    fwrite(
        STDOUT,
        "[" . date('Y-m-d H:i:s') . "] Planned queue: total={$planStats['total']}, " .
        "P1={$planStats['priority1']}, P2={$planStats['priority2']}, P3={$planStats['priority3']}\n"
    );

    $kickoffBatchRaw = getenv('PRICE_QUEUE_KICKOFF_BATCH');
    $kickoffBatch = is_numeric($kickoffBatchRaw)
        ? (int) $kickoffBatchRaw
        : max(0, (int) ($planStats['total'] ?? 0));
    $kickoffBatch = max(0, min($kickoffBatch, 10000));
    if ($kickoffBatch > 0) {
        $kickoffResult = $queueService->processDueQueue($kickoffBatch);
        $syncedCount = (int) ($kickoffResult['success'] ?? 0);
        $rateLimitedCount += (int) ($kickoffResult['rateLimited'] ?? 0);
        $errorCount += (int) ($kickoffResult['failed'] ?? 0);
        fwrite(
            STDOUT,
            "[" . date('Y-m-d H:i:s') . "] Queue kickoff: processed={$kickoffResult['processed']}, " .
            "success={$kickoffResult['success']}, rateLimited={$kickoffResult['rateLimited']}, failed={$kickoffResult['failed']}\n"
        );
    }
    $userIds = $pdo->query('SELECT id FROM users WHERE is_active = 1')
        ?->fetchAll(\PDO::FETCH_COLUMN, 0) ?: [];
    if ($userIds === []) {
        $userIds = [1];
    }
    $userIds = array_values(array_unique(array_map('intval', $userIds)));

    // Persist portfolio snapshots per user using queued/cached prices.
    fwrite(STDOUT, "[" . date('Y-m-d H:i:s') . "] Saving snapshots for " . count($userIds) . " users...\n");
    foreach ($userIds as $userId) {
        try {
            $snapshotResult = $portfolioService->saveDailyValue($userId);
            $snapshotSaved = true;
            $snapshotTime = (string) ($snapshotResult['date'] ?? '');
            fwrite(STDOUT, "  User {$userId} snapshot saved for {$snapshotTime}\n");
            $syncStatusRepository->updateStatus(
                $userId,
                $syncSource,
                'success',
                null
            );
        } catch (Throwable $snapshotError) {
            $errorCount++;
            fwrite(STDERR, "  User {$userId} snapshot failed: {$snapshotError->getMessage()}\n");
            $syncStatusRepository->updateStatus(
                $userId,
                $syncSource,
                'failed',
                $snapshotError->getMessage()
            );
        }
    }

    // Check for warnings (rate limiting, etc)
    $warnings = $pricingService->consumeWarnings();
    foreach ($warnings as $warning) {
        if (isset($warning['statusCode']) && $warning['statusCode'] === 429) {
            $rateLimitedCount = $warning['occurrences'] ?? 0;
            fwrite(STDERR, "  ⚠ Rate limited ({$rateLimitedCount} items affected)\n");
            $status = 'partial';
        }
    }

    // Determine final status
    if ($errorCount > 0 && $syncedCount === 0) {
        $status = 'failed';
        $errorMessage = "All items failed to sync. Error count: {$errorCount}";
    } elseif ($errorCount > 0 || $rateLimitedCount > 0) {
        $status = 'partial';
        $errorMessage = "Partial sync: queue success {$syncedCount}, {$errorCount} errors, {$rateLimitedCount} rate-limited";
    }

    $duration = round(microtime(true) - $startTime, 2);
    fwrite(STDOUT, "[" . date('Y-m-d H:i:s') . "] Sync complete!\n");
    fwrite(STDOUT, "  Status: {$status}, Queue synced: {$syncedCount}, Snapshot: " . ($snapshotSaved ? 'saved' : 'failed') . ", Errors: {$errorCount}, Rate-limited: {$rateLimitedCount}, Duration: {$duration}s\n");

    // Log global status snapshot as compatibility row.
    $syncStatusRepository->updateStatus(
        $syncUserId,
        $syncSource,
        $status,
        $errorMessage
    );

    exit(0);

} catch (Throwable $e) {
    $errorMessage = $e->getMessage();
    fwrite(STDERR, "FATAL ERROR: {$errorMessage}\n");
    fwrite(STDERR, $e->getTraceAsString() . "\n");
    
    try {
        $duration = round(microtime(true) - $startTime, 2);
        if ($syncStatusRepository !== null) {
            $syncStatusRepository->updateStatus(
                $syncUserId,
                $syncSource,
                'failed',
                $errorMessage
            );
        }
    } catch (Throwable $logError) {
        fwrite(STDERR, "Failed to log error: " . $logError->getMessage() . "\n");
    }
    
    exit(1);
}


