<?php
declare(strict_types=1);

use App\Application\Service\PortfolioService;
use App\Application\Service\FeeSettingsService;
use App\Application\Service\CsFloatTradeSyncService;
use App\Application\Service\PricingService;
use App\Application\Service\WatchlistService;
use App\Application\Support\MarketItemClassifier;
use App\Config\DatabaseConfig;
use App\Http\Controller\CsFloatSyncController;
use App\Http\Controller\DebugController;
use App\Http\Controller\ExchangeRateController;
use App\Http\Controller\PortfolioController;
use App\Http\Controller\SettingsController;
use App\Http\Controller\SteamAuthController;
use App\Http\Controller\SyncStatusController;
use App\Http\Controller\WatchlistController;
use App\Infrastructure\External\CsFloatClient;
use App\Infrastructure\External\CsFloatTradeClient;
use App\Infrastructure\External\ExchangeRateClient;
use App\Infrastructure\External\SteamMarketClient;
use App\Infrastructure\Persistence\DatabaseConnectionFactory;
use App\Infrastructure\Persistence\Repository\InvestmentRepository;
use App\Infrastructure\Persistence\Repository\ItemCatalogRepository;
use App\Infrastructure\Persistence\Repository\ItemLiveCacheRepository;
use App\Infrastructure\Persistence\Repository\ItemRepository;
use App\Infrastructure\Persistence\Repository\PortfolioHistoryRepository;
use App\Infrastructure\Persistence\Repository\PositionHistoryRepository;
use App\Infrastructure\Persistence\Repository\PriceHistoryRepository;
use App\Infrastructure\Persistence\Repository\UserRepository;
use App\Infrastructure\Persistence\Repository\SyncStatusRepository;
use App\Infrastructure\Persistence\Repository\UserFeeSettingsRepository;
use App\Infrastructure\Persistence\Repository\WatchlistRepository;
use App\Infrastructure\Persistence\Repository\AuthStateRepository;
use App\Infrastructure\Persistence\Repository\CacheMaintenanceRepository;
use App\Observability\Application\ObservabilityService;
use App\Observability\Context\RequestContext;
use App\Observability\Context\RequestContextStore;
use App\Observability\Http\Controller\FrontendTelemetryController;
use App\Observability\Http\Controller\ObservabilityController;
use App\Observability\Infrastructure\Persistence\ObservabilityEventRepository;
use App\Observability\Infrastructure\Sink\FileSink;
use App\Observability\Sanitization\ContextSanitizer;
use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Request;
use App\Shared\Http\Router;
use App\Shared\Logger;

$backendRoot = dirname(__DIR__);
$bootstrapPath = $backendRoot . '/src/bootstrap.php';

require_once $bootstrapPath;

// Fallback: lade .env direkt, falls bootstrap die Datei nicht gefunden hat.
$envFile = '/var/www/html/.env';
if (is_file($envFile)) {
    $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        if (str_starts_with(trim($line), '#') || strpos($line, '=') === false) {
            continue;
        }
        [$key, $value] = explode('=', $line, 2);
        $key = trim($key);
        $value = trim($value, " \t\n\r\0\x0B\"'");
        if (!getenv($key)) {
            $_ENV[$key] = $value;
            putenv("{$key}={$value}");
        }
    }
}

function obs_env_flag(string $key, bool $default = false): bool
{
    $value = getenv($key);
    if ($value === false && isset($_ENV[$key])) {
        $value = $_ENV[$key];
    }

    if ($value === false || $value === null || trim((string) $value) === '') {
        return $default;
    }

    return in_array(strtolower(trim((string) $value)), ['1', 'true', 'yes', 'on'], true);
}

function obs_env_int(string $key, int $default): int
{
    $value = getenv($key);
    if ($value === false && isset($_ENV[$key])) {
        $value = $_ENV[$key];
    }

    if (!is_numeric($value)) {
        return $default;
    }

    return (int) $value;
}

function obs_collect_headers(): array
{
    $headers = [];

    if (function_exists('getallheaders')) {
        $rawHeaders = getallheaders();
        if (is_array($rawHeaders)) {
            foreach ($rawHeaders as $key => $value) {
                $headers[strtolower((string) $key)] = (string) $value;
            }
        }
    }

    foreach ($_SERVER as $key => $value) {
        if (!is_string($value)) {
            continue;
        }

        if (str_starts_with($key, 'HTTP_')) {
            $headerName = strtolower(str_replace('_', '-', substr($key, 5)));
            $headers[$headerName] = $value;
            continue;
        }

        if (in_array($key, ['CONTENT_TYPE', 'CONTENT_LENGTH'], true)) {
            $headerName = strtolower(str_replace('_', '-', $key));
            $headers[$headerName] = $value;
        }
    }

    return $headers;
}

function obs_generate_request_id(): string
{
    try {
        return 'req_' . bin2hex(random_bytes(12));
    } catch (\Throwable) {
        return 'req_' . str_replace('.', '', uniqid('', true));
    }
}

function obs_validate_request_id(?string $value): bool
{
    if (!is_string($value)) {
        return false;
    }

    $candidate = trim($value);
    if ($candidate === '' || strlen($candidate) > 64) {
        return false;
    }

    return preg_match('/^[A-Za-z0-9._:-]+$/', $candidate) === 1;
}

function obs_resolve_request_id(array $headers): string
{
    $incoming = $headers['x-request-id'] ?? null;
    if (obs_validate_request_id($incoming)) {
        return trim((string) $incoming);
    }

    return obs_generate_request_id();
}

function obs_bootstrap_diagnostics(): array
{
    if (function_exists('app_bootstrap_diagnostics')) {
        $diagnostics = app_bootstrap_diagnostics();
        if (is_array($diagnostics)) {
            return [
                'envLoaded' => (bool) ($diagnostics['envLoaded'] ?? false),
                'envPath' => isset($diagnostics['envPath']) ? (string) $diagnostics['envPath'] : null,
                'autoloadReady' => (bool) ($diagnostics['autoloadReady'] ?? false),
            ];
        }
    }

    return [
        'envLoaded' => false,
        'envPath' => null,
        'autoloadReady' => false,
    ];
}

function obs_startup_marker_path(): string
{
    $pid = getmypid();
    $pidString = is_int($pid) && $pid > 0 ? (string) $pid : 'unknown';

    return rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR)
        . DIRECTORY_SEPARATOR
        . 'csportfolio_startup_logged_'
        . $pidString
        . '.flag';
}

function obs_should_emit_startup_events(): bool
{
    $path = obs_startup_marker_path();
    if (is_file($path)) {
        return false;
    }

    $written = @file_put_contents($path, (string) time());
    if ($written === false) {
        // Fallback: emit startup events even if marker cannot be written.
        return true;
    }

    return true;
}

$corsAllowedOriginsRaw = getenv('CORS_ALLOWED_ORIGINS') ?: ($_ENV['CORS_ALLOWED_ORIGINS'] ?? '');
$requestOrigin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
$requestHost = (string) ($_SERVER['HTTP_HOST'] ?? '');
$isCorsOriginAllowed = static function (string $origin, string $host, string $allowedOriginsRaw): bool {
    if ($origin === '') {
        return true;
    }

    if (strtolower($origin) === 'null') {
        return false;
    }

    $parsedHost = parse_url($origin, PHP_URL_HOST);
    $parsedScheme = parse_url($origin, PHP_URL_SCHEME);
    if (!is_string($parsedHost) || !is_string($parsedScheme)) {
        return false;
    }

    $requestHostOnly = explode(':', $host)[0] ?? $host;
    if ($requestHostOnly !== '' && strcasecmp($parsedHost, $requestHostOnly) === 0 && in_array(strtolower($parsedScheme), ['http', 'https'], true)) {
        return true;
    }

    if (preg_match('#^(localhost|127\.0\.0\.1)$#i', $parsedHost) === 1 && in_array(strtolower($parsedScheme), ['http', 'https'], true)) {
        return true;
    }

    $configured = array_values(array_filter(array_map('trim', explode(',', (string) $allowedOriginsRaw))));
    foreach ($configured as $allowedOrigin) {
        if (strcasecmp($origin, $allowedOrigin) === 0) {
            return true;
        }
    }

    return false;
};

if (!$isCorsOriginAllowed($requestOrigin, $requestHost, (string) $corsAllowedOriginsRaw)) {
    http_response_code(403);
    header('Content-Type: application/json');
    echo json_encode([
        'success' => false,
        'error' => 'Origin not allowed',
        'code' => 'CORS_ORIGIN_DENIED',
    ], JSON_UNESCAPED_SLASHES);
    exit;
}

if ($requestOrigin !== '') {
    header('Access-Control-Allow-Origin: ' . $requestOrigin);
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Request-Id');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$requestHeaders = obs_collect_headers();
$requestId = obs_resolve_request_id($requestHeaders);
header('X-Request-Id: ' . $requestId);

$request = Request::fromGlobals($requestId, $requestHeaders);
$requestStartedAt = microtime(true);
RequestContextStore::set(
    new RequestContext(
        requestId: $requestId,
        method: $request->method,
        path: $request->path,
        userAgent: $request->headers['user-agent'] ?? null,
        ip: $_SERVER['REMOTE_ADDR'] ?? null
    )
);

$observabilityService = new ObservabilityService(
    eventRepository: null,
    fileSink: new FileSink(),
    contextSanitizer: new ContextSanitizer(),
    dbWriteEnabled: obs_env_flag('OBSERVABILITY_ENABLED', true)
);
Logger::setObservabilityService($observabilityService);

$bootstrapDiagnostics = obs_bootstrap_diagnostics();
$emitStartupEvents = obs_should_emit_startup_events();
if ($emitStartupEvents) {
    Logger::event(
        'info',
        'system',
        'system.bootstrap.completed',
        'System bootstrap completed',
        [
            'envLoaded' => $bootstrapDiagnostics['envLoaded'],
            'envPath' => $bootstrapDiagnostics['envPath'],
            'autoloadReady' => $bootstrapDiagnostics['autoloadReady'],
            'pid' => getmypid(),
        ]
    );
    Logger::event(
        'info',
        'system',
        'system.config.active',
        'Active system configuration loaded',
        [
            'debug' => obs_env_flag('DEBUG', false),
            'observabilityEnabled' => obs_env_flag('OBSERVABILITY_ENABLED', true),
            'observabilityEventsApiEnabled' => obs_env_flag('OBSERVABILITY_EVENTS_API_ENABLED', false),
            'observabilityFrontendTelemetryEnabled' => obs_env_flag('OBSERVABILITY_FRONTEND_TELEMETRY_ENABLED', false),
            'observabilityRetentionDays' => obs_env_int('OBSERVABILITY_RETENTION_DAYS', 30),
        ]
    );
}

Logger::event(
    'debug',
    'http',
    'http.request.started',
    'HTTP request started',
    [
        'method' => $request->method,
        'route' => $request->path,
        'requestId' => $requestId,
    ]
);

if ($request->jsonDecodeError !== null) {
    Logger::event(
        'warning',
        'error',
        'error.json_decode',
        'Request JSON decode failed',
        [
            'method' => $request->method,
            'route' => $request->path,
            'error' => $request->jsonDecodeError,
        ]
    );
}

$databaseConfig = new DatabaseConfig();

try {
    try {
        $pdo = (new DatabaseConnectionFactory($databaseConfig))->create();
        if ($emitStartupEvents) {
            Logger::event(
                'info',
                'system',
                'system.db.ready',
                'Database is ready',
                [
                    'ready' => true,
                    'host' => $databaseConfig->host,
                    'database' => $databaseConfig->database,
                ]
            );
        }
    } catch (\Throwable $dbException) {
        if ($emitStartupEvents) {
            Logger::event(
                'error',
                'system',
                'system.db.ready',
                'Database is not ready',
                [
                    'ready' => false,
                    'host' => $databaseConfig->host,
                    'database' => $databaseConfig->database,
                    'exception' => $dbException,
                ]
            );
        }
        throw $dbException;
    }

    $observabilityRepository = new ObservabilityEventRepository(
        $pdo,
        obs_env_int('OBSERVABILITY_RETENTION_DAYS', 30)
    );
    $observabilityService->setRepository($observabilityRepository);

    $investmentRepository = new InvestmentRepository($pdo);
    $positionHistoryRepository = new PositionHistoryRepository($pdo);
    $portfolioHistoryRepository = new PortfolioHistoryRepository($pdo);
    $watchlistRepository = new WatchlistRepository($pdo);
    $priceHistoryRepository = new PriceHistoryRepository($pdo);
    $itemRepository = new ItemRepository($pdo);
    $itemCatalogRepository = new ItemCatalogRepository($pdo);
    $itemLiveCacheRepository = new ItemLiveCacheRepository($pdo);
    $syncStatusRepository = new SyncStatusRepository($pdo);
    $userFeeSettingsRepository = new UserFeeSettingsRepository($pdo);
    $userRepository = new UserRepository($pdo);
    $userRepository->ensureDefaultUser();
    
    // Initialize auth state tokens table for Steam OpenID
    (new AuthStateRepository($pdo))->ensureTable();
    $feeSettingsService = new FeeSettingsService($userFeeSettingsRepository);

    $pricingService = new PricingService(
        new CsFloatClient(),
        new ExchangeRateClient(),
        new SteamMarketClient(),
        new MarketItemClassifier(),
        $itemCatalogRepository,
        $itemLiveCacheRepository
    );
    $csFloatTradeSyncService = new CsFloatTradeSyncService(
        new CsFloatTradeClient(),
        $itemRepository,
        $investmentRepository,
        $pricingService,
        new MarketItemClassifier()
    );
    $portfolioService = new PortfolioService(
        $investmentRepository,
        $positionHistoryRepository,
        $portfolioHistoryRepository,
        $priceHistoryRepository,
        $pricingService,
        $feeSettingsService
    );
    $watchlistService = new WatchlistService($watchlistRepository, $priceHistoryRepository, $pricingService);
    $settingsController = new SettingsController($feeSettingsService);

    $portfolioController = new PortfolioController($portfolioService);
    $watchlistController = new WatchlistController($watchlistService);
    $debugController = new DebugController($observabilityRepository);
    $observabilityController = new ObservabilityController($observabilityRepository);
    $frontendTelemetryController = new FrontendTelemetryController();
    $syncStatusController = new SyncStatusController($syncStatusRepository);
    $csFloatSyncController = new CsFloatSyncController($csFloatTradeSyncService, $syncStatusRepository);
    $exchangeRateController = new ExchangeRateController(new ExchangeRateClient());
    $steamAuthController = new SteamAuthController($pdo, $userRepository);

    $router = new Router();
    $router->register('GET', '/api/v1/portfolio/investments', [$portfolioController, 'investments']);
    $router->register('GET', '/api/v1/portfolio/investments/{id}/history', [$portfolioController, 'investmentHistory']);
    $router->register('PUT', '/api/v1/portfolio/investments/{id}/exclude', [$portfolioController, 'toggleExcludeInvestment']);
    $router->register('GET', '/api/v1/portfolio/summary', [$portfolioController, 'summary']);
    $router->register('GET', '/api/v1/portfolio/history', [$portfolioController, 'history']);
    $router->register('GET', '/api/v1/portfolio/composition', [$portfolioController, 'composition']);
    $router->register('PUT', '/api/v1/portfolio/daily-value', [$portfolioController, 'saveDailyValue']);
    $router->register('POST', '/api/v1/portfolio/sync/csfloat/preview', [$csFloatSyncController, 'preview']);
    $router->register('POST', '/api/v1/portfolio/sync/csfloat/execute', [$csFloatSyncController, 'execute']);
    $router->register('GET', '/api/v1/portfolio/sync-status', [$syncStatusController, 'status']);
    $router->register('GET', '/api/v1/portfolio/sync-history', [$syncStatusController, 'history']);
    $router->register('GET', '/api/v1/portfolio/sync-stats', [$syncStatusController, 'stats']);
    $router->register('GET', '/api/v1/settings/fees', [$settingsController, 'fees']);
    $router->register('PUT', '/api/v1/settings/fees', [$settingsController, 'updateFees']);
    $router->register('GET', '/api/v1/settings/csfloat-api-key', [$settingsController, 'getCsFloatApiKeyStatus']);
    $router->register('POST', '/api/v1/settings/csfloat-api-key', [$settingsController, 'updateCsFloatApiKey']);
    $router->register('GET', '/api/v1/exchange-rate', [$exchangeRateController, 'getRates']);

    $router->register('GET', '/api/v1/watchlist', [$watchlistController, 'list']);
    $router->register('GET', '/api/v1/watchlist/search', [$watchlistController, 'search']);
    $router->register('POST', '/api/v1/watchlist', [$watchlistController, 'create']);
    $router->register('DELETE', '/api/v1/watchlist/{id}', [$watchlistController, 'delete']);
    $router->register('POST', '/api/v1/watchlist/prices/refresh', [$watchlistController, 'refresh']);

    $router->register('GET', '/api/v1/debug/logs', [$debugController, 'logs']);
    $router->register('GET', '/api/v1/debug/csfloat', [$debugController, 'csfloatDebug']);
    $router->register('GET', '/api/v1/debug/cache/stats', function () use ($pdo) {
        $cacheMaintenanceRepository = new CacheMaintenanceRepository($pdo);
        JsonResponseFactory::success([
            'cacheStats' => $cacheMaintenanceRepository->getCacheStatistics(),
            'maintenanceLogs' => $cacheMaintenanceRepository->getMaintenanceLogs(20),
            'maintenanceStats' => $cacheMaintenanceRepository->getMaintenanceStats(7),
        ]);
    });
    $router->register('GET', '/api/v1/observability/events', [$observabilityController, 'events']);
    $router->register('POST', '/api/v1/observability/frontend-events', [$frontendTelemetryController, 'ingest']);

    // Steam Authentication Routes
    $router->register('POST', '/api/v1/auth/steam/login', function () use ($steamAuthController) {
        $result = $steamAuthController->login($_GET, $_SERVER);
        JsonResponseFactory::success($result, [], $result['success'] ? 200 : 400);
    });
    $router->register('GET', '/api/v1/auth/steam/callback', function () use ($steamAuthController) {
        $result = $steamAuthController->callback($_GET, $_SERVER);
        
        if (!$result['success']) {
            // Return error page for web clients
            http_response_code(400);
            header('Content-Type: text/html');
            echo '<h1>Authentication Failed</h1><p>' . htmlspecialchars($result['error'] ?? 'Unknown error') . '</p>';
            return;
        }
        
        $redirectUrl = $result['redirectUrl'] ?? '';
        $sessionToken = $result['sessionToken'] ?? '';
        
        // Determine if this is a desktop custom protocol URL or web URL
        $isDesktopProtocol = preg_match('/^[a-z][a-z0-9+.-]*:\/\//i', $redirectUrl) === 1
            && !preg_match('/^https?:\/\//i', $redirectUrl) === 1;
        
        $tokenFragment = '#token=' . rawurlencode($sessionToken);
        if ($isDesktopProtocol) {
            // Desktop: Redirect to custom protocol with token only
            // User data is embedded in the encrypted session token
            $callbackUrl = $redirectUrl . $tokenFragment;
            header('Location: ' . $callbackUrl);
            exit;
        } else {
            // Web: Redirect to web callback with token only
            // Client will fetch user data via validateSession endpoint
            $webCallbackUrl = $redirectUrl . $tokenFragment;
            header('Location: ' . $webCallbackUrl);
            exit;
        }
    });
    $router->register('GET', '/api/v1/auth/steam/inventory', function () use ($steamAuthController) {
        $steamId = $_GET['steamId'] ?? '';
        if (!$steamId) {
            JsonResponseFactory::error('MISSING_STEAM_ID', 'Steam ID required', [], 400);
            return;
        }
        $result = $steamAuthController->getCS2Inventory($steamId);
        JsonResponseFactory::success($result, [], $result['success'] ? 200 : 400);
    });
    $router->register('GET', '/api/v1/auth/session/validate', function () use ($steamAuthController) {
        // Extract token from Authorization header
        $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['HTTP_X_AUTH_TOKEN'] ?? '';

        if (!$authHeader) {
            JsonResponseFactory::error('MISSING_TOKEN', 'Session token required', [], 401);
            return;
        }

        $sessionToken = str_replace('Bearer ', '', $authHeader);
        $user = $steamAuthController->validateSession($sessionToken);
        
        if (!$user) {
            JsonResponseFactory::error('INVALID_SESSION', 'Session expired or invalid', [], 401);
            return;
        }
        
        JsonResponseFactory::success([
            'valid' => true,
            'user' => [
                'id' => $user['userId'],
                'steamId' => $user['steamId'],
                'name' => $user['name'] ?? null,
                'avatar' => $user['avatar'] ?? null,
            ]
        ]);
    });

    $router->dispatch($request);

    $statusCode = http_response_code();
    if (!is_int($statusCode) || $statusCode <= 0) {
        $statusCode = 200;
    }

    Logger::event(
        'info',
        'http',
        'http.request.completed',
        'HTTP request completed',
        [
            'method' => $request->method,
            'route' => $request->path,
            'statusCode' => $statusCode,
            'durationMs' => (int) round((microtime(true) - $requestStartedAt) * 1000),
        ]
    );
} catch (\Throwable $exception) {
    $durationMs = (int) round((microtime(true) - $requestStartedAt) * 1000);
    Logger::event(
        'error',
        'error',
        'error.http_5xx',
        'Unhandled 5xx error',
        [
            'statusCode' => 500,
            'durationMs' => $durationMs,
            'exception' => $exception,
        ]
    );
    Logger::event(
        'error',
        'http',
        'http.request.failed',
        'HTTP request failed',
        [
            'method' => $request->method,
            'route' => $request->path,
            'statusCode' => 500,
            'durationMs' => $durationMs,
            'exception' => $exception,
        ]
    );
    Logger::event(
        'info',
        'http',
        'http.request.completed',
        'HTTP request completed with server error',
        [
            'method' => $request->method,
            'route' => $request->path,
            'statusCode' => 500,
            'durationMs' => $durationMs,
        ]
    );
    Logger::event(
        'error',
        'error',
        'error.unhandled_exception',
        'Unhandled exception',
        [
            'statusCode' => 500,
            'durationMs' => $durationMs,
            'exception' => $exception,
        ]
    );

    JsonResponseFactory::error('INTERNAL_SERVER_ERROR', 'Interner Serverfehler.', [], 500);
} finally {
    RequestContextStore::clear();
}
