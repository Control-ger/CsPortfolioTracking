<?php
declare(strict_types=1);

namespace App\Http\Controller;

use App\Application\Service\SyncService;
use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Request;
use Throwable;

final class SyncController
{
    public function __construct(private readonly SyncService $syncService)
    {
    }

    public function pull(Request $request): void
    {
        try {
            $userId = $this->resolveUserId($request);
            $since = isset($request->query['since']) ? (string) $request->query['since'] : null;
            $limit = isset($request->query['limit']) ? (int) $request->query['limit'] : 500;

            $data = $this->syncService->pull($userId, $since, $limit);
            JsonResponseFactory::success($data);
        } catch (\InvalidArgumentException $validationError) {
            JsonResponseFactory::error(
                'SYNC_PULL_INVALID_REQUEST',
                $validationError->getMessage(),
                [],
                400
            );
        } catch (Throwable $exception) {
            JsonResponseFactory::error(
                'SYNC_PULL_FAILED',
                'Sync pull failed.',
                ['exception' => $exception->getMessage()],
                500
            );
        }
    }

    public function push(Request $request): void
    {
        try {
            $userId = $this->resolveUserId($request);
            $changes = $request->body['changes'] ?? null;

            if (!is_array($changes)) {
                JsonResponseFactory::error(
                    'SYNC_PUSH_INVALID_REQUEST',
                    'Request body must contain a changes array.',
                    [],
                    400
                );
                return;
            }

            $result = $this->syncService->push($userId, $changes);
            JsonResponseFactory::success($result);
        } catch (\InvalidArgumentException $validationError) {
            JsonResponseFactory::error(
                'SYNC_PUSH_INVALID_REQUEST',
                $validationError->getMessage(),
                [],
                400
            );
        } catch (Throwable $exception) {
            JsonResponseFactory::error(
                'SYNC_PUSH_FAILED',
                'Sync push failed.',
                ['exception' => $exception->getMessage()],
                500
            );
        }
    }

    private function resolveUserId(Request $request): int
    {
        $candidate = $request->query['userId']
            ?? $request->body['userId']
            ?? 1;
        $userId = (int) $candidate;

        if ($userId <= 0) {
            throw new \InvalidArgumentException('Invalid userId. Expected positive integer.');
        }

        return $userId;
    }
}

