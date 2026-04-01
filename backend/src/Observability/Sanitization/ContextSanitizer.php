<?php
declare(strict_types=1);

namespace App\Observability\Sanitization;

use Stringable;
use Throwable;

final class ContextSanitizer
{
    private const MAX_CONTEXT_BYTES = 16384;
    private const MAX_STACK_LINES = 20;
    private const REDACTED_VALUE = '[REDACTED]';
    private const SENSITIVE_KEYS = [
        'authorization',
        'api_key',
        'apikey',
        'password',
        'token',
        'cookie',
        'set-cookie',
    ];

    public function sanitize(array $context): array
    {
        $sanitized = $this->sanitizeValue($context);
        if (!is_array($sanitized)) {
            $sanitized = ['value' => $sanitized];
        }

        $encoded = json_encode($sanitized, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (!is_string($encoded)) {
            return ['contextSerializationError' => true];
        }

        if (strlen($encoded) <= self::MAX_CONTEXT_BYTES) {
            return $sanitized;
        }

        $previewLength = max(0, self::MAX_CONTEXT_BYTES - 512);

        return [
            'contextTruncated' => true,
            'originalBytes' => strlen($encoded),
            'preview' => substr($encoded, 0, $previewLength),
        ];
    }

    private function sanitizeValue(mixed $value): mixed
    {
        if (is_array($value)) {
            $result = [];
            foreach ($value as $key => $entry) {
                $keyString = is_string($key) ? $key : (string) $key;

                if ($this->isSensitiveKey($keyString)) {
                    $result[$key] = self::REDACTED_VALUE;
                    continue;
                }

                $result[$key] = $this->sanitizeValue($entry);
            }

            return $result;
        }

        if ($value instanceof Throwable) {
            $stack = explode("\n", $value->getTraceAsString());

            return [
                'class' => $value::class,
                'message' => $value->getMessage(),
                'code' => $value->getCode(),
                'stack' => implode("\n", array_slice($stack, 0, self::MAX_STACK_LINES)),
            ];
        }

        if (is_object($value)) {
            if ($value instanceof Stringable) {
                return (string) $value;
            }

            return ['class' => $value::class];
        }

        if (is_resource($value)) {
            return '[resource]';
        }

        if (is_string($value) && strlen($value) > 4000) {
            return substr($value, 0, 4000) . '...[truncated]';
        }

        return $value;
    }

    private function isSensitiveKey(string $key): bool
    {
        $normalized = strtolower($key);

        foreach (self::SENSITIVE_KEYS as $sensitiveKey) {
            if ($normalized === $sensitiveKey || str_contains($normalized, $sensitiveKey)) {
                return true;
            }
        }

        return false;
    }
}
