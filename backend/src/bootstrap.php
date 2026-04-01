<?php
declare(strict_types=1);

/**
 * Lädt Umgebungsvariablen aus einer .env Datei
 */
function loadEnvFile(string $filePath): bool
{
    if (!is_file($filePath)) {
        return false;
    }

    $lines = file($filePath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        // Kommentare ignorieren
        if (str_starts_with(trim($line), '#')) {
            continue;
        }

        // KEY=VALUE Zeilen parsen
        if (strpos($line, '=') === false) {
            continue;
        }

        [$key, $value] = explode('=', $line, 2);
        $key = trim($key);
        $value = trim($value, " \t\n\r\0\x0B\"'");

        // Setze die Variable wenn noch nicht gesetzt
        if (!isset($_ENV[$key]) && !getenv($key)) {
            $_ENV[$key] = $value;
            putenv("{$key}={$value}");
        }
    }
    return true;
}

// Versuche .env Datei aus verschiedenen Pfaden zu laden
$envPaths = [
    __DIR__ . '/../.env',
    __DIR__ . '/../../.env',
    '/var/www/html/.env',
    '/var/www/html/api/.env',
];

$envLoaded = false;
$loadedEnvPath = null;
foreach ($envPaths as $envPath) {
    if (loadEnvFile($envPath)) {
        $envLoaded = true;
        $loadedEnvPath = $envPath;
        break;
    }
}

// Der Autoloader nutzt __DIR__, was in diesem Fall /var/www/html/api/src ist.
$autoloadReady = false;
spl_autoload_register(static function (string $class): void {
    $prefix = 'App\\';
    $baseDir = __DIR__ . DIRECTORY_SEPARATOR;

    if (strncmp($prefix, $class, strlen($prefix)) !== 0) {
        return;
    }

    $relativeClass = substr($class, strlen($prefix));
    $file = $baseDir . str_replace('\\', DIRECTORY_SEPARATOR, $relativeClass) . '.php';

    if (is_file($file)) {
        require_once $file;
    }
});
$autoloadReady = true;

$GLOBALS['APP_BOOTSTRAP_DIAGNOSTICS'] = [
    'envLoaded' => $envLoaded,
    'envPath' => $loadedEnvPath,
    'autoloadReady' => $autoloadReady,
];

if (!function_exists('app_bootstrap_diagnostics')) {
    function app_bootstrap_diagnostics(): array
    {
        $diagnostics = $GLOBALS['APP_BOOTSTRAP_DIAGNOSTICS'] ?? null;
        if (!is_array($diagnostics)) {
            return [
                'envLoaded' => false,
                'envPath' => null,
                'autoloadReady' => false,
            ];
        }

        return [
            'envLoaded' => (bool) ($diagnostics['envLoaded'] ?? false),
            'envPath' => isset($diagnostics['envPath']) ? (string) $diagnostics['envPath'] : null,
            'autoloadReady' => (bool) ($diagnostics['autoloadReady'] ?? false),
        ];
    }
}
