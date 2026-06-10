<?php

declare(strict_types=1);

/**
 * Shared API Route Definitions
 *
 * Central registry for all API v1 routes shared by the server (public/index.php)
 * and desktop sidecar (desktop/index.php) front controllers.
 *
 * Server uses registerServerApiRoutes($router, $controllers) which maps directly
 * to controller instances.
 *
 * Desktop registers routes inline with proxy closures due to fundamentally
 * different architecture (proxying to upstream server). To check what routes
 * exist, grep for `$router->register` in backend/desktop/index.php.
 */

use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Router;

/**
 * Register all API v1 routes for the server front controller.
 *
 * Each controller must be provided as a keyed array:
 *   'portfolio'          => PortfolioController instance
 *   'csFloatSync'        => CsFloatSyncController instance
 *   'syncStatus'         => SyncStatusController instance
 *   'sync'               => SyncController instance
 *   'settings'           => SettingsController instance
 *   'exchangeRate'       => ExchangeRateController instance
 *   'csUpdates'          => CsUpdatesController instance
 *   'webPush'            => WebPushController instance
 *   'watchlist'          => WatchlistController instance
 *   'debug'              => DebugController instance
 *   'observability'      => ObservabilityController instance
 *   'frontendTelemetry'  => FrontendTelemetryController instance
 *   'steamAuth'          => SteamAuthController instance
 *   'pdo'                => PDO instance (for inline cache handler)
 */
function registerServerApiRoutes(Router $router, array $c): void
{
    // ── Portfolio / Investments ────────────────────────────────────────
    $router->register('GET',    '/api/v1/portfolio/investments',                [$c['portfolio'], 'investments']);
    $router->register('GET',    '/api/v1/portfolio/investments/{id}/history',   [$c['portfolio'], 'investmentHistory']);
    $router->register('GET',    '/api/v1/items/{id}/price-history',            [$c['portfolio'], 'itemPriceHistory']);
    $router->register('PUT',    '/api/v1/portfolio/investments/{id}/exclude',  [$c['portfolio'], 'toggleExcludeInvestment']);
    $router->register('PUT',    '/api/v1/portfolio/investments/{id}/bucket',   [$c['portfolio'], 'updateInvestmentBucket']);
    $router->register('PUT',    '/api/v1/portfolio/investments/{id}/overpay',  [$c['portfolio'], 'updateInvestmentOverpay']);
    $router->register('GET',    '/api/v1/portfolio/summary',                   [$c['portfolio'], 'summary']);
    $router->register('GET',    '/api/v1/portfolio/history',                   [$c['portfolio'], 'history']);
    $router->register('GET',    '/api/v1/portfolio/composition',               [$c['portfolio'], 'composition']);
    $router->register('POST',   '/api/v1/portfolio/prices/refresh-stale',      [$c['portfolio'], 'refreshStalePrices']);
    $router->register('PUT',    '/api/v1/portfolio/daily-value',               [$c['portfolio'], 'saveDailyValue']);

    // ── Sync (CSFloat) ──────────────────────────────────────────────────
    $router->register('POST',   '/api/v1/portfolio/sync/csfloat/preview',     [$c['csFloatSync'], 'preview']);
    $router->register('POST',   '/api/v1/portfolio/sync/csfloat/execute',     [$c['csFloatSync'], 'execute']);

    // ── Sync Status ────────────────────────────────────────────────────
    $router->register('GET',    '/api/v1/portfolio/sync-status',               [$c['syncStatus'], 'status']);
    $router->register('GET',    '/api/v1/portfolio/sync-history',              [$c['syncStatus'], 'history']);
    $router->register('GET',    '/api/v1/portfolio/sync-stats',                [$c['syncStatus'], 'stats']);

    // ── Sync Pull/Push ─────────────────────────────────────────────────
    $router->register('GET',    '/api/v1/sync/pull',                           [$c['sync'], 'pull']);
    $router->register('POST',   '/api/v1/sync/push',                           [$c['sync'], 'push']);

    // ── Settings ───────────────────────────────────────────────────────
    $router->register('GET',    '/api/v1/settings/fees',                       [$c['settings'], 'fees']);
    $router->register('PUT',    '/api/v1/settings/fees',                       [$c['settings'], 'updateFees']);
    $router->register('GET',    '/api/v1/settings/price-source',               [$c['settings'], 'getPriceSourcePreference']);
    $router->register('PUT',    '/api/v1/settings/price-source',               [$c['settings'], 'updatePriceSourcePreference']);
    $router->register('GET',    '/api/v1/settings/currency',                   [$c['settings'], 'getCurrencyPreference']);
    $router->register('PUT',    '/api/v1/settings/currency',                   [$c['settings'], 'updateCurrencyPreference']);
    $router->register('GET',    '/api/v1/settings/portfolio-groups',           [$c['settings'], 'getPortfolioGroups']);
    $router->register('PUT',    '/api/v1/settings/portfolio-groups',           [$c['settings'], 'updatePortfolioGroups']);
    $router->register('GET',    '/api/v1/settings/csfloat-api-key',            [$c['settings'], 'getCsFloatApiKeyStatus']);
    $router->register('POST',   '/api/v1/settings/csfloat-api-key',            [$c['settings'], 'updateCsFloatApiKey']);

    // ── Exchange Rate ──────────────────────────────────────────────────
    $router->register('GET',    '/api/v1/exchange-rate',                       [$c['exchangeRate'], 'getRates']);

    // ── CS Updates ─────────────────────────────────────────────────────
    $router->register('GET',    '/api/v1/cs-updates',                          [$c['csUpdates'], 'list']);

    // ── Web Push ───────────────────────────────────────────────────────
    $router->register('GET',    '/api/v1/push/public-key',                     [$c['webPush'], 'publicKey']);
    $router->register('POST',   '/api/v1/push/subscribe',                      [$c['webPush'], 'subscribe']);
    $router->register('POST',   '/api/v1/push/unsubscribe',                    [$c['webPush'], 'unsubscribe']);

    // ── Watchlist ──────────────────────────────────────────────────────
    $router->register('GET',    '/api/v1/watchlist',                           [$c['watchlist'], 'list']);
    $router->register('GET',    '/api/v1/watchlist/search',                    [$c['watchlist'], 'search']);
    $router->register('POST',   '/api/v1/watchlist',                           [$c['watchlist'], 'create']);
    $router->register('POST',   '/api/v1/watchlist/batch',                     [$c['watchlist'], 'createBatch']);
    $router->register('DELETE', '/api/v1/watchlist/{id}',                      [$c['watchlist'], 'delete']);
    $router->register('POST',   '/api/v1/watchlist/prices/refresh',            [$c['watchlist'], 'refresh']);

    // ── Debug (conditional) ────────────────────────────────────────────
    if (obs_debug_endpoints_enabled()) {
        $router->register('GET', '/api/v1/debug/logs',                        [$c['debug'], 'logs']);
        $router->register('GET', '/api/v1/debug/csfloat',                     [$c['debug'], 'csfloatDebug']);
        $router->register('GET', '/api/v1/debug/watchlist-search-stats',      [$c['debug'], 'watchlistSearchStats']);
        $router->register('GET', '/api/v1/debug/cache/stats', function () use ($c) {
            $cacheRepo = new \App\Infrastructure\Persistence\Repository\CacheMaintenanceRepository($c['pdo']);
            JsonResponseFactory::success([
                'cacheStats' => $cacheRepo->getCacheStatistics(),
                'maintenanceLogs' => $cacheRepo->getMaintenanceLogs(20),
                'maintenanceStats' => $cacheRepo->getMaintenanceStats(7),
            ]);
        });
    }

    // ── Observability ──────────────────────────────────────────────────
    $router->register('GET',    '/api/v1/observability/events',                [$c['observability'], 'events']);
    $router->register('POST',   '/api/v1/observability/frontend-events',       [$c['frontendTelemetry'], 'ingest']);

    // ── Auth ───────────────────────────────────────────────────────────
    $steamLoginHandler = function () use ($c) {
        $result = $c['steamAuth']->login($_GET, $_SERVER);
        JsonResponseFactory::success($result, [], $result['success'] ? 200 : 400);
    };
    $router->register('POST', '/api/v1/auth/steam/login', $steamLoginHandler);
    $router->register('GET',  '/api/v1/auth/steam/login', $steamLoginHandler);

    $router->register('GET', '/api/v1/auth/steam/callback', function () use ($c) {
        $result = $c['steamAuth']->callback($_GET, $_SERVER);

        if (!$result['success']) {
            http_response_code(400);
            header('Content-Type: text/html');
            echo '<h1>Authentication Failed</h1><p>' . htmlspecialchars($result['error'] ?? 'Unknown error') . '</p>';
            return;
        }

        $redirectUrl = $result['redirectUrl'] ?? '';
        $sessionToken = $result['sessionToken'] ?? '';

        $isDesktopProtocol = preg_match('/^[a-z][a-z0-9+.-]*:\/\//i', $redirectUrl) === 1
            && !preg_match('/^https?:\/\//i', $redirectUrl) === 1;

        $tokenFragment = '#token=' . rawurlencode($sessionToken);
        if ($isDesktopProtocol) {
            $callbackUrl = $redirectUrl . $tokenFragment;
            header('Location: ' . $callbackUrl);
            exit;
        }
        $webCallbackUrl = $redirectUrl . $tokenFragment;
        header('Location: ' . $webCallbackUrl);
        exit;
    });

    $router->register('GET', '/api/v1/auth/steam/inventory', function () use ($c) {
        $steamId = $_GET['steamId'] ?? '';
        if (!$steamId) {
            JsonResponseFactory::error('MISSING_STEAM_ID', 'Steam ID required', [], 400);
            return;
        }
        $result = $c['steamAuth']->getCS2Inventory($steamId);
        JsonResponseFactory::success($result, [], $result['success'] ? 200 : 400);
    });

    $router->register('GET', '/api/v1/auth/session/validate', function () use ($c) {
        $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['HTTP_X_AUTH_TOKEN'] ?? '';

        if (!$authHeader) {
            JsonResponseFactory::error('MISSING_TOKEN', 'Session token required', [], 401);
            return;
        }

        $sessionToken = str_replace('Bearer ', '', $authHeader);
        $user = $c['steamAuth']->validateSession($sessionToken);

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
                'animatedAvatar' => $user['animatedAvatar'] ?? null,
            ]
        ]);
    });
}
