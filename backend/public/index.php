<?php
declare(strict_types=1);

// Da die Datei in /api/public/index.php liegt:
// __DIR__ ist /var/www/html/api/public
// dirname(__DIR__) ist /var/www/html/api
$backendRoot = dirname(__DIR__); 
$bootstrapPath = $backendRoot . '/src/bootstrap.php';

require_once $bootstrapPath;

// Fallback: Lade .env direkt falls nicht im bootstrap geladen
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

use App\Application\Service\PortfolioService;
use App\Application\Service\PricingService;
use App\Application\Service\WatchlistService;
use App\Application\Support\MarketItemClassifier;
use App\Config\DatabaseConfig;
use App\Http\Controller\DebugController;
use App\Http\Controller\PortfolioController;
use App\Http\Controller\WatchlistController;
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
use App\Infrastructure\Persistence\Repository\WatchlistRepository;
use App\Shared\Http\Request;
use App\Shared\Http\Router;

// CORS Header
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// Initialisierung der App
$pdo = (new DatabaseConnectionFactory(new DatabaseConfig()))->create();

$investmentRepository = new InvestmentRepository($pdo);
$positionHistoryRepository = new PositionHistoryRepository($pdo);
$***REMOVED***HistoryRepository = new PortfolioHistoryRepository($pdo);
$watchlistRepository = new WatchlistRepository($pdo);
$priceHistoryRepository = new PriceHistoryRepository($pdo);
$itemCatalogRepository = new ItemCatalogRepository($pdo);
$itemLiveCacheRepository = new ItemLiveCacheRepository($pdo);

$pricingService = new PricingService(
    new CsFloatClient(),
    new ExchangeRateClient(),
    new SteamMarketClient(),
    new MarketItemClassifier(),
    $itemCatalogRepository,
    $itemLiveCacheRepository
);
$***REMOVED***Service = new PortfolioService(
    $investmentRepository,
    $positionHistoryRepository,
    $***REMOVED***HistoryRepository,
    $pricingService
);
$watchlistService = new WatchlistService($watchlistRepository, $priceHistoryRepository, $pricingService);

$***REMOVED***Controller = new PortfolioController($***REMOVED***Service);
$watchlistController = new WatchlistController($watchlistService);
$debugController = new DebugController();

// Router Setup
$router = new Router();
$router->register('GET', '/api/v1/***REMOVED***/investments', [$***REMOVED***Controller, 'investments']);
$router->register('GET', '/api/v1/***REMOVED***/investments/{id}/history', [$***REMOVED***Controller, 'investmentHistory']);
$router->register('GET', '/api/v1/***REMOVED***/summary', [$***REMOVED***Controller, 'summary']);
$router->register('GET', '/api/v1/***REMOVED***/history', [$***REMOVED***Controller, 'history']);
$router->register('GET', '/api/v1/***REMOVED***/composition', [$***REMOVED***Controller, 'composition']);
$router->register('PUT', '/api/v1/***REMOVED***/daily-value', [$***REMOVED***Controller, 'saveDailyValue']);

$router->register('GET', '/api/v1/watchlist', [$watchlistController, 'list']);
$router->register('POST', '/api/v1/watchlist', [$watchlistController, 'create']);
$router->register('DELETE', '/api/v1/watchlist/{id}', [$watchlistController, 'delete']);
$router->register('POST', '/api/v1/watchlist/prices/refresh', [$watchlistController, 'refresh']);

// Debug Routes
$router->register('GET', '/api/v1/debug/logs', [$debugController, 'logs']);
$router->register('GET', '/api/v1/debug/csfloat', [$debugController, 'csfloatDebug']);

$router->dispatch(Request::fromGlobals());