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

use App\Application\Service\CsUpdatesAiRatingService;
use App\Config\DatabaseConfig;
use App\Infrastructure\External\GeminiUpdateRaterClient;
use App\Infrastructure\Persistence\DatabaseConnectionFactory;
use App\Infrastructure\Persistence\Repository\CsUpdatesFeedRepository;

$startedAt = microtime(true);

try {
    $client = GeminiUpdateRaterClient::fromEnv();
    if (!$client instanceof GeminiUpdateRaterClient) {
        fwrite(STDOUT, '[' . gmdate('Y-m-d H:i:s') . "] cs-updates-ai-rating: disabled (missing CS_UPDATES_AI_ENABLED or GEMINI_API_KEY)\n");
        exit(0);
    }

    $pdo = (new DatabaseConnectionFactory(new DatabaseConfig()))->create();
    $service = new CsUpdatesAiRatingService(
        new CsUpdatesFeedRepository($pdo),
        $client
    );

    $limit = (int) (getenv('CS_UPDATES_AI_BATCH_SIZE') ?: 12);
    if ($limit < 1) {
        $limit = 1;
    }
    if ($limit > 100) {
        $limit = 100;
    }

    $minAgeSeconds = (int) (getenv('CS_UPDATES_AI_MIN_AGE_SECONDS') ?: 45);
    if ($minAgeSeconds < 0) {
        $minAgeSeconds = 0;
    }

    $result = $service->ratePending($limit, $minAgeSeconds);
    $duration = round(microtime(true) - $startedAt, 2);

    fwrite(
        STDOUT,
        '[' . gmdate('Y-m-d H:i:s') . '] cs-updates-ai-rating: ' .
        'model=' . $result['model'] . ', ' .
        'pending=' . $result['pendingFound'] . ', ' .
        'rated=' . $result['ratedCount'] . ', ' .
        'failed=' . $result['failedCount'] . ', ' .
        'duration=' . $duration . "s\n"
    );

    exit(0);
} catch (Throwable $exception) {
    fwrite(STDERR, 'FATAL ERROR: ' . $exception->getMessage() . "\n");
    fwrite(STDERR, $exception->getTraceAsString() . "\n");
    exit(1);
}

