<?php
declare(strict_types=1);

namespace App\Http\Controller;

use App\Infrastructure\Persistence\Repository\WebPushSubscriptionRepository;
use App\Application\Service\WebPushService;
use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Request;
use Throwable;

final class WebPushController
{
    public function __construct(
        private readonly WebPushSubscriptionRepository $repository,
        private readonly WebPushService $webPushService
    ) {
    }

    public function publicKey(Request $request): void
    {
        JsonResponseFactory::success([
            'configured' => $this->webPushService->isConfigured(),
            'publicKey' => $this->webPushService->getPublicKey(),
        ]);
    }

    public function subscribe(Request $request): void
    {
        try {
            $userId = $this->resolveUserId($request);
            $subscription = is_array($request->body['subscription'] ?? null)
                ? $request->body['subscription']
                : [];

            $endpoint = trim((string) ($subscription['endpoint'] ?? ''));
            if ($endpoint === '') {
                JsonResponseFactory::error(
                    'WEB_PUSH_INVALID_SUBSCRIPTION',
                    'Subscription endpoint is required.',
                    [],
                    400
                );
                return;
            }

            $keys = is_array($subscription['keys'] ?? null) ? $subscription['keys'] : [];
            $p256dh = isset($keys['p256dh']) ? trim((string) $keys['p256dh']) : null;
            $auth = isset($keys['auth']) ? trim((string) $keys['auth']) : null;
            $encoding = isset($subscription['contentEncoding'])
                ? trim((string) $subscription['contentEncoding'])
                : null;

            $this->repository->upsert($userId, $endpoint, $p256dh ?: null, $auth ?: null, $encoding ?: null);

            JsonResponseFactory::success([
                'subscribed' => true,
                'configured' => $this->webPushService->isConfigured(),
            ]);
        } catch (Throwable $exception) {
            JsonResponseFactory::error(
                'WEB_PUSH_SUBSCRIBE_FAILED',
                $exception->getMessage(),
                [],
                500
            );
        }
    }

    public function unsubscribe(Request $request): void
    {
        try {
            $userId = $this->resolveUserId($request);
            $endpoint = trim((string) ($request->body['endpoint'] ?? ''));
            if ($endpoint === '') {
                JsonResponseFactory::error(
                    'WEB_PUSH_INVALID_SUBSCRIPTION',
                    'Endpoint is required.',
                    [],
                    400
                );
                return;
            }

            $this->repository->deactivateByEndpoint($endpoint, $userId);
            JsonResponseFactory::success(['unsubscribed' => true]);
        } catch (Throwable $exception) {
            JsonResponseFactory::error(
                'WEB_PUSH_UNSUBSCRIBE_FAILED',
                $exception->getMessage(),
                [],
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

