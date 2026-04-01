<?php
declare(strict_types=1);

namespace App\Http\Controller;

use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Request;
use Throwable;

final class DebugController
{
    public function logs(Request $request): void
    {
        try {
            $logType = $request->query['type'] ?? 'app';
            $lines = (int) ($request->query['lines'] ?? 100);
            
            $logFile = $this->getLogFilePath($logType);
            
            if (!is_file($logFile)) {
                JsonResponseFactory::success([
                    'type' => $logType,
                    'logs' => [],
                    'message' => "Log-Datei nicht gefunden: $logFile"
                ]);
                return;
            }

            $allLines = file($logFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            if ($allLines === false) {
                JsonResponseFactory::error('DEBUG_READ_FAILED', 'Konnte Log-Datei nicht lesen', [], 500);
                return;
            }

            // Zeige die letzten N Zeilen
            $displayLines = array_slice($allLines, -$lines);
            
            JsonResponseFactory::success([
                'type' => $logType,
                'totalLines' => count($allLines),
                'displayedLines' => count($displayLines),
                'logs' => $displayLines
            ]);
        } catch (Throwable $exception) {
            JsonResponseFactory::error('DEBUG_LOGS_FAILED', $exception->getMessage(), [], 500);
        }
    }

    public function csfloatDebug(Request $request): void
    {
        try {
            $logs = [];
            
            // App Log
            $appLogFile = '/var/www/html/logs/app.log';
            if (is_file($appLogFile)) {
                $appLines = file($appLogFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
                $logs['app'] = array_slice($appLines, -50);
            }
            
            // Proxy Log
            $proxyLogFile = '/var/www/html/logs/csfloat_proxy.log';
            if (is_file($proxyLogFile)) {
                $proxyLines = file($proxyLogFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
                $logs['proxy'] = array_slice($proxyLines, -50);
            }
            
            // Environment check
            $apiKey = getenv('CSFLOAT_API_KEY') ?: $_ENV['CSFLOAT_API_KEY'] ?? null;
            
            // Check various .env locations
            $envLocations = [
                '/var/www/html/.env' => is_file('/var/www/html/.env'),
                '/var/www/html/api/.env' => is_file('/var/www/html/api/.env'),
                '/home/api/.env' => is_file('/home/api/.env'),
                '/app/.env' => is_file('/app/.env'),
            ];
            
            // Check if env variables are set
            $allEnvVars = $_ENV;
            
            // Debug info
            $debug = [
                'getenv' => getenv('CSFLOAT_API_KEY') ?: 'NOT_FOUND',
                'ENV' => $_ENV['CSFLOAT_API_KEY'] ?? 'NOT_FOUND',
                'env_locations' => $envLocations,
                'all_env_keys' => array_keys($allEnvVars),
                'php_sapi_name' => php_sapi_name(),
                'getcwd' => getcwd(),
            ];
            
            JsonResponseFactory::success([
                'logs' => $logs,
                'environment' => [
                    'apiKeyProvided' => $apiKey !== null && $apiKey !== '',
                    'apiKeyLength' => $apiKey ? strlen($apiKey) : 0,
                    'apiKeyPrefix' => $apiKey ? substr($apiKey, 0, 8) . '***' : 'NONE'
                ],
                'debug' => $debug
            ]);
        } catch (Throwable $exception) {
            JsonResponseFactory::error('DEBUG_CSFLOAT_FAILED', $exception->getMessage(), [], 500);
        }
    }

    private function getLogFilePath(string $type): string
    {
        $baseDir = '/var/www/html/logs';
        
        return match ($type) {
            'app' => $baseDir . '/app.log',
            'proxy' => $baseDir . '/csfloat_proxy.log',
            default => $baseDir . '/app.log'
        };
    }
}
