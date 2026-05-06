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

$desktopOrigin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
$isDesktopOriginAllowed = static function (string $origin): bool {
    if ($origin === '' || strtolower($origin) === 'null') {
        return true;
    }

    return preg_match('#^https?://(localhost|127\.0\.0\.1)(:\d+)?$#i', $origin) === 1;
};

if (!$isDesktopOriginAllowed($desktopOrigin)) {
    http_response_code(403);
    header('Content-Type: application/json');
    echo json_encode([
        'success' => false,
        'error' => 'Origin not allowed',
        'code' => 'CORS_ORIGIN_DENIED',
    ], JSON_UNESCAPED_SLASHES);
    exit;
}

if ($desktopOrigin !== '') {
    header('Access-Control-Allow-Origin: ' . $desktopOrigin);
    header('Vary: Origin');
}
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
        'source' => $hasConfiguredKey ? 'electron-safe-storage' : 'missing',
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
        . '<p style=\"color:#9ca3af; font-size:0.9rem; margin-top:1rem;\">You may close this tab.</p>'
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
    $token = is_string($authHeader) && $authHeader !== ''
        ? str_replace('Bearer ', '', $authHeader)
        : '';

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

// Proxy selected read-only routes to upstream server when configured.
$resolveUpstreamApiBase = static function (): string {
    $raw = getenv('UPSTREAM_API_BASE_URL') ?: ($_ENV['UPSTREAM_API_BASE_URL'] ?? '');
    return rtrim((string) $raw, '/');
};

$buildUpstreamCandidates = static function (string $baseUrl, string $endpointPath): array {
    $base = rtrim($baseUrl, '/');
    $endpoint = '/' . ltrim($endpointPath, '/');
    $lower = strtolower($base);

    $candidates = [];
    if (str_ends_with($lower, '/api/index.php')) {
        $candidates[] = $base . $endpoint;
        $candidates[] = substr($base, 0, -strlen('/api/index.php')) . $endpoint;
    } elseif (str_ends_with($lower, '/api')) {
        $candidates[] = $base . '/index.php' . $endpoint;
        $candidates[] = substr($base, 0, -strlen('/api')) . $endpoint;
    } else {
        $candidates[] = $base . '/api/index.php' . $endpoint;
        $candidates[] = $base . $endpoint;
    }

    $deduped = [];
    foreach ($candidates as $candidate) {
        $key = strtolower($candidate);
        if (!isset($deduped[$key])) {
            $deduped[$key] = $candidate;
        }
    }

    return array_values($deduped);
};

$proxyUpstreamGet = static function (string $endpointPath, array $query = []) use ($resolveUpstreamApiBase, $buildUpstreamCandidates): ?array {
    $baseUrl = $resolveUpstreamApiBase();
    if ($baseUrl === '') {
        return null;
    }

    $queryString = http_build_query($query);
    foreach ($buildUpstreamCandidates($baseUrl, $endpointPath) as $candidate) {
        $url = $candidate . ($queryString !== '' ? ('?' . $queryString) : '');
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 8);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Accept: application/json']);

        $response = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if (!is_string($response) || trim($response) === '') {
            continue;
        }

        $decoded = json_decode($response, true);
        if (!is_array($decoded)) {
            continue;
        }

        if ($httpCode >= 200 && $httpCode < 300) {
            return [
                'ok' => true,
                'data' => isset($decoded['data']) ? $decoded['data'] : $decoded,
                'meta' => isset($decoded['meta']) && is_array($decoded['meta']) ? $decoded['meta'] : [],
            ];
        }
    }

    return [
        'ok' => false,
    ];
};

$router->register('GET', '/api/v1/exchange-rate', static function () use ($proxyUpstreamGet): void {
    $proxied = $proxyUpstreamGet('/api/v1/exchange-rate');
    if ($proxied !== null && ($proxied['ok'] ?? false) === true) {
        JsonResponseFactory::success($proxied['data'], array_merge($proxied['meta'] ?? [], ['source' => 'upstream']));
        return;
    }

    JsonResponseFactory::success([
        'base' => 'EUR',
        'rates' => [
            'EUR' => 1.0,
            'USD' => 1.08,
            'GBP' => 0.85,
        ],
        'USD' => 1.08,
        'GBP' => 0.85,
        'timestamp' => time(),
        'fallback' => true,
    ], ['source' => 'desktop-fallback']);
});

$router->register('GET', '/api/v1/watchlist/search', static function (Request $request) use ($proxyUpstreamGet): void {
    $query = [
        'query' => $request->query['query'] ?? '',
        'limit' => $request->query['limit'] ?? 6,
        'page' => $request->query['page'] ?? 1,
        'itemType' => $request->query['itemType'] ?? '',
        'wear' => $request->query['wear'] ?? '',
        'sortBy' => $request->query['sortBy'] ?? '',
    ];

    $proxied = $proxyUpstreamGet('/api/v1/watchlist/search', $query);
    if ($proxied !== null && ($proxied['ok'] ?? false) === true) {
        JsonResponseFactory::success($proxied['data'], array_merge($proxied['meta'] ?? [], ['source' => 'upstream']));
        return;
    }

    JsonResponseFactory::success([
        'items' => [],
        'totalItems' => 0,
        'totalPages' => 0,
        'page' => (int) ($request->query['page'] ?? 1),
        'limit' => (int) ($request->query['limit'] ?? 6),
        'source' => 'desktop-local-fallback',
    ]);
});

$router->register('POST', '/api/v1/watchlist/batch', static function (Request $request) use ($resolveUpstreamApiBase, $buildUpstreamCandidates): void {
    $baseUrl = $resolveUpstreamApiBase();
    if ($baseUrl === '') {
        JsonResponseFactory::error('UPSTREAM_NOT_CONFIGURED', 'Server URL nicht konfiguriert.', [], 503);
        return;
    }

    $body = json_encode(['items' => $request->body['items'] ?? []], JSON_UNESCAPED_UNICODE);
    if (!is_string($body)) {
        JsonResponseFactory::error('WATCHLIST_BATCH_INVALID', 'Ungueltiger Payload.', [], 400);
        return;
    }

    foreach ($buildUpstreamCandidates($baseUrl, '/api/v1/watchlist/batch') as $candidate) {
        $ch = curl_init($candidate);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 8);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Accept: application/json', 'Content-Type: application/json']);
        $response = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if (!is_string($response) || trim($response) === '') {
            continue;
        }
        $decoded = json_decode($response, true);
        if (!is_array($decoded)) {
            continue;
        }

        if ($httpCode >= 200 && $httpCode < 300) {
            JsonResponseFactory::success(
                isset($decoded['data']) ? $decoded['data'] : $decoded,
                isset($decoded['meta']) && is_array($decoded['meta']) ? $decoded['meta'] : ['source' => 'upstream']
            );
            return;
        }
    }

    JsonResponseFactory::error('WATCHLIST_BATCH_UPSTREAM_FAILED', 'Batch-Add konnte nicht an den Server gesendet werden.', [], 502);
});

$resolveDesktopLogFile = static function (): ?string {
    $logFile = getenv('DESKTOP_LOG_FILE') ?: ($_ENV['DESKTOP_LOG_FILE'] ?? null);
    if (!is_string($logFile) || trim($logFile) === '') {
        return null;
    }

    return $logFile;
};

$readDesktopLogLines = static function (?string $logFile, int $limit): array {
    if ($logFile === null || !is_file($logFile)) {
        return [];
    }

    $lines = file($logFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) {
        return [];
    }

    return array_slice($lines, -$limit);
};

$router->register('GET', '/api/v1/debug/logs', static function (Request $request) use ($resolveDesktopLogFile, $readDesktopLogLines): void {
    $limit = (int) ($request->query['limit'] ?? 100);
    $limit = max(1, min($limit, 1000));
    $logFile = $resolveDesktopLogFile();
    $logs = $readDesktopLogLines($logFile, $limit);

    JsonResponseFactory::success([
        'type' => (string) ($request->query['type'] ?? 'app'),
        'source' => $logFile ? 'desktop-log-file' : 'desktop-local',
        'totalLines' => count($logs),
        'displayedLines' => count($logs),
        'logs' => $logs,
        'events' => [],
        'message' => $logFile ? null : 'Desktop log file not configured',
    ]);
});

$router->register('GET', '/api/v1/debug/csfloat', static function (): void {
    JsonResponseFactory::success([
        'source' => 'desktop-local',
        'available' => true,
        'message' => 'Desktop sidecar debug endpoint is active.',
    ]);
});

$router->register('POST', '/api/v1/observability/frontend-events', static function (): void {
    http_response_code(204);
});

$router->dispatch($request);
