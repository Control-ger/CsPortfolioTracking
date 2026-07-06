<?php
declare(strict_types=1);

use App\Http\Controller\DesktopCsFloatController;
use App\Http\Controller\DesktopSkinBaronController;
use App\Http\Controller\DesktopSteamAuthController;
use App\Infrastructure\External\CsFloatTradeClient;
use App\Infrastructure\External\SkinBaronClient;
use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Request;
use App\Shared\Http\Router;

$backendRoot = dirname(__DIR__);

require_once $backendRoot . '/src/bootstrap.php';

// ── Required PHP extensions ────────────────────────────────────────────
// The backend (services, repositories, name-resolution) depends on mbstring
// for case-insensitive string handling. When the host PHP lacks it, routes
// fatal deep inside a request with "Call to undefined function mb_*()" and
// the renderer only sees an empty/non-JSON response. Fail fast with a clear
// message instead so the cause is diagnosable.
$missingPhpExtensions = array_values(array_filter(
    ['mbstring', 'curl', 'json'],
    static fn (string $ext): bool => !extension_loaded($ext)
));
if ($missingPhpExtensions !== []) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode([
        'success' => false,
        'error' => [
            'code' => 'PHP_EXTENSION_MISSING',
            'message' => 'Required PHP extension(s) not loaded: ' . implode(', ', $missingPhpExtensions)
                . '. Enable them in php.ini (e.g. extension=mbstring) and restart the app.',
            'missingExtensions' => $missingPhpExtensions,
            'phpBinary' => PHP_BINARY,
            'phpVersion' => PHP_VERSION,
        ],
    ], JSON_UNESCAPED_SLASHES);
    exit;
}

// ── Cloudflare Access cookie (per-request) ─────────────────────────────
// The renderer authenticates to the Zero Trust tunnel and the Electron header
// bridge forwards its CF cookie on every renderer→sidecar call as
// X-Upstream-Cf-Cookie. Promote it into UPSTREAM_COOKIE_HEADER so the existing
// upstream proxy ($proxyUpstreamGet) sends it as the Cookie: header on every
// upstream curl — otherwise CF returns its login HTML and every proxied read
// (prices/history/search/composition) fails silently.
// Set unconditionally (even to empty) every request: the PHP built-in server is
// a long-lived process, so putenv() persists across requests. A later request
// without the header (cookie cleared/expired → bridge omits it) must NOT keep
// reusing a stale cookie from an earlier request. Strip CR/LF defensively to
// avoid injecting extra headers into the upstream Cookie line.
$incomingCfCookie = str_replace(["\r", "\n"], '', trim((string) ($_SERVER['HTTP_X_UPSTREAM_CF_COOKIE'] ?? '')));
putenv('UPSTREAM_COOKIE_HEADER=' . $incomingCfCookie);
$_ENV['UPSTREAM_COOKIE_HEADER'] = $incomingCfCookie;

// ── Route Registry Note ────────────────────────────────────────────────
// The server front controller (public/index.php) uses registerServerApiRoutes()
// from backend/src/routes.php for shared route definitions.
// This desktop sidecar keeps inline proxy-style route registrations below
// because each handler proxies to the upstream server rather than calling
// controller methods directly. When adding new API routes, update both
// backend/src/routes.php AND add the corresponding proxy route here.
// ──────────────────────────────────────────────────────────────────────

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
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Auth-Token, X-Request-Id, X-Desktop-Sidecar-Secret');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$expectedSidecarSecret = trim((string) (getenv('DESKTOP_SIDECAR_SECRET') ?: ($_ENV['DESKTOP_SIDECAR_SECRET'] ?? '')));
$providedSidecarSecret = trim((string) ($_SERVER['HTTP_X_DESKTOP_SIDECAR_SECRET'] ?? ''));
$requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$requestPath = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);

$isPublicSidecarRoute = static function (string $method, string $path): bool {
    $normalizedMethod = strtoupper(trim($method));
    $normalizedPath = '/' . ltrim(trim($path), '/');

    // Steam OpenID callback is performed by the system browser and cannot
    // include desktop-sidecar secret headers.
    return $normalizedMethod === 'GET' && $normalizedPath === '/api/v1/auth/steam/callback';
};

$requiresSidecarSecret = !$isPublicSidecarRoute($requestMethod, $requestPath);

if ($requiresSidecarSecret && $expectedSidecarSecret === '') {
    JsonResponseFactory::error(
        'DESKTOP_SIDECAR_SECRET_MISSING',
        'Desktop sidecar secret missing in runtime environment.',
        [],
        503
    );
    exit;
}

if (
    $requiresSidecarSecret
    && ($providedSidecarSecret === '' || !hash_equals($expectedSidecarSecret, $providedSidecarSecret))
) {
    JsonResponseFactory::error(
        'DESKTOP_SIDECAR_UNAUTHORIZED',
        'Missing or invalid desktop sidecar secret.',
        [],
        401
    );
    exit;
}

$request = Request::fromGlobals();
$steamAuthController = new DesktopSteamAuthController();
$csFloatController = new DesktopCsFloatController(new CsFloatTradeClient());
$skinBaronController = new DesktopSkinBaronController(new SkinBaronClient());

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

$router->register('GET', '/api/v1/settings/skinbaron-api-key', static function (): void {
    $apiKey = getenv('SKINBARON_API_KEY') ?: ($_ENV['SKINBARON_API_KEY'] ?? '');
    $sessionCookie = getenv('SKINBARON_SESSION_COOKIE') ?: ($_ENV['SKINBARON_SESSION_COOKIE'] ?? '');
    $hasConfiguredKey = is_string($apiKey)
        && trim($apiKey) !== ''
        && !in_array(strtolower(trim($apiKey)), ['expired', 'replace-with-skinbaron-api-key'], true);
    $hasSessionCookie = is_string($sessionCookie) && trim($sessionCookie) !== '';
    $sessionHasAuthId = $hasSessionCookie && preg_match('/authid\s*=/i', (string) $sessionCookie) === 1;

    JsonResponseFactory::success([
        'hasKey' => $hasConfiguredKey,
        'source' => $hasConfiguredKey ? 'electron-safe-storage' : 'missing',
        'desktopLocal' => true,
        'sessionCookieConfigured' => $hasSessionCookie,
        'sessionCookieHasAuthId' => $sessionHasAuthId,
        'importReady' => $hasSessionCookie && $sessionHasAuthId,
    ]);
});

$router->register('POST', '/api/v1/settings/skinbaron-api-key', static function (): void {
    JsonResponseFactory::error(
        'DESKTOP_SECRET_IPC_REQUIRED',
        'Set the SkinBaron API Key through the Electron settings UI so it can be stored with OS encryption.',
        ['desktopLocal' => true],
        400
    );
});

$router->register('POST', '/api/v1/auth/steam/login', static function () use ($steamAuthController): void {
    try {
        $result = $steamAuthController->login($_GET, $_SERVER);
    } catch (\Throwable $e) {
        error_log('[desktop-auth-login] Exception: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
        JsonResponseFactory::error('AUTH_LOGIN_ERROR', $e->getMessage(), [], 500);
        return;
    }
    JsonResponseFactory::success($result, [], ($result['success'] ?? false) ? 200 : 400);
});

$router->register('GET', '/api/v1/auth/steam/callback', static function () use ($steamAuthController): void {
    try {
        $result = $steamAuthController->callback($_GET, $_SERVER);
    } catch (\Throwable $e) {
        error_log('[desktop-auth-callback] Exception: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
        http_response_code(500);
        header('Content-Type: text/html');
        echo '<h1>Authentication Error</h1><p>' . htmlspecialchars($e->getMessage()) . '</p><p>Check ENCRYPTION_KEY is set.</p>';
        return;
    }

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
            'animatedAvatar' => $user['animatedAvatar'] ?? null,
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
$router->register('POST', '/api/v1/portfolio/sync/skinbaron/preview', [$skinBaronController, 'preview']);
$router->register('POST', '/api/v1/portfolio/sync/skinbaron/execute', [$skinBaronController, 'execute']);
$router->register('GET', '/api/v1/csfloat/buy-orders', [$csFloatController, 'buyOrders']);
$router->register('GET', '/api/v1/csfloat/watchlist', [$csFloatController, 'watchlist']);

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
    $endpointRoute = '?route=' . rawurlencode($endpoint);

    // Keep direct-path candidates first.
    $candidates[] = $base . $endpoint;
    $candidates[] = $base . $endpointRoute;
    $candidates[] = $base . '/index.php' . $endpoint;
    $candidates[] = $base . '/index.php' . $endpointRoute;
    $candidates[] = $base . '/api/index.php' . $endpoint;
    $candidates[] = $base . '/api/index.php' . $endpointRoute;

    if (str_ends_with($lower, '/api/index.php')) {
        $root = substr($base, 0, -strlen('/api/index.php'));
        $candidates[] = $root . $endpoint;
        $candidates[] = $root . '/index.php' . $endpoint;
        $candidates[] = $root . '/index.php' . $endpointRoute;
    } elseif (str_ends_with($lower, '/api')) {
        $root = substr($base, 0, -strlen('/api'));
        $candidates[] = $root . $endpoint;
        $candidates[] = $root . '/index.php' . $endpoint;
        $candidates[] = $root . '/index.php' . $endpointRoute;
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

$proxyUpstreamGet = static function (string $endpointPath, array $query = [], array $forwardHeaders = []) use ($resolveUpstreamApiBase, $buildUpstreamCandidates): ?array {
    $baseUrl = $resolveUpstreamApiBase();
    if ($baseUrl === '') {
        return null;
    }

    $upstreamCookieHeader = trim((string) (getenv('UPSTREAM_COOKIE_HEADER') ?: ($_ENV['UPSTREAM_COOKIE_HEADER'] ?? '')));
    $upstreamCaBundlePath = trim((string) (getenv('UPSTREAM_CA_BUNDLE_PATH') ?: ($_ENV['UPSTREAM_CA_BUNDLE_PATH'] ?? '')));
    $allowInsecureTlsFallback = in_array(
        strtolower(trim((string) (getenv('UPSTREAM_INSECURE_TLS_FALLBACK') ?: ($_ENV['UPSTREAM_INSECURE_TLS_FALLBACK'] ?? '1')))),
        ['1', 'true', 'yes', 'on'],
        true
    );

    $executeRequest = static function (string $url, bool $insecureTls = false) use ($upstreamCookieHeader, $upstreamCaBundlePath, $forwardHeaders): array {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 8);
        $headers = ['Accept: application/json'];
        foreach ($forwardHeaders as $headerLine) {
            $trimmed = trim((string) $headerLine);
            if ($trimmed !== '') {
                $headers[] = $trimmed;
            }
        }
        // Only add the env cookie when the forwarded headers don't already carry
        // one (auth'd routes get it via $resolveUpstreamAuthHeaders); avoids a
        // duplicate Cookie header. Routes without auth headers (cs-updates,
        // exchange-rate) still get the cookie from the env here.
        $hasCookieHeader = false;
        foreach ($headers as $existingHeader) {
            if (stripos((string) $existingHeader, 'cookie:') === 0) {
                $hasCookieHeader = true;
                break;
            }
        }
        if (!$hasCookieHeader && $upstreamCookieHeader !== '') {
            $headers[] = 'Cookie: ' . $upstreamCookieHeader;
        }
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_MAXREDIRS, 5);
        if ($insecureTls) {
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
            curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
        } elseif ($upstreamCaBundlePath !== '' && is_file($upstreamCaBundlePath)) {
            curl_setopt($ch, CURLOPT_CAINFO, $upstreamCaBundlePath);
        }

        $response = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $effectiveUrl = (string) curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
        $curlError = curl_error($ch);
        curl_close($ch);

        return [
            'response' => $response,
            'httpCode' => $httpCode,
            'effectiveUrl' => $effectiveUrl,
            'curlError' => $curlError,
            'insecureTls' => $insecureTls,
        ];
    };

    $queryString = http_build_query($query);
    $attempts = [];
    foreach ($buildUpstreamCandidates($baseUrl, $endpointPath) as $candidate) {
        $separator = str_contains($candidate, '?') ? '&' : '?';
        $url = $candidate . ($queryString !== '' ? ($separator . $queryString) : '');
        $result = $executeRequest($url, false);
        $response = $result['response'];
        $httpCode = (int) ($result['httpCode'] ?? 0);
        $curlError = (string) ($result['curlError'] ?? '');

        if (!is_string($response) || trim($response) === '') {
            $certificateIssue = str_contains(strtolower($curlError), 'certificate')
                || str_contains(strtolower($curlError), 'issuer certificate')
                || str_contains(strtolower($curlError), 'ssl');
            if ($certificateIssue && $allowInsecureTlsFallback) {
                $retry = $executeRequest($url, true);
                $retryResponse = $retry['response'];
                $retryHttpCode = (int) ($retry['httpCode'] ?? 0);
                $retryCurlError = (string) ($retry['curlError'] ?? '');

                if (is_string($retryResponse) && trim($retryResponse) !== '') {
                    $retryDecoded = json_decode($retryResponse, true);
                    if (is_array($retryDecoded) && $retryHttpCode >= 200 && $retryHttpCode < 300) {
                        return [
                            'ok' => true,
                            'data' => isset($retryDecoded['data']) ? $retryDecoded['data'] : $retryDecoded,
                            'meta' => isset($retryDecoded['meta']) && is_array($retryDecoded['meta']) ? $retryDecoded['meta'] : [],
                            'attempts' => array_merge($attempts, [[
                                'url' => $url,
                                'httpCode' => $httpCode,
                                'curlError' => $curlError,
                                'responseType' => 'empty',
                            ]]),
                            'insecureTlsUsed' => true,
                        ];
                    }
                }

                $attempts[] = [
                    'url' => $url,
                    'httpCode' => $retryHttpCode,
                    'curlError' => $retryCurlError,
                    'responseType' => 'empty_insecure_retry',
                    'insecureTls' => true,
                ];
                continue;
            }

            $attempts[] = [
                'url' => $url,
                'httpCode' => $httpCode,
                'curlError' => $curlError,
                'responseType' => 'empty',
            ];
            continue;
        }

        $decoded = json_decode($response, true);
        if (!is_array($decoded)) {
            $attempts[] = [
                'url' => $url,
                'httpCode' => $httpCode,
                'effectiveUrl' => (string) ($result['effectiveUrl'] ?? ''),
                'curlError' => $curlError,
                'responseType' => 'non_json',
                'bodyPreview' => substr(trim($response), 0, 180),
            ];
            continue;
        }

        if ($httpCode >= 200 && $httpCode < 300) {
            return [
                'ok' => true,
                'data' => isset($decoded['data']) ? $decoded['data'] : $decoded,
                'meta' => isset($decoded['meta']) && is_array($decoded['meta']) ? $decoded['meta'] : [],
                'attempts' => $attempts,
            ];
        }

        $attempts[] = [
            'url' => $url,
            'httpCode' => $httpCode,
            'curlError' => $curlError,
            'responseType' => 'json_non_2xx',
            'errorCode' => $decoded['error']['code'] ?? null,
            'errorMessage' => $decoded['error']['message'] ?? null,
        ];
    }

    return [
        'ok' => false,
        'attempts' => $attempts,
    ];
};

// Shared upstream sender for write methods (PUT/POST). Mirrors $proxyUpstreamGet's
// TLS handling: the desktop sidecar runs the host's system PHP, which on Windows
// often has no configured curl CA bundle, so HTTPS verification fails with curl
// code 0. The GET proxy already retries insecurely on certificate errors; without
// the same here, EVERY write (settings, groups, refresh-stale, watchlist batch)
// silently failed and got swallowed as a desktop-local-fallback success.
$proxyUpstreamSend = static function (
    string $method,
    string $endpointPath,
    string $payloadJson,
    array $authHeaders = []
) use ($resolveUpstreamApiBase, $buildUpstreamCandidates): array {
    $baseUrl = $resolveUpstreamApiBase();
    if ($baseUrl === '') {
        return ['ok' => false, 'httpCode' => 0, 'attempts' => []];
    }

    $upstreamCaBundlePath = trim((string) (getenv('UPSTREAM_CA_BUNDLE_PATH') ?: ($_ENV['UPSTREAM_CA_BUNDLE_PATH'] ?? '')));
    $allowInsecureTlsFallback = in_array(
        strtolower(trim((string) (getenv('UPSTREAM_INSECURE_TLS_FALLBACK') ?: ($_ENV['UPSTREAM_INSECURE_TLS_FALLBACK'] ?? '1')))),
        ['1', 'true', 'yes', 'on'],
        true
    );

    $execute = static function (string $url, bool $insecureTls) use ($method, $payloadJson, $authHeaders, $upstreamCaBundlePath): array {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $payloadJson);
        curl_setopt(
            $ch,
            CURLOPT_HTTPHEADER,
            array_merge(['Accept: application/json', 'Content-Type: application/json'], $authHeaders)
        );
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_MAXREDIRS, 5);
        if ($insecureTls) {
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
            curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
        } elseif ($upstreamCaBundlePath !== '' && is_file($upstreamCaBundlePath)) {
            curl_setopt($ch, CURLOPT_CAINFO, $upstreamCaBundlePath);
        }

        $response = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = (string) curl_error($ch);
        curl_close($ch);

        return ['response' => $response, 'httpCode' => $httpCode, 'curlError' => $curlError];
    };

    $attempts = [];
    foreach ($buildUpstreamCandidates($baseUrl, $endpointPath) as $candidate) {
        $result = $execute($candidate, false);
        $response = $result['response'];
        $httpCode = (int) $result['httpCode'];
        $curlError = (string) $result['curlError'];

        // Retry once insecurely on a TLS/certificate error (or any connect-level
        // failure that produced no HTTP status), matching the GET proxy.
        $noHttpStatus = !is_string($response) || trim($response) === '' || $httpCode === 0;
        $certificateIssue = str_contains(strtolower($curlError), 'certificate')
            || str_contains(strtolower($curlError), 'ssl');
        if ($noHttpStatus && ($certificateIssue || $httpCode === 0) && $allowInsecureTlsFallback) {
            $retry = $execute($candidate, true);
            if (is_string($retry['response']) && trim($retry['response']) !== '') {
                $response = $retry['response'];
                $httpCode = (int) $retry['httpCode'];
                $curlError = (string) $retry['curlError'];
            } else {
                $attempts[] = ['url' => $candidate, 'httpCode' => (int) $retry['httpCode'], 'curlError' => (string) $retry['curlError'], 'insecureTls' => true];
                continue;
            }
        }

        if (!is_string($response) || trim($response) === '') {
            $attempts[] = ['url' => $candidate, 'httpCode' => $httpCode, 'curlError' => $curlError];
            continue;
        }

        $decoded = json_decode($response, true);
        if (!is_array($decoded)) {
            $attempts[] = ['url' => $candidate, 'httpCode' => $httpCode, 'responseType' => 'non_json'];
            continue;
        }

        if ($httpCode >= 200 && $httpCode < 300) {
            return [
                'ok' => true,
                'httpCode' => $httpCode,
                'data' => isset($decoded['data']) ? $decoded['data'] : $decoded,
                'meta' => isset($decoded['meta']) && is_array($decoded['meta']) ? $decoded['meta'] : [],
                'attempts' => $attempts,
            ];
        }

        $attempts[] = ['url' => $candidate, 'httpCode' => $httpCode, 'responseType' => 'json_non_2xx'];
    }

    return ['ok' => false, 'httpCode' => 0, 'attempts' => $attempts];
};

$summarizeProxyIssue = static function (array $attempts, string $endpointPath = ''): array {
    $attemptedUrls = [];
    $attemptStatuses = [];
    foreach ($attempts as $attempt) {
        if (!is_array($attempt)) {
            continue;
        }
        $url = trim((string) ($attempt['url'] ?? ''));
        if ($url !== '') {
            $attemptedUrls[] = $url;
        }
        $status = (int) ($attempt['httpCode'] ?? 0);
        if ($status > 0) {
            $attemptStatuses[] = $status;
        }
    }

    $withContext = static function (array $issue) use ($endpointPath, $attemptedUrls, $attemptStatuses): array {
        if ($endpointPath !== '') {
            $issue['endpointPath'] = $endpointPath;
        }
        if ($attemptedUrls !== []) {
            $issue['attemptedUrls'] = $attemptedUrls;
        }
        if ($attemptStatuses !== []) {
            $issue['attemptStatuses'] = $attemptStatuses;
        }
        return $issue;
    };

    foreach ($attempts as $attempt) {
        if (!is_array($attempt)) {
            continue;
        }
        $curlError = strtolower((string) ($attempt['curlError'] ?? ''));
        if ($curlError !== '' && (str_contains($curlError, 'issuer certificate') || str_contains($curlError, 'certificate'))) {
            return $withContext([
                'code' => 'UPSTREAM_TLS_CERTIFICATE_ERROR',
                'message' => 'TLS certificate chain could not be verified by the desktop sidecar.',
            ]);
        }
    }

    // Positively identify a Cloudflare Access challenge so the renderer can
    // re-trigger the CF login window. curl follows the 302, so the most reliable
    // signal is the effective URL landing on the Access login host; the body
    // preview is a fallback (the login HTML may not carry markers in its head).
    foreach ($attempts as $attempt) {
        if (!is_array($attempt)) {
            continue;
        }
        $effectiveUrl = strtolower((string) ($attempt['effectiveUrl'] ?? ''));
        $bodyPreview = strtolower((string) ($attempt['bodyPreview'] ?? ''));
        $looksLikeAccessChallenge =
            ($effectiveUrl !== '' && (str_contains($effectiveUrl, 'cloudflareaccess.com') || str_contains($effectiveUrl, '/cdn-cgi/access/')))
            || ($bodyPreview !== '' && (str_contains($bodyPreview, 'cloudflare access')
                || str_contains($bodyPreview, '/cdn-cgi/access/login')
                || str_contains($bodyPreview, 'cloudflareaccess.com')));
        if ($looksLikeAccessChallenge) {
            return $withContext([
                'code' => 'CLOUDFLARE_ACCESS_LOGIN_REQUIRED',
                'message' => 'Cloudflare Access session is missing or expired. Sign in again to continue.',
            ]);
        }
    }

    foreach ($attempts as $attempt) {
        if (!is_array($attempt)) {
            continue;
        }
        $status = (int) ($attempt['httpCode'] ?? 0);
        if (in_array($status, [301, 302, 307, 308], true)) {
            return $withContext([
                'code' => 'UPSTREAM_REDIRECT',
                'message' => 'Upstream returned an HTTP redirect (often Cloudflare Access or auth redirect).',
            ]);
        }
        if (in_array($status, [401, 403], true)) {
            return $withContext([
                'code' => 'UPSTREAM_ACCESS_DENIED',
                'message' => 'Upstream denied access. Cloudflare/session login may be required.',
            ]);
        }
        if ($status >= 500) {
            return $withContext([
                'code' => 'UPSTREAM_SERVER_ERROR',
                'message' => 'Upstream returned a server error (5xx).',
            ]);
        }
        if ($status === 404) {
            return $withContext([
                'code' => 'UPSTREAM_ROUTE_NOT_FOUND',
                'message' => 'Upstream route not found (404).',
            ]);
        }
    }

    return $withContext([
        'code' => 'UPSTREAM_UNAVAILABLE',
        'message' => 'Upstream did not return a usable JSON response.',
    ]);
};

$copyUserScopeQuery = static function (Request $request, array $query = []): array {
    foreach (['userId', 'user_id', 'steamId', 'steam_id'] as $key) {
        $value = trim((string) ($request->query[$key] ?? ''));
        if ($value !== '') {
            $query[$key] = $value;
        }
    }

    return $query;
};

$resolveUpstreamAuthHeaders = static function (Request $request): array {
    $headers = [];
    foreach (['authorization', 'x-auth-token'] as $headerKey) {
        $value = trim((string) ($request->headers[$headerKey] ?? ''));
        if ($value === '') {
            continue;
        }

        $normalizedName = $headerKey === 'authorization' ? 'Authorization' : 'X-Auth-Token';
        $headers[] = $normalizedName . ': ' . $value;
    }

    // Forward the Cloudflare Access cookie (promoted into UPSTREAM_COOKIE_HEADER
    // from the per-request X-Upstream-Cf-Cookie header) so the inline POST/PUT
    // upstream calls (refresh-stale, watchlist/batch, settings PUT) authenticate
    // through the Zero Trust tunnel too — not just the GET proxy.
    $cfCookie = trim((string) (getenv('UPSTREAM_COOKIE_HEADER') ?: ($_ENV['UPSTREAM_COOKIE_HEADER'] ?? '')));
    if ($cfCookie !== '') {
        $headers[] = 'Cookie: ' . $cfCookie;
    }

    return $headers;
};

$router->register('GET', '/api/v1/settings/price-source', static function (Request $request) use ($proxyUpstreamGet, $resolveUpstreamAuthHeaders): void {
    $proxied = $proxyUpstreamGet('/api/v1/settings/price-source', [], $resolveUpstreamAuthHeaders($request));
    if ($proxied !== null && ($proxied['ok'] ?? false) === true) {
        JsonResponseFactory::success(
            is_array($proxied['data'] ?? null) ? $proxied['data'] : ['mode' => 'auto'],
            array_merge($proxied['meta'] ?? [], ['source' => 'upstream'])
        );
        return;
    }

    JsonResponseFactory::success(
        [
            'userId' => 1,
            'mode' => 'auto',
            'updatedAt' => null,
            'source' => 'desktop-defaults',
        ],
        [
            'source' => 'desktop-local-fallback',
            'proxyAttempts' => $proxied['attempts'] ?? [],
        ]
    );
});

$router->register('GET', '/api/v1/settings/currency', static function (Request $request) use ($proxyUpstreamGet, $resolveUpstreamAuthHeaders): void {
    $proxied = $proxyUpstreamGet('/api/v1/settings/currency', [], $resolveUpstreamAuthHeaders($request));
    if ($proxied !== null && ($proxied['ok'] ?? false) === true) {
        JsonResponseFactory::success(
            is_array($proxied['data'] ?? null) ? $proxied['data'] : ['currency' => 'EUR', 'popularCurrencies' => []],
            array_merge($proxied['meta'] ?? [], ['source' => 'upstream'])
        );
        return;
    }

    JsonResponseFactory::success(
        [
            'userId' => 1,
            'currency' => 'EUR',
            'updatedAt' => null,
            'source' => 'desktop-defaults',
            'popularCurrencies' => [],
        ],
        [
            'source' => 'desktop-local-fallback',
            'proxyAttempts' => $proxied['attempts'] ?? [],
        ]
    );
});

$router->register('PUT', '/api/v1/settings/currency', static function (Request $request) use ($proxyUpstreamSend, $resolveUpstreamAuthHeaders): void {
    $currencyRaw = strtoupper(trim((string) ($request->body['currency'] ?? 'EUR')));
    $currency = preg_match('/^[A-Z]{3}$/', $currencyRaw) === 1 ? $currencyRaw : 'EUR';

    $payloadJson = json_encode(['currency' => $currency], JSON_UNESCAPED_SLASHES);
    if (!is_string($payloadJson)) {
        JsonResponseFactory::error('SETTINGS_VALIDATION_FAILED', 'Ungueltiger Payload.', [], 400);
        return;
    }

    $sent = $proxyUpstreamSend('PUT', '/api/v1/settings/currency', $payloadJson, $resolveUpstreamAuthHeaders($request));
    if (($sent['ok'] ?? false) === true) {
        JsonResponseFactory::success(
            is_array($sent['data'] ?? null) ? $sent['data'] : ['currency' => $currency, 'popularCurrencies' => []],
            array_merge(is_array($sent['meta'] ?? null) ? $sent['meta'] : [], ['source' => 'upstream'])
        );
        return;
    }

    JsonResponseFactory::error(
        'SETTINGS_SAVE_FAILED',
        'Currency-Preference konnte nicht zum Server gespeichert werden.',
        [],
        502
    );
});

$router->register('GET', '/api/v1/settings/portfolio-groups', static function (Request $request) use ($proxyUpstreamGet, $resolveUpstreamAuthHeaders): void {
    $proxied = $proxyUpstreamGet('/api/v1/settings/portfolio-groups', [], $resolveUpstreamAuthHeaders($request));
    if ($proxied !== null && ($proxied['ok'] ?? false) === true) {
        JsonResponseFactory::success(
            is_array($proxied['data'] ?? null)
                ? $proxied['data']
                : ['userId' => 1, 'groups' => [], 'updatedAt' => null, 'source' => 'upstream'],
            array_merge($proxied['meta'] ?? [], ['source' => 'upstream'])
        );
        return;
    }

    JsonResponseFactory::success(
        [
            'userId' => 1,
            'groups' => [],
            'updatedAt' => null,
            'source' => 'desktop-defaults',
        ],
        [
            'source' => 'desktop-local-fallback',
            'proxyAttempts' => $proxied['attempts'] ?? [],
        ]
    );
});

$router->register('PUT', '/api/v1/settings/portfolio-groups', static function (Request $request) use ($proxyUpstreamSend, $resolveUpstreamAuthHeaders): void {
    $groups = $request->body['groups'] ?? [];
    if (!is_array($groups)) {
        JsonResponseFactory::error('SETTINGS_VALIDATION_FAILED', 'groups muss ein Array sein.', [], 400);
        return;
    }

    $payloadJson = json_encode(['groups' => $groups], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (!is_string($payloadJson)) {
        JsonResponseFactory::error('SETTINGS_VALIDATION_FAILED', 'Ungueltiger Payload.', [], 400);
        return;
    }

    $sent = $proxyUpstreamSend('PUT', '/api/v1/settings/portfolio-groups', $payloadJson, $resolveUpstreamAuthHeaders($request));
    if (($sent['ok'] ?? false) === true) {
        JsonResponseFactory::success(
            is_array($sent['data'] ?? null)
                ? $sent['data']
                : ['userId' => 1, 'groups' => $groups, 'updatedAt' => gmdate('Y-m-d H:i:s')],
            array_merge(is_array($sent['meta'] ?? null) ? $sent['meta'] : [], ['source' => 'upstream'])
        );
        return;
    }

    // Upstream unreachable/erroring (CF Access lapse, server down, 5xx). The renderer
    // has already persisted these groups to local state, and the GET handler serves a
    // desktop-local fallback + auto-migrates local-only groups to the server once it is
    // reachable again. So degrade gracefully to a local-fallback success instead of a
    // hard 502 that loses the write and spams the console — mirroring the GET handler.
    JsonResponseFactory::success(
        [
            'userId' => 1,
            'groups' => $groups,
            'updatedAt' => gmdate('Y-m-d H:i:s'),
            'source' => 'desktop-local-fallback',
        ],
        [
            'source' => 'desktop-local-fallback',
            'upstreamAttempts' => array_map(static fn ($a) => is_array($a) ? ($a['httpCode'] ?? 0) : $a, $sent['attempts'] ?? []),
        ]
    );
});

$router->register('PUT', '/api/v1/settings/price-source', static function (Request $request) use ($proxyUpstreamSend, $resolveUpstreamAuthHeaders): void {
    $mode = strtolower(trim((string) ($request->body['mode'] ?? 'auto')));
    if (!in_array($mode, ['auto', 'csfloat', 'steam'], true)) {
        $mode = 'auto';
    }

    $payloadJson = json_encode(['mode' => $mode], JSON_UNESCAPED_SLASHES);
    if (!is_string($payloadJson)) {
        JsonResponseFactory::error('SETTINGS_VALIDATION_FAILED', 'Ungueltiger Payload.', [], 400);
        return;
    }

    $sent = $proxyUpstreamSend('PUT', '/api/v1/settings/price-source', $payloadJson, $resolveUpstreamAuthHeaders($request));
    if (($sent['ok'] ?? false) === true) {
        JsonResponseFactory::success(
            is_array($sent['data'] ?? null) ? $sent['data'] : ['mode' => $mode],
            array_merge(is_array($sent['meta'] ?? null) ? $sent['meta'] : [], ['source' => 'upstream'])
        );
        return;
    }

    JsonResponseFactory::error(
        'SETTINGS_SAVE_FAILED',
        'Price-Source-Preference konnte nicht zum Server gespeichert werden.',
        [],
        502
    );
});

$router->register('GET', '/api/v1/portfolio/history', static function (Request $request) use ($proxyUpstreamGet, $copyUserScopeQuery, $resolveUpstreamAuthHeaders): void {
    $query = $copyUserScopeQuery($request);
    if (isset($request->query['scope'])) {
        $query['scope'] = (string) $request->query['scope'];
    }
    $proxied = $proxyUpstreamGet('/api/v1/portfolio/history', $query, $resolveUpstreamAuthHeaders($request));
    if ($proxied !== null && ($proxied['ok'] ?? false) === true) {
        JsonResponseFactory::success(
            $proxied['data'],
            array_merge($proxied['meta'] ?? [], ['source' => 'upstream'])
        );
        return;
    }

    JsonResponseFactory::success([], [
        'source' => 'desktop-local-fallback',
        'proxyAttempts' => $proxied['attempts'] ?? [],
    ]);
});

$router->register('GET', '/api/v1/portfolio/investments', static function (Request $request) use ($proxyUpstreamGet, $summarizeProxyIssue, $copyUserScopeQuery, $resolveUpstreamAuthHeaders): void {
    $query = $copyUserScopeQuery($request);
    if (isset($request->query['scope'])) {
        $query['scope'] = (string) $request->query['scope'];
    }
    $proxied = $proxyUpstreamGet('/api/v1/portfolio/investments', $query, $resolveUpstreamAuthHeaders($request));
    if ($proxied !== null && ($proxied['ok'] ?? false) === true) {
        JsonResponseFactory::success(
            $proxied['data'],
            array_merge($proxied['meta'] ?? [], ['source' => 'upstream'])
        );
        return;
    }

    JsonResponseFactory::success([], [
        'source' => 'desktop-local-fallback',
        'proxyAttempts' => $proxied['attempts'] ?? [],
        'upstreamHint' => $summarizeProxyIssue($proxied['attempts'] ?? [], '/api/v1/portfolio/investments'),
    ]);
});

$router->register('POST', '/api/v1/portfolio/prices/refresh-stale', static function (Request $request) use ($resolveUpstreamApiBase, $proxyUpstreamSend, $resolveUpstreamAuthHeaders): void {
    $baseUrl = $resolveUpstreamApiBase();
    if ($baseUrl === '') {
        JsonResponseFactory::success(
            [
                'scope' => strtolower(trim((string) ($request->body['scope'] ?? 'investments'))) === 'all' ? 'all' : 'investments',
                'limit' => max(1, min((int) ($request->body['limit'] ?? 200), 2000)),
                'staleItemsFound' => 0,
                'requested' => 0,
                'updated' => 0,
            ],
            ['source' => 'desktop-local-fallback']
        );
        return;
    }

    $scope = strtolower(trim((string) ($request->body['scope'] ?? 'investments'))) === 'all' ? 'all' : 'investments';
    $limit = max(1, min((int) ($request->body['limit'] ?? 200), 2000));
    $payload = json_encode(
        [
            'userId' => $request->body['userId'] ?? null,
            'steamId' => $request->body['steamId'] ?? null,
            'scope' => $scope,
            'limit' => $limit,
        ],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );
    if (!is_string($payload)) {
        JsonResponseFactory::error('PORTFOLIO_REFRESH_STALE_INVALID', 'Ungueltiger Payload.', [], 400);
        return;
    }

    $sent = $proxyUpstreamSend('POST', '/api/v1/portfolio/prices/refresh-stale', $payload, $resolveUpstreamAuthHeaders($request));
    if (($sent['ok'] ?? false) === true) {
        JsonResponseFactory::success(
            $sent['data'] ?? [],
            is_array($sent['meta'] ?? null) && $sent['meta'] !== [] ? $sent['meta'] : ['source' => 'upstream']
        );
        return;
    }

    JsonResponseFactory::error(
        'PORTFOLIO_REFRESH_STALE_UPSTREAM_FAILED',
        'Stale-Preis-Refresh konnte nicht an den Server gesendet werden.',
        [],
        502
    );
});

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

$router->register('GET', '/api/v1/watchlist/search', static function (Request $request) use ($proxyUpstreamGet, $summarizeProxyIssue, $copyUserScopeQuery, $resolveUpstreamAuthHeaders): void {
    $query = $copyUserScopeQuery($request, [
        'query' => $request->query['query'] ?? '',
        'limit' => $request->query['limit'] ?? 6,
        'page' => $request->query['page'] ?? 1,
    ]);
    foreach (['itemType', 'wear', 'sortBy'] as $optional) {
        $value = trim((string) ($request->query[$optional] ?? ''));
        if ($value !== '') {
            $query[$optional] = $value;
        }
    }

    $proxied = $proxyUpstreamGet('/api/v1/watchlist/search', $query, $resolveUpstreamAuthHeaders($request));
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
    ], [
        'proxyAttempts' => $proxied['attempts'] ?? [],
        'upstreamHint' => $summarizeProxyIssue($proxied['attempts'] ?? []),
    ]);
});

$router->register('GET', '/api/v1/watchlist', static function (Request $request) use ($proxyUpstreamGet, $summarizeProxyIssue, $copyUserScopeQuery, $resolveUpstreamAuthHeaders): void {
    $query = $copyUserScopeQuery($request);
    if (isset($request->query['syncLive'])) {
        $query['syncLive'] = (string) $request->query['syncLive'];
    }

    $proxied = $proxyUpstreamGet('/api/v1/watchlist', $query, $resolveUpstreamAuthHeaders($request));
    if ($proxied !== null && ($proxied['ok'] ?? false) === true) {
        JsonResponseFactory::success(
            is_array($proxied['data'] ?? null) ? $proxied['data'] : [],
            array_merge($proxied['meta'] ?? [], ['source' => 'upstream'])
        );
        return;
    }

    JsonResponseFactory::success([], [
        'source' => 'desktop-local-fallback',
        'proxyAttempts' => $proxied['attempts'] ?? [],
        'upstreamHint' => $summarizeProxyIssue($proxied['attempts'] ?? []),
    ]);
});

$router->register('GET', '/api/v1/cs-updates', static function (Request $request) use ($proxyUpstreamGet): void {
    $query = [];
    if (isset($request->query['limit'])) {
        $query['limit'] = (string) $request->query['limit'];
    }
    if (isset($request->query['before'])) {
        $query['before'] = (string) $request->query['before'];
    }
    if (isset($request->query['since'])) {
        $query['since'] = (string) $request->query['since'];
    }

    $proxied = $proxyUpstreamGet('/api/v1/cs-updates', $query);
    if ($proxied !== null && ($proxied['ok'] ?? false) === true) {
        JsonResponseFactory::success(
            is_array($proxied['data'] ?? null) ? $proxied['data'] : ['items' => []],
            array_merge($proxied['meta'] ?? [], ['source' => 'upstream'])
        );
        return;
    }

    JsonResponseFactory::success(
        ['items' => []],
        [
            'source' => 'desktop-local-fallback',
            'sourceMode' => 'desktop-local-fallback',
            'fetchedAt' => gmdate(DATE_ATOM),
            'lastRefreshAt' => gmdate(DATE_ATOM),
            'staleAfterSeconds' => 120,
            'bannerVisibleHours' => max(1, min(24 * 30, (int) (getenv('CS_UPDATES_BANNER_DURATION_HOURS') ?: 168))),
            'isStale' => true,
            'nextBefore' => null,
            'proxyAttempts' => $proxied['attempts'] ?? [],
        ]
    );
});

$router->register('GET', '/api/v1/portfolio/investments/{key}/history', static function (Request $request, string $itemId) use ($proxyUpstreamGet, $copyUserScopeQuery, $resolveUpstreamAuthHeaders): void {
    if ($itemId === '') {
        JsonResponseFactory::error('ITEM_ID_REQUIRED', 'Item-ID erforderlich.', [], 400);
        return;
    }

    $query = $copyUserScopeQuery($request);
    if (isset($request->query['itemName'])) {
        $query['itemName'] = (string) $request->query['itemName'];
    }

    $proxied = $proxyUpstreamGet('/api/v1/portfolio/investments/' . rawurlencode($itemId) . '/history', $query, $resolveUpstreamAuthHeaders($request));
    if ($proxied !== null && ($proxied['ok'] ?? false) === true) {
        JsonResponseFactory::success($proxied['data'], array_merge($proxied['meta'] ?? [], ['source' => 'upstream']));
        return;
    }

    JsonResponseFactory::success([
        'itemId' => $itemId,
        'itemName' => (string) ($request->query['itemName'] ?? ''),
        'history' => [],
        'source' => 'desktop-local-fallback',
    ]);
});

$router->register('GET', '/api/v1/items/{id}/price-history', static function (Request $request, int $itemId) use ($proxyUpstreamGet, $summarizeProxyIssue, $copyUserScopeQuery, $resolveUpstreamAuthHeaders): void {
    if ($itemId <= 0) {
        JsonResponseFactory::error('ITEM_ID_REQUIRED', 'Item-ID erforderlich.', [], 400);
        return;
    }

    $query = [];
    if (isset($request->query['fromDate'])) {
        $query['fromDate'] = (string) $request->query['fromDate'];
    }
    $itemName = trim((string) ($request->query['itemName'] ?? ''));

    $authHeaders = $resolveUpstreamAuthHeaders($request);
    $scopeQuery = $copyUserScopeQuery($request);

    $proxied = $proxyUpstreamGet('/api/v1/items/' . $itemId . '/price-history', $query, $authHeaders);
    if (
        $proxied !== null
        && ($proxied['ok'] ?? false) === true
        && is_array($proxied['data'] ?? null)
        && count($proxied['data']) > 0
    ) {
        JsonResponseFactory::success($proxied['data'], array_merge($proxied['meta'] ?? [], ['source' => 'upstream']));
        return;
    }

    if ($itemName !== '') {
        $normalizedName = mb_strtolower($itemName);

        $resolveFromPortfolioInvestments = static function (string $targetName) use ($proxyUpstreamGet, $authHeaders, $scopeQuery): int {
            $portfolio = $proxyUpstreamGet('/api/v1/portfolio/investments', $scopeQuery, $authHeaders);
            if ($portfolio === null || ($portfolio['ok'] ?? false) !== true || !is_array($portfolio['data'] ?? null)) {
                return 0;
            }

            $rows = $portfolio['data'];
            $fallback = 0;
            foreach ($rows as $row) {
                if (!is_array($row)) {
                    continue;
                }

                $candidateName = trim((string) ($row['marketHashName'] ?? $row['name'] ?? $row['itemName'] ?? ''));
                $candidateItemId = (int) ($row['itemId'] ?? $row['item_id'] ?? 0);
                if ($candidateItemId <= 0) {
                    continue;
                }

                if ($fallback <= 0) {
                    $fallback = $candidateItemId;
                }

                if ($candidateName !== '' && mb_strtolower($candidateName) === $targetName) {
                    return $candidateItemId;
                }
            }

            return $fallback;
        };

        $resolvedItemId = $resolveFromPortfolioInvestments($normalizedName);
        if ($resolvedItemId > 0) {
            $retry = $proxyUpstreamGet('/api/v1/items/' . $resolvedItemId . '/price-history', $query, $authHeaders);
            if ($retry !== null && ($retry['ok'] ?? false) === true) {
                JsonResponseFactory::success($retry['data'], array_merge($retry['meta'] ?? [], [
                    'source' => 'upstream-portfolio-name-resolved',
                    'resolvedItemId' => $resolvedItemId,
                ]));
                return;
            }
        }

        $search = $proxyUpstreamGet(
            '/api/v1/watchlist/search',
            array_merge($scopeQuery, ['query' => $itemName, 'limit' => 10, 'page' => 1]),
            $authHeaders
        );
        if ($search !== null && ($search['ok'] ?? false) === true) {
            $items = $search['data']['items'] ?? [];
            if (is_array($items)) {
                $resolvedItemId = 0;
                foreach ($items as $row) {
                    if (!is_array($row)) {
                        continue;
                    }
                    $candidateName = trim((string) ($row['marketHashName'] ?? $row['name'] ?? ''));
                    if ($candidateName !== '' && mb_strtolower($candidateName) === $normalizedName) {
                        $resolvedItemId = (int) ($row['id'] ?? 0);
                        break;
                    }
                }
                if ($resolvedItemId <= 0) {
                    foreach ($items as $row) {
                        if (!is_array($row)) {
                            continue;
                        }
                        $resolvedItemId = (int) ($row['id'] ?? 0);
                        if ($resolvedItemId > 0) {
                            break;
                        }
                    }
                }

                if ($resolvedItemId > 0) {
                    $retry = $proxyUpstreamGet('/api/v1/items/' . $resolvedItemId . '/price-history', $query);
                    if ($retry !== null && ($retry['ok'] ?? false) === true) {
                        JsonResponseFactory::success($retry['data'], array_merge($retry['meta'] ?? [], [
                            'source' => 'upstream-name-resolved',
                            'resolvedItemId' => $resolvedItemId,
                        ]));
                        return;
                    }
                }
            }
        }
    }

    JsonResponseFactory::success([], [
        'source' => 'desktop-local-fallback',
        'proxyAttempts' => $proxied['attempts'] ?? [],
        'upstreamHint' => $summarizeProxyIssue($proxied['attempts'] ?? []),
    ]);
});

$router->register('POST', '/api/v1/watchlist/batch', static function (Request $request) use ($resolveUpstreamApiBase, $proxyUpstreamSend, $resolveUpstreamAuthHeaders): void {
    if ($resolveUpstreamApiBase() === '') {
        JsonResponseFactory::error('UPSTREAM_NOT_CONFIGURED', 'Server URL nicht konfiguriert.', [], 503);
        return;
    }

    $body = json_encode(['items' => $request->body['items'] ?? []], JSON_UNESCAPED_UNICODE);
    if (!is_string($body)) {
        JsonResponseFactory::error('WATCHLIST_BATCH_INVALID', 'Ungueltiger Payload.', [], 400);
        return;
    }

    $sent = $proxyUpstreamSend('POST', '/api/v1/watchlist/batch', $body, $resolveUpstreamAuthHeaders($request));
    if (($sent['ok'] ?? false) === true) {
        JsonResponseFactory::success(
            $sent['data'] ?? [],
            is_array($sent['meta'] ?? null) && $sent['meta'] !== [] ? $sent['meta'] : ['source' => 'upstream']
        );
        return;
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

$router->register('GET', '/api/v1/debug/watchlist-search-stats', static function (Request $request) use ($proxyUpstreamGet): void {
    $hours = max(1, min((int) ($request->query['hours'] ?? 24), 24 * 14));
    $limit = max(50, min((int) ($request->query['limit'] ?? 3000), 10000));
    $top = max(1, min((int) ($request->query['top'] ?? 10), 50));

    $query = [
        'hours' => $hours,
        'limit' => $limit,
        'top' => $top,
    ];
    $proxied = $proxyUpstreamGet('/api/v1/debug/watchlist-search-stats', $query);
    if ($proxied !== null && ($proxied['ok'] ?? false) === true) {
        JsonResponseFactory::success(
            is_array($proxied['data'] ?? null) ? $proxied['data'] : [],
            array_merge($proxied['meta'] ?? [], ['source' => 'upstream'])
        );
        return;
    }

    JsonResponseFactory::success(
        [
            'source' => 'desktop-local-fallback',
            'generatedAt' => gmdate(DATE_ATOM),
            'hours' => $hours,
            'limit' => $limit,
            'top' => $top,
            'totalFetchedEvents' => 0,
            'searchEvents' => 0,
            'summary' => [
                'totalSearches' => 0,
                'slowSearches' => 0,
                'slowRatePercent' => 0.0,
                'steamFallbackSearches' => 0,
                'steamFallbackRatePercent' => 0.0,
                'avgDurationMs' => null,
                'p50DurationMs' => null,
                'p95DurationMs' => null,
                'p99DurationMs' => null,
                'avgResultTotalItems' => null,
                'sourceBreakdown' => [],
            ],
            'topQueries' => [],
            'slowSamples' => [],
        ],
        [
            'source' => 'desktop-local-fallback',
            'proxyAttempts' => $proxied['attempts'] ?? [],
        ]
    );
});

$router->register('POST', '/api/v1/observability/frontend-events', static function (): void {
    http_response_code(204);
});

$router->dispatch($request);
