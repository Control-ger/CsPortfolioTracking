<?php
declare(strict_types=1);

header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json');

$bootstrapPath = __DIR__ . '/src/bootstrap.php';
if (is_file($bootstrapPath)) {
    require_once $bootstrapPath;
}

/**
 * Legacy helper for reading keys from .env files.
 */
function getEnvKey(string $key, ?string $default = null): ?string
{
    $paths = ['./.env', '../.env', '../../.env', '/var/www/html/.env', '/var/www/html/api/.env'];
    foreach ($paths as $path) {
        if (!file_exists($path)) {
            continue;
        }

        $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if (!is_array($lines)) {
            continue;
        }

        foreach ($lines as $line) {
            if (strpos(trim($line), '#') === 0 || strpos($line, '=') === false) {
                continue;
            }

            [$name, $value] = explode('=', $line, 2);
            $name = trim($name);
            $value = trim($value, " \t\n\r\0\x0B\"'");

            if ($name === $key) {
                return $value;
            }
        }
    }

    return $default;
}

function proxyLogEvent(string $level, string $event, string $message, array $context = []): void
{
    if (class_exists(\App\Shared\Logger::class)) {
        \App\Shared\Logger::event($level, 'external', $event, $message, $context);
    }
}

$marketHashName = isset($_GET['market_hash_name']) ? trim((string) $_GET['market_hash_name']) : '';
$apiKey = getEnvKey('CSFLOAT_API_KEY');
$requestStart = microtime(true);

proxyLogEvent(
    'info',
    'external.csfloat.proxy.request',
    'Legacy CSFloat proxy request started',
    ['marketHashName' => $marketHashName]
);

if ($apiKey === null || $apiKey === '') {
    proxyLogEvent(
        'error',
        'external.csfloat.proxy.response',
        'Legacy CSFloat proxy request failed: missing API key',
        ['success' => false, 'errorCode' => 'CSFLOAT_PROXY_MISSING_API_KEY']
    );
    http_response_code(500);
    echo json_encode(['error' => 'API Key nicht in .env gefunden']);
    exit;
}

if ($marketHashName === '') {
    proxyLogEvent(
        'warning',
        'external.csfloat.proxy.response',
        'Legacy CSFloat proxy request failed: missing market hash name',
        ['success' => false, 'errorCode' => 'CSFLOAT_PROXY_MISSING_MARKET_HASH_NAME']
    );
    http_response_code(400);
    echo json_encode(['error' => 'No item name provided']);
    exit;
}

$encodedName = urlencode($marketHashName);
$url = "https://csfloat.com/api/v1/listings?market_hash_name=$encodedName&type=buy_now&sort_by=lowest_price&limit=1";

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 10);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Authorization: $apiKey",
    'Accept: application/json',
    'User-Agent: CsPortfolioTracking/1.0',
]);

$response = curl_exec($ch);
$httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

$durationMs = (int) round((microtime(true) - $requestStart) * 1000);

if ($response === false) {
    proxyLogEvent(
        'error',
        'error.curl',
        'Legacy CSFloat proxy curl error',
        [
            'provider' => 'csfloat',
            'durationMs' => $durationMs,
            'statusCode' => $httpCode > 0 ? $httpCode : null,
            'errorCode' => 'CSFLOAT_PROXY_CURL_FAILED',
            'curlError' => $curlError,
        ]
    );
}

proxyLogEvent(
    $response === false || $httpCode >= 400 ? 'warning' : 'info',
    'external.csfloat.proxy.response',
    'Legacy CSFloat proxy response received',
    [
        'provider' => 'csfloat',
        'success' => $response !== false && $httpCode >= 200 && $httpCode < 400,
        'httpCode' => $httpCode > 0 ? $httpCode : null,
        'durationMs' => $durationMs,
        'errorCode' => $response === false ? 'CSFLOAT_PROXY_CURL_FAILED' : null,
    ]
);

// Legacy file log remains as fallback.
$logDir = '/var/www/html/logs';
if (!is_dir($logDir)) {
    @mkdir($logDir, 0755, true);
}

$logFile = $logDir . '/csfloat_proxy.log';
$timestamp = date('Y-m-d H:i:s');
$legacyLogLine = sprintf(
    '[%s] CSFloat Proxy | httpCode=%s | durationMs=%d | curlError=%d | responseBytes=%d%s',
    $timestamp,
    (string) $httpCode,
    $durationMs,
    strlen($curlError),
    is_string($response) ? strlen($response) : 0,
    PHP_EOL
);
@file_put_contents($logFile, $legacyLogLine, FILE_APPEND);

http_response_code($httpCode > 0 ? $httpCode : 500);
echo is_string($response) ? $response : json_encode(['error' => 'CSFloat proxy request failed']);

