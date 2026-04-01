<?php
declare(strict_types=1);

namespace App\Shared;

use App\Observability\Application\ObservabilityService;
use App\Observability\Application\ObservabilityServiceRegistry;

final class Logger
{
    private const LOG_DIR = '/var/www/html/logs';

    private static ?ObservabilityService $observabilityService = null;

    public static function setObservabilityService(?ObservabilityService $observabilityService): void
    {
        self::$observabilityService = $observabilityService;
        if ($observabilityService !== null) {
            ObservabilityServiceRegistry::set($observabilityService);
        }
    }

    public static function event(
        string $level,
        string $category,
        string $event,
        string $message,
        array $context = []
    ): void {
        $service = self::$observabilityService ?? ObservabilityServiceRegistry::get();
        if ($service !== null) {
            $service->log($level, $category, $event, $message, $context);
            return;
        }

        self::logLegacy($level, $message, array_merge($context, ['category' => $category, 'event' => $event]));
    }

    public static function info(string $message, array $context = []): void
    {
        self::log('INFO', $message, $context);
    }

    public static function error(string $message, array $context = []): void
    {
        self::log('ERROR', $message, $context);
    }

    public static function debug(string $message, array $context = []): void
    {
        self::log('DEBUG', $message, $context);
    }

    public static function warning(string $message, array $context = []): void
    {
        self::log('WARNING', $message, $context);
    }

    private static function log(string $level, string $message, array $context = []): void
    {
        $service = self::$observabilityService ?? ObservabilityServiceRegistry::get();
        if ($service !== null) {
            $category = isset($context['category']) ? (string) $context['category'] : 'system';
            $event = isset($context['event']) ? (string) $context['event'] : 'legacy.log';
            unset($context['category'], $context['event']);

            $service->log($level, $category, $event, $message, $context);
            return;
        }

        self::logLegacy($level, $message, $context);
    }

    private static function logLegacy(string $level, string $message, array $context = []): void
    {
        $timestamp = date('Y-m-d H:i:s');
        $contextStr = !empty($context)
            ? ' | ' . (json_encode($context, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}')
            : '';
        $logMessage = "[{$timestamp}] {$level}: {$message}{$contextStr}\n";

        // Versuche in die Datei zu schreiben
        $logFile = self::LOG_DIR . '/app.log';
        
        // Stelle sicher, dass das Verzeichnis existiert
        if (!is_dir(self::LOG_DIR)) {
            @mkdir(self::LOG_DIR, 0755, true);
        }

        // Schreibe in die Log-Datei
        @file_put_contents($logFile, $logMessage, FILE_APPEND);

        // Fallback: Schreibe auch zu stderr für Docker-Logs (ohne STDERR Konstante)
        $stderr = fopen('php://stderr', 'w');
        if ($stderr) {
            fwrite($stderr, $logMessage);
            fclose($stderr);
        }
    }
}
