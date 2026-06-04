<?php
declare(strict_types=1);

namespace App\Http\Controller;

use App\Application\Service\SyncService;
use App\Infrastructure\Persistence\Repository\UserRepository;
use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Request;
use Throwable;

final class SyncController
{
    public function __construct(
        private readonly SyncService $syncService,
        private readonly ?UserRepository $userRepository = null
    ) {
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
            ?? null;
        if (is_numeric($candidate)) {
            $userId = (int) $candidate;

            if ($userId <= 0) {
                throw new \InvalidArgumentException('Invalid userId. Expected positive integer.');
            }

            return $userId;
        }

        $steamId = $this->resolveSteamId($request, $candidate);
        if ($steamId !== null && $this->userRepository !== null) {
            return $this->userRepository->findOrCreateBySteamId($steamId);
        }

        if ($candidate !== null && trim((string) $candidate) !== '') {
            throw new \InvalidArgumentException('Invalid userId. Expected positive integer or steamId.');
        }

        return 1;
    }

    private function resolveSteamId(Request $request, mixed $candidate): ?string
    {
        foreach ([$request->query['steamId'] ?? null, $request->body['steamId'] ?? null, $candidate] as $value) {
            $raw = trim((string) ($value ?? ''));
            if ($raw === '') {
                continue;
            }

            if (preg_match('/^steam-([1-9]\d{10,})$/i', $raw, $matches) === 1) {
                return $matches[1];
            }

            if (preg_match('/^[1-9]\d{10,}$/', $raw) === 1) {
                return $raw;
            }
        }

        return null;
    }
}
