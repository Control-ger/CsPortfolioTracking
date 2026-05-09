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
        $candidates[] = $base . '?route=' . rawurlencode($endpoint);
    } elseif (str_ends_with($lower, '/api')) {
        $candidates[] = $base . '/index.php' . $endpoint;
        $candidates[] = $base . '/index.php?route=' . rawurlencode($endpoint);
        $candidates[] = substr($base, 0, -strlen('/api')) . $endpoint;
    } else {
        $candidates[] = $base . '/api/index.php' . $endpoint;
        $candidates[] = $base . '/api/index.php?route=' . rawurlencode($endpoint);
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

    $upstreamCookieHeader = trim((string) (getenv('UPSTREAM_COOKIE_HEADER') ?: ($_ENV['UPSTREAM_COOKIE_HEADER'] ?? '')));
    $upstreamCaBundlePath = trim((string) (getenv('UPSTREAM_CA_BUNDLE_PATH') ?: ($_ENV['UPSTREAM_CA_BUNDLE_PATH'] ?? '')));
    $allowInsecureTlsFallback = in_array(
        strtolower(trim((string) (getenv('UPSTREAM_INSECURE_TLS_FALLBACK') ?: ($_ENV['UPSTREAM_INSECURE_TLS_FALLBACK'] ?? '1')))),
        ['1', 'true', 'yes', 'on'],
        true
    );

    $executeRequest = static function (string $url, bool $insecureTls = false) use ($upstreamCookieHeader, $upstreamCaBundlePath): array {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 8);
        $headers = ['Accept: application/json'];
        if ($upstreamCookieHeader !== '') {
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
        $curlError = curl_error($ch);
        curl_close($ch);

        return [
            'response' => $response,
            'httpCode' => $httpCode,
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

$summarizeProxyIssue = static function (array $attempts): array {
    foreach ($attempts as $attempt) {
        if (!is_array($attempt)) {
            continue;
        }
        $curlError = strtolower((string) ($attempt['curlError'] ?? ''));
        if ($curlError !== '' && (str_contains($curlError, 'issuer certificate') || str_contains($curlError, 'certificate'))) {
            return [
                'code' => 'UPSTREAM_TLS_CERTIFICATE_ERROR',
                'message' => 'TLS certificate chain could not be verified by the desktop sidecar.',
            ];
        }
    }

    foreach ($attempts as $attempt) {
        if (!is_array($attempt)) {
            continue;
        }
        $status = (int) ($attempt['httpCode'] ?? 0);
        if (in_array($status, [301, 302, 307, 308], true)) {
            return [
                'code' => 'UPSTREAM_REDIRECT',
                'message' => 'Upstream returned an HTTP redirect (often Cloudflare Access or auth redirect).',
            ];
        }
        if (in_array($status, [401, 403], true)) {
            return [
                'code' => 'UPSTREAM_ACCESS_DENIED',
                'message' => 'Upstream denied access. Cloudflare/session login may be required.',
            ];
        }
        if ($status >= 500) {
            return [
                'code' => 'UPSTREAM_SERVER_ERROR',
                'message' => 'Upstream returned a server error (5xx).',
            ];
        }
        if ($status === 404) {
            return [
                'code' => 'UPSTREAM_ROUTE_NOT_FOUND',
                'message' => 'Upstream route not found (404).',
            ];
        }
    }

    return [
        'code' => 'UPSTREAM_UNAVAILABLE',
        'message' => 'Upstream did not return a usable JSON response.',
    ];
};

$router->register('GET', '/api/v1/portfolio/history', static function () use ($proxyUpstreamGet): void {
    $proxied = $proxyUpstreamGet('/api/v1/portfolio/history');
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

$router->register('GET', '/api/v1/watchlist/search', static function (Request $request) use ($proxyUpstreamGet, $summarizeProxyIssue): void {
    $query = [
        'query' => $request->query['query'] ?? '',
        'limit' => $request->query['limit'] ?? 6,
        'page' => $request->query['page'] ?? 1,
    ];
    foreach (['itemType', 'wear', 'sortBy'] as $optional) {
        $value = trim((string) ($request->query[$optional] ?? ''));
        if ($value !== '') {
            $query[$optional] = $value;
        }
    }

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
    ], [
        'proxyAttempts' => $proxied['attempts'] ?? [],
        'upstreamHint' => $summarizeProxyIssue($proxied['attempts'] ?? []),
    ]);
});

$router->register('GET', '/api/v1/portfolio/investments/{key}/history', static function (Request $request, string $itemId) use ($proxyUpstreamGet): void {
    if ($itemId === '') {
        JsonResponseFactory::error('ITEM_ID_REQUIRED', 'Item-ID erforderlich.', [], 400);
        return;
    }

    $query = [];
    if (isset($request->query['itemName'])) {
        $query['itemName'] = (string) $request->query['itemName'];
    }

    $proxied = $proxyUpstreamGet('/api/v1/portfolio/investments/' . rawurlencode($itemId) . '/history', $query);
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

$router->register('GET', '/api/v1/items/{id}/price-history', static function (Request $request, int $itemId) use ($proxyUpstreamGet, $summarizeProxyIssue): void {
    if ($itemId <= 0) {
        JsonResponseFactory::error('ITEM_ID_REQUIRED', 'Item-ID erforderlich.', [], 400);
        return;
    }

    $query = [];
    if (isset($request->query['fromDate'])) {
        $query['fromDate'] = (string) $request->query['fromDate'];
    }
    $itemName = trim((string) ($request->query['itemName'] ?? ''));

    $proxied = $proxyUpstreamGet('/api/v1/items/' . $itemId . '/price-history', $query);
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

        $resolveFromPortfolioInvestments = static function (string $targetName) use ($proxyUpstreamGet): int {
            $portfolio = $proxyUpstreamGet('/api/v1/portfolio/investments');
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
            $retry = $proxyUpstreamGet('/api/v1/items/' . $resolvedItemId . '/price-history', $query);
            if ($retry !== null && ($retry['ok'] ?? false) === true) {
                JsonResponseFactory::success($retry['data'], array_merge($retry['meta'] ?? [], [
                    'source' => 'upstream-portfolio-name-resolved',
                    'resolvedItemId' => $resolvedItemId,
                ]));
                return;
            }
        }

        $search = $proxyUpstreamGet('/api/v1/watchlist/search', ['query' => $itemName, 'limit' => 10, 'page' => 1]);
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
