<?php
declare(strict_types=1);

use App\Http\Controller\DesktopCsFloatController;
use App\Http\Controller\DesktopSteamAuthController;
use App\Infrastructure\External\CsFloatTradeClient;
use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Request;
use App\Shared\Http\Router;

$backendRoot = dirname(__DIR__);

require_once $backendRoot . '/src/bootstrap.php';

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Request-Id, X-Desktop-Sidecar-Secret');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$request = Request::fromGlobals();
$steamAuthController = new DesktopSteamAuthController();
$csFloatController = new DesktopCsFloatController(new CsFloatTradeClient());

$router = new Router();

$router->register('GET', '/api/v1/desktop/health', static function (): void {
    JsonResponseFactory::success([
        'ok' => true,
        'mode' => 'desktop-sidecar',
        'time' => gmdate('c'),
    ]);
});

$router->register('GET', '/favicon.ico', static function (): void {
    http_response_code(204);
});

$router->register('GET', '/api/v1/portfolio/composition', static function (): void {
    JsonResponseFactory::success([]);
});

$router->register('GET', '/api/v1/settings/fees', static function (): void {
    JsonResponseFactory::success([
        'fxFeePercent' => 0.0,
        'sellerFeePercent' => 2.0,
        'withdrawalFeePercent' => 2.5,
        'depositFeePercent' => 2.8,
        'depositFeeFixedEur' => 0.26,
        'source' => 'desktop-defaults',
    ]);
});

$router->register('PUT', '/api/v1/settings/fees', static function (Request $request): void {
    JsonResponseFactory::success([
        'fxFeePercent' => (float) ($request->body['fxFeePercent'] ?? 0.0),
        'sellerFeePercent' => (float) ($request->body['sellerFeePercent'] ?? 2.0),
        'withdrawalFeePercent' => (float) ($request->body['withdrawalFeePercent'] ?? 2.5),
        'depositFeePercent' => (float) ($request->body['depositFeePercent'] ?? 2.8),
        'depositFeeFixedEur' => (float) ($request->body['depositFeeFixedEur'] ?? 0.26),
        'source' => 'desktop-defaults',
    ]);
});

$router->register('GET', '/api/v1/settings/csfloat-api-key', static function (): void {
    $apiKey = getenv('CSFLOAT_API_KEY') ?: ($_ENV['CSFLOAT_API_KEY'] ?? '');
    $hasConfiguredKey = is_string($apiKey)
        && trim($apiKey) !== ''
        && !in_array(strtolower(trim($apiKey)), ['expired', 'replace-with-csfloat-api-key'], true);

    JsonResponseFactory::success([
        'hasKey' => $hasConfiguredKey,
        'source' => $hasConfiguredKey ? 'env' : 'missing',
        'desktopLocal' => true,
    ]);
});

$router->register('POST', '/api/v1/settings/csfloat-api-key', static function (): void {
    JsonResponseFactory::error(
        'DESKTOP_SECRET_IPC_REQUIRED',
        'Set the CSFloat API Key through the Electron settings UI so it can be stored with OS encryption.',
        ['desktopLocal' => true],
        400
    );
});

$router->register('POST', '/api/v1/auth/steam/login', static function () use ($steamAuthController): void {
    $result = $steamAuthController->login($_GET, $_SERVER);
    JsonResponseFactory::success($result, [], ($result['success'] ?? false) ? 200 : 400);
});

$router->register('GET', '/api/v1/auth/steam/callback', static function () use ($steamAuthController): void {
    $result = $steamAuthController->callback($_GET, $_SERVER);
    if (!($result['success'] ?? false)) {
        http_response_code(400);
        header('Content-Type: text/html');
        echo '<h1>Authentication Failed</h1><p>' . htmlspecialchars((string) ($result['error'] ?? 'Unknown error')) . '</p>';
        return;
    }

    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><html><head><meta charset="utf-8"><title>Authentication Complete</title></head>'
        . '<body style="font-family: system-ui, sans-serif; background:#111827; color:#f9fafb; display:grid; place-items:center; min-height:100vh; margin:0;">'
        . '<main style="max-width:420px; text-align:center;">'
        . '<h1>Steam login complete</h1>'
        . '<p>You can return to CS Investor Hub. This browser tab can be closed.</p>'
        . '<script>setTimeout(function(){ window.close(); }, 1200);</script>'
        . '</main></body></html>';
});

$router->register('GET', '/api/v1/auth/steam/result', static function () use ($steamAuthController): void {
    $state = (string) ($_GET['state'] ?? '');
    if ($state === '') {
        JsonResponseFactory::error('MISSING_STATE', 'Auth state required', [], 400);
        return;
    }

    JsonResponseFactory::success($steamAuthController->getAuthResult($state));
});

$router->register('GET', '/api/v1/auth/session/validate', static function () use ($steamAuthController): void {
    $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['HTTP_X_AUTH_TOKEN'] ?? '';
    $token = (string) ($_GET['token'] ?? '');

    if ($token === '' && is_string($authHeader) && $authHeader !== '') {
        $token = str_replace('Bearer ', '', $authHeader);
    }

    if ($token === '') {
        JsonResponseFactory::error('MISSING_TOKEN', 'Session token required', [], 401);
        return;
    }

    $user = $steamAuthController->validateSession($token);
    if ($user === null) {
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
        ],
    ]);
});

$router->register('GET', '/api/v1/auth/steam/inventory', static function () use ($steamAuthController): void {
    $steamId = (string) ($_GET['steamId'] ?? '');
    if ($steamId === '') {
        JsonResponseFactory::error('MISSING_STEAM_ID', 'Steam ID required', [], 400);
        return;
    }

    $result = $steamAuthController->getCS2Inventory($steamId);
    JsonResponseFactory::success($result, [], ($result['success'] ?? false) ? 200 : 400);
});

$router->register('POST', '/api/v1/portfolio/sync/csfloat/preview', [$csFloatController, 'preview']);
$router->register('POST', '/api/v1/portfolio/sync/csfloat/execute', [$csFloatController, 'execute']);

$router->dispatch($request);
