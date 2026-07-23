<?php
declare(strict_types=1);

namespace App\Application\Service;

use App\Infrastructure\External\GeminiUpdateRaterClient;
use App\Infrastructure\Persistence\Repository\CsUpdatesFeedRepository;
use App\Infrastructure\Persistence\Repository\UserNotificationPreferenceRepository;
use App\Infrastructure\Persistence\Repository\WebPushSubscriptionRepository;
use Throwable;

final class CsUpdatesAiRatingService
{
    public function __construct(
        private readonly CsUpdatesFeedRepository $repository,
        private readonly GeminiUpdateRaterClient $client,
        private readonly ?WebPushSubscriptionRepository $webPushSubscriptionRepository = null,
        private readonly ?WebPushService $webPushService = null,
        private readonly ?UserNotificationPreferenceRepository $notificationPreferenceRepository = null
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

        $banWaveContext = $this->buildBanWaveContext();

        foreach ($rows as $row) {
            $id = (int) ($row['id'] ?? 0);
            if ($id <= 0) {
                continue;
            }

            try {
                if (($row['source'] ?? '') === 'ban_wave_detected') {
                    $rating = $this->autoRateBanWave($row);
                } else {
                    $rating = $this->client->classify($row, $banWaveContext);
                }
                $this->repository->saveAiRating($id, $rating);
                $this->notifyWebPushSubscribers($rating);
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

    /**
     * @param array<string,mixed> $row
     * @return array<string,mixed>
     */
    private function autoRateBanWave(array $row): array
    {
        $summary = (string) ($row['summary_raw'] ?? '');

        $ratio = 2.5;
        if (preg_match('/\((\d+)%\s+des\s+Medians/', $summary, $m)) {
            $ratio = (float) $m[1] / 100.0;
        } elseif (preg_match('/\((\d+[,.]\d*)x\s+ueber\s+dem\s+Median/', $summary, $m)) {
            $ratio = (float) str_replace(',', '.', $m[1]);
        }

        $isHigh = $ratio >= 4.0;
        $impactLevel = $isHigh ? 'high' : 'medium';
        $impactScore = $isHigh
            ? max(70, min(90, (int) round(70 + ($ratio - 4.0) * 5)))
            : max(50, min(70, (int) round(50 + ($ratio - 2.5) * 13)));
        $urgency = $isHigh ? 'today' : 'observe';

        $confidence = 'medium';
        if (str_contains($summary, 'Korroboriert durch')) {
            $confidence = 'high';
        } elseif (str_contains($summary, 'Alle-Steam-Daten')) {
            $confidence = 'low';
        }

        return [
            'impact_level' => $impactLevel,
            'impact_score' => $impactScore,
            'urgency' => $urgency,
            'recommended_action' => $isHigh
                ? 'WATCH Cases und Entry-Level Skins — grosse Ban-Welle.'
                : 'Cases und guenstige Skins beobachten.',
            'confidence' => $confidence,
            'reasoning' => 'Automatisch bewertet basierend auf Ban-Wellen-Schwellenwert und Quellen-Korroboration.',
            'model' => 'auto',
        ];
    }

    private function buildBanWaveContext(): string
    {
        try {
            $waves = $this->repository->findRecentBanWaves(14);
        } catch (Throwable) {
            return '';
        }

        if ($waves === []) {
            return '';
        }

        $now = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
        $lines = [];
        foreach ($waves as $wave) {
            $published = trim((string) ($wave['published_at'] ?? ''));
            if ($published === '') {
                continue;
            }
            try {
                $dt = new \DateTimeImmutable($published, new \DateTimeZone('UTC'));
            } catch (\Throwable) {
                continue;
            }
            $daysAgo = (int) $now->diff($dt)->days;
            $label = match (true) {
                $daysAgo === 0 => 'heute',
                $daysAgo === 1 => 'vor 1 Tag',
                default => "vor {$daysAgo} Tagen",
            };
            $title = trim((string) ($wave['title'] ?? ''));
            $lines[] = "- {$label}: {$title}";
        }

        return $lines !== [] ? implode("\n", $lines) : '';
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
     * Wakes web-push subscribers for a freshly-rated CS update, honouring each
     * user's per-user preference (on/off + minimum impact level). This is the
     * single authoritative web-push send site: it runs only once the AI impact
     * rating is known, so the min-level filter can actually be applied.
     *
     * @param array<string,mixed> $rating
     */
    private function notifyWebPushSubscribers(array $rating): void
    {
        $impactIndex = UserNotificationPreferenceRepository::impactIndex(
            $rating['impact_level'] ?? null
        );
        if ($impactIndex < 0) {
            return; // Unrated / unknown impact — nothing to threshold against.
        }

        if (!$this->webPushSubscriptionRepository instanceof WebPushSubscriptionRepository) {
            return;
        }

        if (!$this->webPushService instanceof WebPushService || !$this->webPushService->isConfigured()) {
            return;
        }

        $subscriptions = $this->webPushSubscriptionRepository->listActive(1200);
        $eligibilityByUser = [];

        foreach ($subscriptions as $subscription) {
            $endpoint = trim((string) ($subscription['endpoint'] ?? ''));
            if ($endpoint === '') {
                continue;
            }

            $userId = (int) ($subscription['user_id'] ?? 0);
            if (!array_key_exists($userId, $eligibilityByUser)) {
                $eligibilityByUser[$userId] = $this->isUserEligibleForCsUpdate($userId, $impactIndex);
            }
            if ($eligibilityByUser[$userId] !== true) {
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

    private function isUserEligibleForCsUpdate(int $userId, int $impactIndex): bool
    {
        // No preference repo wired (e.g. legacy call sites): fall back to the
        // historical "high impact wakes everyone" behaviour so nobody is lost.
        if (!$this->notificationPreferenceRepository instanceof UserNotificationPreferenceRepository) {
            return $impactIndex >= UserNotificationPreferenceRepository::impactIndex('high');
        }

        $pref = $this->notificationPreferenceRepository->getByUserId($userId);
        if (($pref['notifyCsUpdatesWebPush'] ?? false) !== true) {
            return false;
        }

        $minIndex = UserNotificationPreferenceRepository::impactIndex(
            $pref['notifyCsUpdatesWebPushMinLevel'] ?? 'high'
        );

        return $impactIndex >= $minIndex;
    }
}
