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
use App\Application\Service\SyncService;
use App\Application\Service\WatchlistService;
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
use App\Infrastructure\Persistence\Repository\UserRepository;
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

/**
 * Mirrors current live cache prices into scalable pricing tables.
 * Safe no-op when scalable tables are not present yet.
 *
 * @return array{skipped:bool,latestUpserts:int,hourlyUpserts:int,error:?string}
 */
function mirrorScalablePriceTables(\PDO $pdo): array
{
    try {
        $latestExists = (bool) ($pdo->query("SHOW TABLES LIKE 'item_price_latest'")?->fetchColumn() ?: false);
        $hourlyExists = (bool) ($pdo->query("SHOW TABLES LIKE 'item_price_history_hourly'")?->fetchColumn() ?: false);

        if (!$latestExists || !$hourlyExists) {
            return [
                'skipped' => true,
                'latestUpserts' => 0,
                'hourlyUpserts' => 0,
                'error' => null,
            ];
        }

        $latestSql = "INSERT INTO item_price_latest (
                item_id, price_usd, exchange_rate_id, price_source, provider_timestamp, fetched_at
            )
            SELECT
                ilc.item_id,
                ilc.price_usd,
                ilc.exchange_rate_id,
                COALESCE(ilc.price_source, 'sync'),
                ilc.fetched_at,
                ilc.fetched_at
            FROM item_live_cache ilc
            ON DUPLICATE KEY UPDATE
                price_usd = VALUES(price_usd),
                exchange_rate_id = VALUES(exchange_rate_id),
                price_source = VALUES(price_source),
                provider_timestamp = VALUES(provider_timestamp),
                fetched_at = VALUES(fetched_at)";
        $latestStmt = $pdo->prepare($latestSql);
        $latestStmt->execute();
        $latestAffected = $latestStmt->rowCount();

        $hourlySql = "INSERT INTO item_price_history_hourly (
                item_id, bucket_start, price_usd, exchange_rate_id, price_source, provider_timestamp
            )
            SELECT
                ilc.item_id,
                DATE_FORMAT(ilc.fetched_at, '%Y-%m-%d %H:00:00'),
                ilc.price_usd,
                ilc.exchange_rate_id,
                COALESCE(ilc.price_source, 'sync'),
                ilc.fetched_at
            FROM item_live_cache ilc
            ON DUPLICATE KEY UPDATE
                price_usd = VALUES(price_usd),
                exchange_rate_id = VALUES(exchange_rate_id),
                price_source = VALUES(price_source),
                provider_timestamp = VALUES(provider_timestamp)";
        $hourlyStmt = $pdo->prepare($hourlySql);
        $hourlyStmt->execute();
        $hourlyAffected = $hourlyStmt->rowCount();

        return [
            'skipped' => false,
            'latestUpserts' => $latestAffected,
            'hourlyUpserts' => $hourlyAffected,
            'error' => null,
        ];
    } catch (Throwable $exception) {
        return [
            'skipped' => false,
            'latestUpserts' => 0,
            'hourlyUpserts' => 0,
            'error' => $exception->getMessage(),
        ];
    }
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
    $watchlistRepository = new WatchlistRepository($pdo);
    $userFeeSettingsRepository = new UserFeeSettingsRepository($pdo);
    $userRepository = new UserRepository($pdo);

    // Ensure tables exist with new schema
    $itemRepository->ensureTable();
    $itemLiveCacheRepository->ensureTable();
    $syncStatusRepository->ensureTable();
    $userRepository->ensureDefaultUser();
    (new SyncService($pdo))->ensureTables();

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
        $itemLiveCacheRepository
    );
    $feeSettingsService = new FeeSettingsService($userFeeSettingsRepository);
    $portfolioService = new PortfolioService(
        $investmentRepository,
        $exchangeRateRepository,
        $positionHistoryRepository,
        $portfolioHistoryRepository,
        $priceHistoryRepository,
        $pricingService,
        $feeSettingsService
    );
    $watchlistService = new WatchlistService(
        $watchlistRepository,
        $itemRepository,
        $priceHistoryRepository,
        $pricingService,
        $steamMarketClient
    );

    // Get all unique item names from portfolio holdings.
    $sql = 'SELECT DISTINCT it.market_hash_name
            FROM investments inv
            INNER JOIN items it ON it.id = inv.item_id
            WHERE it.market_hash_name IS NOT NULL AND it.market_hash_name <> ""';
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

    $userIds = $pdo->query('SELECT id FROM users WHERE is_active = 1')
        ?->fetchAll(\PDO::FETCH_COLUMN, 0) ?: [];
    if ($userIds === []) {
        $userIds = [1];
    }
    $userIds = array_values(array_unique(array_map('intval', $userIds)));

    // Sync watchlist prices and persist snapshots per user.
    fwrite(STDOUT, "[" . date('Y-m-d H:i:s') . "] Syncing watchlist + snapshots for " . count($userIds) . " users...\n");
    foreach ($userIds as $userId) {
        try {
            $watchlistSyncResult = $watchlistService->refreshPrices($userId);
            $watchlistSyncedCount += (int) ($watchlistSyncResult['updated'] ?? 0);
            $watchlistTotalItems = (int) ($watchlistSyncResult['totalItems'] ?? 0);
            fwrite(STDOUT, "  User {$userId} watchlist synced: " . (int) ($watchlistSyncResult['updated'] ?? 0) . "/{$watchlistTotalItems}\n");
        } catch (Throwable $watchlistError) {
            $errorCount++;
            fwrite(STDERR, "  User {$userId} watchlist sync failed: {$watchlistError->getMessage()}\n");
        }

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

    $scalableMirror = mirrorScalablePriceTables($pdo);
    if ($scalableMirror['skipped']) {
        fwrite(STDOUT, "  i Scalable price mirror skipped (tables not present)\n");
    } elseif ($scalableMirror['error'] !== null) {
        $errorCount++;
        fwrite(STDERR, "  x Scalable price mirror failed: {$scalableMirror['error']}\n");
    } else {
        fwrite(
            STDOUT,
            "  ok Scalable price mirror: latest={$scalableMirror['latestUpserts']}, hourly={$scalableMirror['hourlyUpserts']}\n"
        );
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

