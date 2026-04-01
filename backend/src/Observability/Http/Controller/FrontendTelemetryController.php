<?php
declare(strict_types=1);

namespace App\Observability\Http\Controller;

use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Request;
use App\Shared\Logger;

final class FrontendTelemetryController
{
    private const MAX_EVENTS_PER_MINUTE = 20;
    private const MAX_PAYLOAD_BYTES = 8192;

    public function ingest(Request $request): void
    {
        if (!$this->isEnabled()) {
            JsonResponseFactory::error(
                'FRONTEND_TELEMETRY_DISABLED',
                'Frontend Telemetry ist deaktiviert.',
                [],
                404
            );
            return;
        }

        $ip = (string) ($request->headers['x-forwarded-for'] ?? $request->headers['x-real-ip'] ?? ($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
        if (!$this->allowEventForIp($ip)) {
            JsonResponseFactory::error(
                'FRONTEND_TELEMETRY_RATE_LIMITED',
                'Zu viele Telemetry-Events. Bitte spaeter erneut versuchen.',
                [],
                429
            );
            return;
        }

        $payloadSize = strlen(json_encode($request->body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '');
        if ($payloadSize > self::MAX_PAYLOAD_BYTES) {
            JsonResponseFactory::error(
                'FRONTEND_TELEMETRY_PAYLOAD_TOO_LARGE',
                'Payload zu gross.',
                [],
                413
            );
            return;
        }

        $event = trim((string) ($request->body['event'] ?? 'frontend.unknown'));
        $message = trim((string) ($request->body['message'] ?? 'Frontend telemetry event'));
        $level = trim((string) ($request->body['level'] ?? 'error'));
        $context = is_array($request->body['context'] ?? null) ? $request->body['context'] : [];
        $context['source'] = 'frontend';

        if (isset($context['stack']) && is_string($context['stack'])) {
            $stackLines = explode("\n", $context['stack']);
            $context['stack'] = implode("\n", array_slice($stackLines, 0, 20));
        }

        Logger::event($level, 'frontend', $event, $message, $context);
        JsonResponseFactory::success(['accepted' => true]);
    }

    private function isEnabled(): bool
    {
        return $this->envFlag('DEBUG', false) || $this->envFlag('OBSERVABILITY_FRONTEND_TELEMETRY_ENABLED', false);
    }

    private function envFlag(string $key, bool $default): bool
    {
        $value = getenv($key);
        if ($value === false && isset($_ENV[$key])) {
            $value = $_ENV[$key];
        }

        if ($value === false || $value === null || trim((string) $value) === '') {
            return $default;
        }

        return in_array(strtolower(trim((string) $value)), ['1', 'true', 'yes', 'on'], true);
    }

    private function allowEventForIp(string $ip): bool
    {
        $bucketFile = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'cs***REMOVED***_frontend_telemetry_rate_limit.json';
        $now = time();

        $payload = [];
        if (is_file($bucketFile)) {
            $raw = @file_get_contents($bucketFile);
            $decoded = is_string($raw) ? json_decode($raw, true) : null;
            if (is_array($decoded)) {
                $payload = $decoded;
            }
        }

        $buckets = is_array($payload['buckets'] ?? null) ? $payload['buckets'] : [];
        $entry = is_array($buckets[$ip] ?? null) ? $buckets[$ip] : ['windowStart' => $now, 'count' => 0];
        $windowStart = (int) ($entry['windowStart'] ?? $now);
        $count = (int) ($entry['count'] ?? 0);

        if (($now - $windowStart) >= 60) {
            $windowStart = $now;
            $count = 0;
        }

        if ($count >= self::MAX_EVENTS_PER_MINUTE) {
            return false;
        }

        $buckets[$ip] = [
            'windowStart' => $windowStart,
            'count' => $count + 1,
        ];

        $payload['buckets'] = $buckets;
        @file_put_contents($bucketFile, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        return true;
    }
}

