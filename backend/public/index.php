<?php
declare(strict_types=1);

use App\Application\Service\PortfolioService;
use App\Application\Service\PricingService;
use App\Application\Service\WatchlistService;
use App\Config\DatabaseConfig;
use App\Http\Controller\PortfolioController;
use App\Http\Controller\WatchlistController;
use App\Infrastructure\External\CsFloatClient;
use App\Infrastructure\External\ExchangeRateClient;
use App\Infrastructure\Persistence\DatabaseConnectionFactory;
use App\Infrastructure\Persistence\Repository\InvestmentRepository;
use App\Infrastructure\Persistence\Repository\PositionHistoryRepository;
use App\Infrastructure\Persistence\Repository\PortfolioHistoryRepository;
use App\Infrastructure\Persistence\Repository\PriceHistoryRepository;
use App\Infrastructure\Persistence\Repository\WatchlistRepository;
use App\Shared\Http\Request;
use App\Shared\Http\Router;

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/../src/bootstrap.php';

$pdo = (new DatabaseConnectionFactory(new DatabaseConfig()))->create();

$investmentRepository = new InvestmentRepository($pdo);
$positionHistoryRepository = new PositionHistoryRepository($pdo);
$***REMOVED***HistoryRepository = new PortfolioHistoryRepository($pdo);
$watchlistRepository = new WatchlistRepository($pdo);
$priceHistoryRepository = new PriceHistoryRepository($pdo);

$pricingService = new PricingService(new CsFloatClient(), new ExchangeRateClient());
$***REMOVED***Service = new PortfolioService($investmentRepository, $positionHistoryRepository, $***REMOVED***HistoryRepository, $pricingService);
$watchlistService = new WatchlistService($watchlistRepository, $priceHistoryRepository, $pricingService);

$***REMOVED***Controller = new PortfolioController($***REMOVED***Service);
$watchlistController = new WatchlistController($watchlistService);

$router = new Router();
$router->register('GET', '/api/v1/***REMOVED***/investments', [$***REMOVED***Controller, 'investments']);
$router->register('GET', '/api/v1/***REMOVED***/investments/{id}/history', [$***REMOVED***Controller, 'investmentHistory']);
$router->register('GET', '/api/v1/***REMOVED***/summary', [$***REMOVED***Controller, 'summary']);
$router->register('GET', '/api/v1/***REMOVED***/history', [$***REMOVED***Controller, 'history']);
$router->register('PUT', '/api/v1/***REMOVED***/daily-value', [$***REMOVED***Controller, 'saveDailyValue']);

$router->register('GET', '/api/v1/watchlist', [$watchlistController, 'list']);
$router->register('POST', '/api/v1/watchlist', [$watchlistController, 'create']);
$router->register('DELETE', '/api/v1/watchlist/{id}', [$watchlistController, 'delete']);
$router->register('POST', '/api/v1/watchlist/prices/refresh', [$watchlistController, 'refresh']);

$router->dispatch(Request::fromGlobals());
