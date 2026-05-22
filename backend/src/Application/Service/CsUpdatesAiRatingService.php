<?php
declare(strict_types=1);

namespace App\Application\Service;

use App\Infrastructure\External\GeminiUpdateRaterClient;
use App\Infrastructure\Persistence\Repository\CsUpdatesFeedRepository;
use App\Infrastructure\Persistence\Repository\WebPushSubscriptionRepository;
use Throwable;

final class CsUpdatesAiRatingService
{
    public function __construct(
        private readonly CsUpdatesFeedRepository $repository,
        private readonly GeminiUpdateRaterClient $client,
        private readonly ?WebPushSubscriptionRepository $webPushSubscriptionRepository = null,
        private readonly ?WebPushService $webPushService = null
    ) {
    }

    /**
     * @return array{model:string,pendingFound:int,ratedCount:int,failedCount:int}
     */
    public function ratePending(int $limit = 12, int $minAgeSeconds = 45): array
    {
        $this->repository->ensureTable();
        $rows = $this->repository->listPendingAiRatings($limit, $minAgeSeconds);

        $ratedCount = 0;
        $failedCount = 0;

        foreach ($rows as $row) {
            $id = (int) ($row['id'] ?? 0);
            if ($id <= 0) {
                continue;
            }

            try {
                $rating = $this->client->classify($row);
                $this->repository->saveAiRating($id, $rating);
                $this->notifyHighImpactWebPush($rating);
                $ratedCount++;
            } catch (Throwable $exception) {
                $this->repository->markAiRatingFailed($id, $this->truncateError($exception->getMessage()));
                $failedCount++;
            }
        }

        return [
            'model' => $this->client->modelName(),
            'pendingFound' => count($rows),
            'ratedCount' => $ratedCount,
            'failedCount' => $failedCount,
        ];
    }

    private function truncateError(string $message, int $max = 2000): string
    {
        $trimmed = trim($message);
        if (strlen($trimmed) <= $max) {
            return $trimmed;
        }
        return substr($trimmed, 0, $max - 3) . '...';
    }

    /**
     * @param array<string,mixed> $rating
     */
    private function notifyHighImpactWebPush(array $rating): void
    {
        $impactLevel = strtolower(trim((string) ($rating['impact_level'] ?? '')));
        if ($impactLevel !== 'high') {
            return;
        }

        if (!$this->webPushSubscriptionRepository instanceof WebPushSubscriptionRepository) {
            return;
        }

        if (!$this->webPushService instanceof WebPushService || !$this->webPushService->isConfigured()) {
            return;
        }

        $subscriptions = $this->webPushSubscriptionRepository->listActive(1200);
        foreach ($subscriptions as $subscription) {
            $endpoint = trim((string) ($subscription['endpoint'] ?? ''));
            if ($endpoint === '') {
                continue;
            }

            $result = $this->webPushService->sendWakeup($endpoint, 240);
            if ($result['ok'] === true) {
                $this->webPushSubscriptionRepository->markDeliverySuccess($endpoint);
                continue;
            }

            $statusCode = (int) ($result['statusCode'] ?? 0);
            $deactivate = in_array($statusCode, [404, 410], true);
            $this->webPushSubscriptionRepository->markDeliveryFailure($endpoint, $deactivate);
        }
    }
}
