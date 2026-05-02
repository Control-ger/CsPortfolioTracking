<?php
declare(strict_types=1);

namespace App\Http\Controller;

use App\Infrastructure\Persistence\Repository\SyncStatusRepository;
use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Request;
use App\Shared\Logger;
use Throwable;

final class SyncStatusController
{
    public function __construct(private readonly SyncStatusRepository $syncStatusRepository)
    {
    }

    public function status(Request $request): void
    {
        try {
            $userId = $this->resolveUserId($request);
            $lastSync = $this->syncStatusRepository->getLastSync($userId);

            if ($lastSync === null) {
                JsonResponseFactory::success([
                    'lastSync' => null,
                    'status' => 'never',
                    'itemsSynced' => 0,
                    'itemsFailed' => 0,
                    'rateLimited' => 0,
                    'nextSync' => null,
                    'message' => 'No sync history found',
                ]);
                return;
            }

            // Calculate next sync time (hourly, so last sync + 1h)
            $lastSyncTime = strtotime($lastSync['sync_date']);
            $nextSyncTime = $lastSyncTime + 3600; // +1 hour
            $now = time();
            $nextSync = date('Y-m-d H:i:s', $nextSyncTime);
            $minutesUntilNext = ceil(($nextSyncTime - $now) / 60);

            JsonResponseFactory::success([
                'lastSync' => $lastSync['sync_date'],
                'status' => $lastSync['status'],
                'itemsSynced' => (int) $lastSync['items_synced'],
                'itemsFailed' => (int) $lastSync['items_failed'],
                'rateLimited' => (int) $lastSync['rate_limited'],
                'durationSeconds' => $lastSync['duration_seconds'],
                'errorMessage' => $lastSync['error_message'],
                'nextSync' => $nextSync,
                'minutesUntilNext' => max(0, $minutesUntilNext),
                'isHealthy' => $lastSync['status'] === 'success',
            ]);
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'error',
                'error.sync_status_failed',
                'Sync status request failed',
                ['statusCode' => 500, 'exception' => $exception]
            );
            JsonResponseFactory::error('SYNC_STATUS_FAILED', $exception->getMessage(), [], 500);
        }
    }

    public function history(Request $request): void
    {
        try {
            $limit = (int) ($request->queryParam('limit') ?? 10);
            $limit = min(max($limit, 1), 100); // Clamp between 1 and 100

            $syncs = $this->syncStatusRepository->getLatestSyncs($this->resolveUserId($request), $limit);

            JsonResponseFactory::success([
                'syncs' => $syncs,
                'count' => count($syncs),
            ]);
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'error',
                'error.sync_history_failed',
                'Sync history request failed',
                ['statusCode' => 500, 'exception' => $exception]
            );
            JsonResponseFactory::error('SYNC_HISTORY_FAILED', $exception->getMessage(), [], 500);
        }
    }

    public function stats(Request $request): void
    {
        try {
            $hoursBack = (int) ($request->queryParam('hoursBack') ?? 24);
            $hoursBack = min(max($hoursBack, 1), 1440); // Clamp between 1 and 1440 hours (60 days)

            $stats = $this->syncStatusRepository->getSyncStats($hoursBack);

            JsonResponseFactory::success([
                'hoursBack' => $hoursBack,
                'stats' => [
                    'totalSyncs' => (int) ($stats['total_syncs'] ?? 0),
                    'successfulSyncs' => (int) ($stats['successful_syncs'] ?? 0),
                    'failedSyncs' => (int) ($stats['failed_syncs'] ?? 0),
                    'partialSyncs' => (int) ($stats['partial_syncs'] ?? 0),
                    'totalItemsSynced' => (int) ($stats['total_items_synced'] ?? 0),
                    'totalItemsFailed' => (int) ($stats['total_items_failed'] ?? 0),
                    'avgDurationSeconds' => $stats['avg_duration_seconds'],
                ],
            ]);
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'error',
                'error.sync_stats_failed',
                'Sync stats request failed',
                ['statusCode' => 500, 'exception' => $exception]
            );
            JsonResponseFactory::error('SYNC_STATS_FAILED', $exception->getMessage(), [], 500);
        }
    }

    private function resolveUserId(Request $request): int
    {
        foreach (['x-user-id', 'user-id'] as $header) {
            if (isset($request->headers[$header]) && is_numeric($request->headers[$header])) {
                return max(1, (int) $request->headers[$header]);
            }
        }

        foreach (['userId', 'user_id'] as $key) {
            if (isset($request->body[$key]) && is_numeric($request->body[$key])) {
                return max(1, (int) $request->body[$key]);
            }
            if (isset($request->query[$key]) && is_numeric($request->query[$key])) {
                return max(1, (int) $request->query[$key]);
            }
        }

        return 1;
    }
}
