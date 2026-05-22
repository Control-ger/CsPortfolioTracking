<?php
declare(strict_types=1);

namespace App\Application\Service;

use App\Infrastructure\External\GeminiUpdateRaterClient;
use App\Infrastructure\Persistence\Repository\CsUpdatesFeedRepository;
use Throwable;

final class CsUpdatesAiRatingService
{
    public function __construct(
        private readonly CsUpdatesFeedRepository $repository,
        private readonly GeminiUpdateRaterClient $client
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
}

