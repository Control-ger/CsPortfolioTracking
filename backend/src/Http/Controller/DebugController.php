<?php
declare(strict_types=1);

namespace App\Http\Controller;

use App\Observability\Infrastructure\Persistence\ObservabilityEventRepository;
use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Request;
use Throwable;

final class DebugController
{
    private const LEGACY_LOG_DIR = '/var/www/html/logs';

    public function __construct(private readonly ?ObservabilityEventRepository $observabilityRepository = null)
    {
    }

    public function logs(Request $request): void
    {
        try {
            $logType = (string) ($request->query['type'] ?? 'app');
            $limit = $this->resolveLimit($request, 100);

            $events = $this->queryObservabilityEvents($request, $limit, $logType);
            if ($events !== []) {
                JsonResponseFactory::success([
                    'type' => $logType,
                    'source' => 'observability_events',
                    'totalLines' => count($events),
                    'displayedLines' => count($events),
                    'logs' => array_map(fn(array $event): string => $this->formatEventLine($event), $events),
                    'events' => $events,
                ]);
                return;
            }

            $legacyLines = $this->readLegacyFileLogs($logType, $limit);
            if ($legacyLines === []) {
                $logFile = $this->getLogFilePath($logType);

                JsonResponseFactory::success([
                    'type' => $logType,
                    'source' => 'legacy_file',
                    'logs' => [],
                    'message' => "Keine Observability-Events und keine Legacy-Log-Datei gefunden: $logFile",
                ]);
                return;
            }

            JsonResponseFactory::success([
                'type' => $logType,
                'source' => 'legacy_file',
                'totalLines' => count($legacyLines),
                'displayedLines' => count($legacyLines),
                'logs' => $legacyLines,
                'events' => [],
            ]);
        } catch (Throwable $exception) {
            JsonResponseFactory::error('DEBUG_LOGS_FAILED', $exception->getMessage(), [], 500);
        }
    }

    public function csfloatDebug(Request $request): void
    {
        try {
            $limit = $this->resolveLimit($request, 100);
            $events = $this->queryObservabilityEvents($request, max($limit, 100), 'proxy');

            $logs = ['app' => [], 'proxy' => []];
            if ($events !== []) {
                $logs['app'] = array_map(fn(array $event): string => $this->formatEventLine($event), $events);
            } else {
                $logs['app'] = $this->readLegacyFileLogs('app', min(50, $limit));
            }
            $logs['proxy'] = $this->readLegacyFileLogs('proxy', min(50, $limit));

            $apiKey = getenv('CSFLOAT_API_KEY') ?: $_ENV['CSFLOAT_API_KEY'] ?? null;
            $envLocations = [
                '/var/www/html/.env' => is_file('/var/www/html/.env'),
                '/var/www/html/api/.env' => is_file('/var/www/html/api/.env'),
                '/home/api/.env' => is_file('/home/api/.env'),
                '/app/.env' => is_file('/app/.env'),
            ];

            $debug = [
                'source' => $events !== [] ? 'observability_events' : 'legacy_files',
                'eventsCount' => count($events),
                'env_locations' => $envLocations,
                'all_env_keys_count' => count(array_keys($_ENV)),
                'php_sapi_name' => php_sapi_name(),
                'getcwd' => getcwd(),
            ];

            JsonResponseFactory::success([
                'logs' => $logs,
                'events' => $events,
                'environment' => [
                    'apiKeyProvided' => $apiKey !== null && $apiKey !== '',
                    'apiKeyLength' => $apiKey ? strlen($apiKey) : 0,
                ],
                'debug' => $debug,
            ]);
        } catch (Throwable $exception) {
            JsonResponseFactory::error('DEBUG_CSFLOAT_FAILED', $exception->getMessage(), [], 500);
        }
    }

    private function resolveLimit(Request $request, int $default): int
    {
        $raw = $request->query['limit'] ?? $request->query['lines'] ?? $default;
        $value = (int) $raw;

        return max(1, min($value, 1000));
    }

    private function queryObservabilityEvents(Request $request, int $limit, string $logType): array
    {
        if ($this->observabilityRepository === null) {
            return [];
        }

        $filters = [
            'category' => isset($request->query['category']) ? (string) $request->query['category'] : null,
            'level' => isset($request->query['level']) ? (string) $request->query['level'] : null,
            'event' => isset($request->query['event']) ? (string) $request->query['event'] : null,
            'requestId' => isset($request->query['requestId']) ? (string) $request->query['requestId'] : null,
            'from' => isset($request->query['from']) ? (string) $request->query['from'] : null,
            'to' => isset($request->query['to']) ? (string) $request->query['to'] : null,
        ];

        if ($filters['category'] === null && !isset($request->query['category'])) {
            if ($logType === 'proxy') {
                $filters['category'] = 'external';
            } elseif ($logType === 'error') {
                $filters['category'] = 'error';
            }
        }

        $events = $this->observabilityRepository->findEvents($filters, $limit);

        if ($logType === 'proxy') {
            $events = $this->filterCsfloatRelatedEvents($events);
        }

        return $events;
    }

    private function filterCsfloatRelatedEvents(array $events): array
    {
        return array_values(
            array_filter(
                $events,
                fn(array $event): bool => $this->isCsfloatRelatedEvent($event)
            )
        );
    }

    private function isCsfloatRelatedEvent(array $event): bool
    {
        $eventName = strtolower((string) ($event['event'] ?? ''));
        $provider = strtolower((string) ($event['context']['provider'] ?? ''));

        if (str_starts_with($eventName, 'external.csfloat.')) {
            return true;
        }

        if ($eventName === 'external.pricing.fallback_to_steam') {
            return true;
        }

        if (in_array($eventName, ['error.curl', 'error.json_decode'], true) && $provider === 'csfloat') {
            return true;
        }

        return $provider === 'csfloat';
    }

    private function readLegacyFileLogs(string $type, int $lines): array
    {
        $logFile = $this->getLogFilePath($type);
        if (!is_file($logFile)) {
            return [];
        }

        $allLines = file($logFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if ($allLines === false) {
            return [];
        }

        return array_slice($allLines, -$lines);
    }

    private function formatEventLine(array $event): string
    {
        $timestamp = (string) ($event['timestamp'] ?? gmdate('Y-m-d\TH:i:s\Z'));
        $level = strtoupper((string) ($event['level'] ?? 'INFO'));
        $eventName = (string) ($event['event'] ?? 'unknown.event');
        $message = (string) ($event['message'] ?? '');
        $requestId = isset($event['requestId']) ? (string) $event['requestId'] : null;

        $parts = [sprintf('[%s] %s %s: %s', $timestamp, $level, $eventName, $message)];
        if ($requestId !== null && $requestId !== '') {
            $parts[] = 'requestId=' . $requestId;
        }

        $statusCode = isset($event['statusCode']) ? (string) $event['statusCode'] : null;
        if ($statusCode !== null && $statusCode !== '') {
            $parts[] = 'status=' . $statusCode;
        }

        $durationMs = isset($event['durationMs']) ? (string) $event['durationMs'] : null;
        if ($durationMs !== null && $durationMs !== '') {
            $parts[] = 'durationMs=' . $durationMs;
        }

        $context = is_array($event['context'] ?? null) ? $event['context'] : [];
        if ($context !== []) {
            $contextJson = json_encode($context, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if (is_string($contextJson) && $contextJson !== '') {
                $parts[] = 'context=' . $this->truncate($contextJson, 700);
            }
        }

        return implode(' | ', $parts);
    }

    private function getLogFilePath(string $type): string
    {
        $baseDir = self::LEGACY_LOG_DIR;

        return match ($type) {
            'app' => $baseDir . '/app.log',
            'proxy' => $baseDir . '/csfloat_proxy.log',
            'error' => $baseDir . '/app.log',
            default => $baseDir . '/app.log'
        };
    }

    private function truncate(string $value, int $maxLength): string
    {
        if (strlen($value) <= $maxLength) {
            return $value;
        }

        return substr($value, 0, $maxLength) . '...[truncated]';
    }
}
