<?php
declare(strict_types=1);

set_time_limit(120);

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

use App\Application\Service\CsUpdatesIngestService;
use App\Application\Service\WebPushService;
use App\Infrastructure\External\SteamDbPatchnotesClient;
use App\Config\DatabaseConfig;
use App\Infrastructure\External\SteamDbRssClient;
use App\Infrastructure\External\SteamNewsClient;
use App\Infrastructure\Persistence\DatabaseConnectionFactory;
use App\Infrastructure\Persistence\Repository\CsUpdatesFeedRepository;
use App\Infrastructure\Persistence\Repository\WebPushSubscriptionRepository;

$startedAt = microtime(true);

try {
    $pdo = (new DatabaseConnectionFactory(new DatabaseConfig()))->create();
    $repository = new CsUpdatesFeedRepository($pdo);
    $webPushSubscriptionRepository = new WebPushSubscriptionRepository($pdo);
    $service = new CsUpdatesIngestService(
        new SteamDbRssClient(),
        new SteamNewsClient(),
        $repository,
        new SteamDbPatchnotesClient(),
        $webPushSubscriptionRepository,
        WebPushService::fromEnv()
    );

    $result = $service->ingest();
    $duration = round(microtime(true) - $startedAt, 2);

    fwrite(
        STDOUT,
        '[' . gmdate('Y-m-d H:i:s') . '] cs-updates-ingest: ' .
        'source=' . $result['sourceUrl'] . ', ' .
        'total=' . $result['totalEntries'] . ', ' .
        'inserted=' . $result['insertedCount'] . ', ' .
        'updated=' . $result['updatedCount'] . ', ' .
        'skipped=' . $result['skippedCount'] . ', ' .
        'duration=' . $duration . "s\n"
    );

    exit(0);
} catch (Throwable $exception) {
    fwrite(STDERR, 'FATAL ERROR: ' . $exception->getMessage() . "\n");
    fwrite(STDERR, $exception->getTraceAsString() . "\n");
    exit(1);
}
