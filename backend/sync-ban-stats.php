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

use App\Application\Service\BanStatsIngestService;
use App\Config\DatabaseConfig;
use App\Infrastructure\External\CsStatsBansClient;
use App\Infrastructure\External\VacBanApiClient;
use App\Infrastructure\Persistence\DatabaseConnectionFactory;
use App\Infrastructure\Persistence\Repository\BanStatsRepository;
use App\Infrastructure\Persistence\Repository\CsUpdatesFeedRepository;

$startedAt = microtime(true);

try {
    $pdo = (new DatabaseConnectionFactory(new DatabaseConfig()))->create();

    $banStatsRepository = new BanStatsRepository($pdo);
    $banStatsRepository->ensureTable();

    // Clamp to [0.1, 10.0] — lower bound allows override testing with BAN_WAVE_THRESHOLD=0.1
    $threshold = (float) (getenv('BAN_WAVE_THRESHOLD') ?: 2.5);
    $threshold = max(0.1, min(10.0, $threshold));

    $minCount = (int) (getenv('BAN_WAVE_MIN_COUNT') ?: 200);
    $minCount = max(0, $minCount);

    $service = new BanStatsIngestService(
        new VacBanApiClient(),
        new CsStatsBansClient(),
        $banStatsRepository,
        new CsUpdatesFeedRepository($pdo),
        $threshold,
        7,
        14,
        $minCount
    );

    $result = $service->ingest();
    $duration = round(microtime(true) - $startedAt, 2);
    $errorStr = count($result['errors']) > 0 ? implode('; ', $result['errors']) : 'none';

    fwrite(
        STDOUT,
        '[' . gmdate('Y-m-d H:i:s') . '] ban-stats-ingest: ' .
        'vac_ban_rows=' . $result['vacBanRows'] . ', ' .
        'csstats_rows=' . $result['csstatsRows'] . ', ' .
        'wave_detected=' . ($result['waveDetected'] ? 'yes' : 'no') . ', ' .
        'wave_feed_inserted=' . ($result['waveFeedInserted'] ? 'yes' : 'no') . ', ' .
        'errors=' . $errorStr . ', ' .
        'duration=' . $duration . "s\n"
    );

    exit(0);
} catch (Throwable $exception) {
    fwrite(STDERR, 'FATAL ERROR: ' . $exception->getMessage() . "\n");
    fwrite(STDERR, $exception->getTraceAsString() . "\n");
    exit(1);
}
