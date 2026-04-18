<?php
declare(strict_types=1);

namespace App\Observability\Application;

use App\Observability\Context\RequestContextStore;
use App\Observability\Domain\LogCategory;
use App\Observability\Domain\LogEvent;
use App\Observability\Domain\LogLevel;
use App\Observability\Infrastructure\Persistence\ObservabilityEventRepository;
use App\Observability\Infrastructure\Sink\FileSink;
use App\Observability\Sanitization\ContextSanitizer;
use Throwable;

final class ObservabilityService
{
    public function __construct(
        private ?ObservabilityEventRepository $eventRepository,
        private readonly FileSink $fileSink,
        private readonly ContextSanitizer $contextSanitizer,
        private readonly bool $dbWriteEnabled = true
    ) {
    }

    public function setRepository(ObservabilityEventRepository $eventRepository): void
    {
        $this->eventRepository = $eventRepository;
    }

    public function log(
        string $level,
        string $category,
        string $event,
        string $message,
        array $context = []
    ): void {
        try {
            $this->logInternal($level, $category, $event, $message, $context);
        } catch (Throwable $exception) {
            $this->fileSink->writeLegacy('ERROR', 'Observability log failed', [
                'event' => $event,
                'reason' => $exception->getMessage(),
            ]);
        }
    }

    public function debug(string $category, string $event, string $message, array $context = []): void
    {
        $this->log(LogLevel::DEBUG, $category, $event, $message, $context);
    }

    public function info(string $category, string $event, string $message, array $context = []): void
    {
        $this->log(LogLevel::INFO, $category, $event, $message, $context);
    }

    public function warning(string $category, string $event, string $message, array $context = []): void
    {
        $this->log(LogLevel::WARNING, $category, $event, $message, $context);
    }

    public function error(string $category, string $event, string $message, array $context = []): void
    {
        $this->log(LogLevel::ERROR, $category, $event, $message, $context);
    }

    private function logInternal(
        string $level,
        string $category,
        string $event,
        string $message,
        array $context
    ): void {
        $normalizedLevel = LogLevel::normalize($level);
        $normalizedCategory = LogCategory::normalize($category);

        $method = $this->extractString($context, 'method');
        $route = $this->extractString($context, 'route');
        $requestId = $this->extractString($context, 'requestId');
        $statusCode = $this->extractInt($context, 'statusCode');
        $durationMs = $this->extractInt($context, 'durationMs');

        $requestContext = RequestContextStore::get();
        if ($requestContext !== null) {
            $requestId ??= $requestContext->requestId;
            $method ??= $requestContext->method;
            $route ??= $requestContext->path;

            if (($requestContext->userAgent ?? '') !== '' && !isset($context['userAgent'])) {
                $context['userAgent'] = $requestContext->userAgent;
            }

            if (($requestContext->ip ?? '') !== '' && !isset($context['ip'])) {
                $context['ip'] = $requestContext->ip;
            }
        }

        $sanitizedContext = $this->contextSanitizer->sanitize($context);
        $eventModel = LogEvent::now(
            level: $normalizedLevel,
            category: $normalizedCategory,
            event: trim($event) !== '' ? trim($event) : 'system.unknown_event',
            message: trim($message) !== '' ? trim($message) : 'No message',
            requestId: $requestId,
            method: $method,
            route: $route,
            statusCode: $statusCode,
            durationMs: $durationMs,
            context: $sanitizedContext
        );

        if ($this->dbWriteEnabled && $this->eventRepository !== null) {
            try {
                $this->eventRepository->save($eventModel);
            } catch (Throwable $exception) {
                $this->fileSink->writeLegacy('ERROR', 'Observability DB write failed', [
                    'event' => $event,
                    'reason' => $exception->getMessage(),
                ]);
            }
        }

        $this->fileSink->writeLegacy(
            strtoupper($normalizedLevel),
            $eventModel->message,
            [
                'event' => $eventModel->event,
                'category' => $eventModel->category,
                'requestId' => $eventModel->requestId,
                'method' => $eventModel->method,
                'route' => $eventModel->route,
                'statusCode' => $eventModel->statusCode,
                'durationMs' => $eventModel->durationMs,
                'context' => $sanitizedContext,
            ]
        );
    }

    private function extractString(array &$context, string $key): ?string
    {
        if (!isset($context[$key])) {
            return null;
        }

        $value = $context[$key];
        unset($context[$key]);

        if (!is_scalar($value)) {
            return null;
        }

        $resolved = trim((string) $value);

        return $resolved === '' ? null : $resolved;
    }

    private function extractInt(array &$context, string $key): ?int
    {
        if (!isset($context[$key])) {
            return null;
        }

        $value = $context[$key];
        unset($context[$key]);

        if (!is_numeric($value)) {
            return null;
        }

        return (int) $value;
    }
}

