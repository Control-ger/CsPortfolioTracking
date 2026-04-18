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

if (!is_file($bootstrapPath)) {
    fwrite(STDERR, "ERROR: Bootstrap file not found at {$bootstrapPath}\n");
    exit(1);
}

require_once $bootstrapPath;

use App\Application\Service\PortfolioService;
use App\Application\Service\PricingService;
use App\Config\DatabaseConfig;
use App\Infrastructure\External\CsFloatClient;
use App\Infrastructure\External\ExchangeRateClient;
use App\Infrastructure\External\SteamMarketClient;
use App\Infrastructure\Persistence\DatabaseConnectionFactory;
use App\Infrastructure\Persistence\Repository\InvestmentRepository;
use App\Infrastructure\Persistence\Repository\ItemCatalogRepository;
use App\Infrastructure\Persistence\Repository\ItemLiveCacheRepository;
use App\Infrastructure\Persistence\Repository\PortfolioHistoryRepository;
use App\Infrastructure\Persistence\Repository\PositionHistoryRepository;
use App\Infrastructure\Persistence\Repository\PriceHistoryRepository;
use App\Infrastructure\Persistence\Repository\SyncStatusRepository;
use App\Shared\Logger;

$startTime = microtime(true);
$syncedCount = 0;
$errorCount = 0;
$rateLimitedCount = 0;
$status = 'success';
$errorMessage = null;

try {
    fwrite(STDOUT, "[" . date('Y-m-d H:i:s') . "] Starting CSFloat price sync...\n");

    // Initialize database connection
    $dbConfig = DatabaseConfig::fromEnv();
    $pdo = DatabaseConnectionFactory::create($dbConfig);

    // Initialize repositories
    $itemCatalogRepository = new ItemCatalogRepository($pdo);
    $itemLiveCacheRepository = new ItemLiveCacheRepository($pdo);
    $investmentRepository = new InvestmentRepository($pdo);
    $portfolioHistoryRepository = new PortfolioHistoryRepository($pdo);
    $positionHistoryRepository = new PositionHistoryRepository($pdo);
    $priceHistoryRepository = new PriceHistoryRepository($pdo);
    $syncStatusRepository = new SyncStatusRepository($pdo);

    // Ensure tables exist with new schema
    $itemCatalogRepository->ensureTable();
    $itemLiveCacheRepository->ensureTable();
    $syncStatusRepository->ensureTable();

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

    // Get all unique item names from portfolio
    $sql = 'SELECT DISTINCT market_hash_name FROM investments WHERE market_hash_name IS NOT NULL';
    $stmt = $pdo->query($sql);
    $items = $stmt->fetchAll(\PDO::FETCH_COLUMN, 0);

    if (empty($items)) {
        fwrite(STDOUT, "[" . date('Y-m-d H:i:s') . "] No items found in portfolio. Nothing to sync.\n");
        $duration = round(microtime(true) - $startTime, 2);
        $syncStatusRepository->recordSync('success', 0, 0, 0, 'No items in portfolio', $duration);
        exit(0);
    }

    fwrite(STDOUT, "[" . date('Y-m-d H:i:s') . "] Found " . count($items) . " unique items to sync.\n");

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
        $errorMessage = "Partial sync: {$syncedCount} synced, {$errorCount} errors, {$rateLimitedCount} rate-limited";
    }

    $duration = round(microtime(true) - $startTime, 2);
    fwrite(STDOUT, "[" . date('Y-m-d H:i:s') . "] Sync complete!\n");
    fwrite(STDOUT, "  Status: {$status}, Synced: {$syncedCount}, Errors: {$errorCount}, Rate-limited: {$rateLimitedCount}, Duration: {$duration}s\n");

    // Log to database
    $syncStatusRepository->recordSync($status, $syncedCount, $errorCount, $rateLimitedCount, $errorMessage, $duration);

    exit(0);

} catch (Throwable $e) {
    $errorMessage = $e->getMessage();
    fwrite(STDERR, "FATAL ERROR: {$errorMessage}\n");
    fwrite(STDERR, $e->getTraceAsString() . "\n");
    
    try {
        $duration = round(microtime(true) - $startTime, 2);
        $syncStatusRepository->recordSync('failed', $syncedCount, $errorCount, $rateLimitedCount, $errorMessage, $duration);
    } catch (Throwable $logError) {
        fwrite(STDERR, "Failed to log error: " . $logError->getMessage() . "\n");
    }
    
    exit(1);
}

