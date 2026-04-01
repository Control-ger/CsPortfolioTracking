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
foreach ($envPaths as $envPath) {
    if (loadEnvFile($envPath)) {
        $envLoaded = true;
        break;
    }
}

// Der Autoloader nutzt __DIR__, was in diesem Fall /var/www/html/api/src ist.
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