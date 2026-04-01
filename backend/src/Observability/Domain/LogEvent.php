<?php
declare(strict_types=1);

namespace App\Observability\Domain;

use DateTimeImmutable;
use DateTimeZone;

final class LogEvent
{
    public function __construct(
        public readonly DateTimeImmutable $timestampUtc,
        public readonly string $level,
        public readonly string $category,
        public readonly string $event,
        public readonly string $message,
        public readonly ?string $requestId,
        public readonly ?string $method,
        public readonly ?string $route,
        public readonly ?int $statusCode,
        public readonly ?int $durationMs,
        public readonly array $context
    ) {
    }

    public static function now(
        string $level,
        string $category,
        string $event,
        string $message,
        ?string $requestId,
        ?string $method,
        ?string $route,
        ?int $statusCode,
        ?int $durationMs,
        array $context
    ): self {
        return new self(
            new DateTimeImmutable('now', new DateTimeZone('UTC')),
            $level,
            $category,
            $event,
            $message,
            $requestId,
            $method,
            $route,
            $statusCode,
            $durationMs,
            $context
        );
    }

    public function toDatabaseRow(): array
    {
        $contextJson = null;
        if ($this->context !== []) {
            $encoded = json_encode($this->context, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            $contextJson = is_string($encoded) ? $encoded : null;
        }

        return [
            'timestamp_utc' => $this->timestampUtc->format('Y-m-d H:i:s'),
            'level' => $this->level,
            'category' => $this->category,
            'event_name' => $this->event,
            'message' => $this->message,
            'request_id' => $this->requestId,
            'method' => $this->method,
            'route' => $this->route,
            'status_code' => $this->statusCode,
            'duration_ms' => $this->durationMs,
            'context_json' => $contextJson,
        ];
    }

    public function toArray(): array
    {
        return [
            'timestamp' => $this->timestampUtc->format('Y-m-d\TH:i:s\Z'),
            'level' => $this->level,
            'category' => $this->category,
            'event' => $this->event,
            'message' => $this->message,
            'requestId' => $this->requestId,
            'method' => $this->method,
            'route' => $this->route,
            'statusCode' => $this->statusCode,
            'durationMs' => $this->durationMs,
            'context' => $this->context,
        ];
    }
}
