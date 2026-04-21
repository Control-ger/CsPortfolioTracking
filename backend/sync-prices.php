<?php
declare(strict_types=1);

/**
 * CSFloat Price Sync CLI Script
 * 
 * Syncs all portfolio item prices from CSFloat and caches them in the database.
 * Runs hourly via Supervisor to ensure always-fresh cache.
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

use App\Application\Service\PortfolioService;
use App\Application\Service\FeeSettingsService;
use App\Application\Service\PricingService;
use App\Application\Service\WatchlistService;
use App\Config\DatabaseConfig;
use App\Infrastructure\External\CsFloatClient;
use App\Infrastructure\External\ExchangeRateClient;
use App\Infrastructure\External\SteamMarketClient;
use App\Infrastructure\Persistence\DatabaseConnectionFactory;
use App\Infrastructure\Persistence\Repository\CacheMaintenanceRepository;
use App\Infrastructure\Persistence\Repository\InvestmentRepository;
use App\Infrastructure\Persistence\Repository\ItemCatalogRepository;
use App\Infrastructure\Persistence\Repository\ItemLiveCacheRepository;
use App\Infrastructure\Persistence\Repository\PortfolioHistoryRepository;
use App\Infrastructure\Persistence\Repository\PositionHistoryRepository;
use App\Infrastructure\Persistence\Repository\PriceHistoryRepository;
use App\Infrastructure\Persistence\Repository\SyncStatusRepository;
use App\Infrastructure\Persistence\Repository\UserFeeSettingsRepository;
use App\Infrastructure\Persistence\Repository\WatchlistRepository;

$startTime = microtime(true);
$syncedCount = 0;
$watchlistSyncedCount = 0;
$errorCount = 0;
$rateLimitedCount = 0;
$status = 'success';
$errorMessage = null;
$snapshotSaved = false;
$snapshotTime = null;
$syncStatusRepository = null;

try {
    fwrite(STDOUT, "[" . date('Y-m-d H:i:s') . "] Starting CSFloat price sync...\n");

    // Initialize database connection
    $dbConfig = new DatabaseConfig();
    $pdo = (new DatabaseConnectionFactory($dbConfig))->create();

    // Initialize repositories
    $itemCatalogRepository = new ItemCatalogRepository($pdo);
    $itemLiveCacheRepository = new ItemLiveCacheRepository($pdo);
    $investmentRepository = new InvestmentRepository($pdo);
    $portfolioHistoryRepository = new PortfolioHistoryRepository($pdo);
    $positionHistoryRepository = new PositionHistoryRepository($pdo);
    $priceHistoryRepository = new PriceHistoryRepository($pdo);
    $syncStatusRepository = new SyncStatusRepository($pdo);
    $cacheMaintenanceRepository = new CacheMaintenanceRepository($pdo);
    $watchlistRepository = new WatchlistRepository($pdo);
    $userFeeSettingsRepository = new UserFeeSettingsRepository($pdo);

    // Ensure tables exist with new schema
    $itemCatalogRepository->ensureTable();
    $itemLiveCacheRepository->ensureTable();
    $syncStatusRepository->ensureTable();

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
        $itemCatalogRepository,
        $itemLiveCacheRepository
    );
    $feeSettingsService = new FeeSettingsService($userFeeSettingsRepository);
    $portfolioService = new PortfolioService(
        $investmentRepository,
        $positionHistoryRepository,
        $portfolioHistoryRepository,
        $priceHistoryRepository,
        $pricingService,
        $feeSettingsService
    );
    $watchlistService = new WatchlistService(
        $watchlistRepository,
        $priceHistoryRepository,
        $pricingService
    );

    // Get all unique item names from portfolio
    $sql = 'SELECT DISTINCT name FROM investments WHERE name IS NOT NULL';
    $stmt = $pdo->query($sql);
    $items = $stmt->fetchAll(\PDO::FETCH_COLUMN, 0);

    if (empty($items)) {
        fwrite(STDOUT, "[" . date('Y-m-d H:i:s') . "] No portfolio items found. Continuing with watchlist and snapshot tasks.\n");
    }

    fwrite(STDOUT, "[" . date('Y-m-d H:i:s') . "] Found " . count($items) . " unique portfolio items to sync.\n");

    // Sync each item
    foreach ($items as $itemName) {
        try {
            $snapshot = $pricingService->getLivePriceSnapshot($itemName);
            if ($snapshot !== null) {
                $syncedCount++;
                fwrite(STDOUT, "  ✓ {$itemName}\n");
            }
        } catch (Throwable $e) {
            $errorCount++;
            fwrite(STDERR, "  ✗ {$itemName}: {$e->getMessage()}\n");
        }
    }

    // Sync watchlist prices as well (hourly snapshots for watchlist charts)
    fwrite(STDOUT, "[" . date('Y-m-d H:i:s') . "] Syncing watchlist live prices...\n");
    try {
        $watchlistSyncResult = $watchlistService->refreshPrices();
        $watchlistSyncedCount = (int) ($watchlistSyncResult['updated'] ?? 0);
        $watchlistTotalItems = (int) ($watchlistSyncResult['totalItems'] ?? 0);
        fwrite(STDOUT, "  Watchlist synced: {$watchlistSyncedCount}/{$watchlistTotalItems}\n");
    } catch (Throwable $watchlistError) {
        $errorCount++;
        fwrite(STDERR, "  Watchlist sync failed: {$watchlistError->getMessage()}\n");
    }

    // Persist hourly portfolio + position snapshots
    fwrite(STDOUT, "[" . date('Y-m-d H:i:s') . "] Saving hourly portfolio snapshot...\n");
    try {
        $snapshotResult = $portfolioService->saveDailyValue();
        $snapshotSaved = true;
        $snapshotTime = (string) ($snapshotResult['date'] ?? '');
        fwrite(STDOUT, "  Snapshot saved for {$snapshotTime}\n");
    } catch (Throwable $snapshotError) {
        $errorCount++;
        fwrite(STDERR, "  Portfolio snapshot failed: {$snapshotError->getMessage()}\n");
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
        $errorMessage = "Partial sync: {$syncedCount} portfolio items synced, {$watchlistSyncedCount} watchlist items synced, {$errorCount} errors, {$rateLimitedCount} rate-limited";
    }

    $duration = round(microtime(true) - $startTime, 2);
    fwrite(STDOUT, "[" . date('Y-m-d H:i:s') . "] Sync complete!\n");
    fwrite(STDOUT, "  Status: {$status}, Portfolio synced: {$syncedCount}, Watchlist synced: {$watchlistSyncedCount}, Snapshot: " . ($snapshotSaved ? 'saved' : 'failed') . ", Errors: {$errorCount}, Rate-limited: {$rateLimitedCount}, Duration: {$duration}s\n");

    // Log to database
    $syncStatusRepository->recordSync($status, $syncedCount, $errorCount, $rateLimitedCount, $errorMessage, $duration);

    exit(0);

} catch (Throwable $e) {
    $errorMessage = $e->getMessage();
    fwrite(STDERR, "FATAL ERROR: {$errorMessage}\n");
    fwrite(STDERR, $e->getTraceAsString() . "\n");
    
    try {
        $duration = round(microtime(true) - $startTime, 2);
        if ($syncStatusRepository !== null) {
            $syncStatusRepository->recordSync('failed', $syncedCount, $errorCount, $rateLimitedCount, $errorMessage, $duration);
        }
    } catch (Throwable $logError) {
        fwrite(STDERR, "Failed to log error: " . $logError->getMessage() . "\n");
    }
    
    exit(1);
}

