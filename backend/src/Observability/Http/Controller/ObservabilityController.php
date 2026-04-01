<?php
declare(strict_types=1);

namespace App\Observability\Http\Controller;

use App\Observability\Infrastructure\Persistence\ObservabilityEventRepository;
use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Request;
use Throwable;

final class ObservabilityController
{
    public function __construct(private readonly ObservabilityEventRepository $eventRepository)
    {
    }

    public function events(Request $request): void
    {
        if (!$this->isEnabled()) {
            JsonResponseFactory::error(
                'OBSERVABILITY_EVENTS_DISABLED',
                'Observability endpoint ist deaktiviert.',
                [],
                404
            );
            return;
        }

        try {
            $limit = isset($request->query['limit']) ? (int) $request->query['limit'] : 100;
            $events = $this->eventRepository->findEvents(
                [
                    'category' => isset($request->query['category']) ? (string) $request->query['category'] : null,
                    'level' => isset($request->query['level']) ? (string) $request->query['level'] : null,
                    'event' => isset($request->query['event']) ? (string) $request->query['event'] : null,
                    'requestId' => isset($request->query['requestId']) ? (string) $request->query['requestId'] : null,
                    'from' => isset($request->query['from']) ? (string) $request->query['from'] : null,
                    'to' => isset($request->query['to']) ? (string) $request->query['to'] : null,
                ],
                $limit
            );

            JsonResponseFactory::success(
                $events,
                ['count' => count($events), 'limit' => max(1, min($limit, 1000))]
            );
        } catch (Throwable $exception) {
            JsonResponseFactory::error(
                'OBSERVABILITY_EVENTS_READ_FAILED',
                $exception->getMessage(),
                [],
                500
            );
        }
    }

    private function isEnabled(): bool
    {
        return $this->envFlag('DEBUG', false) || $this->envFlag('OBSERVABILITY_EVENTS_API_ENABLED', false);
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
}

