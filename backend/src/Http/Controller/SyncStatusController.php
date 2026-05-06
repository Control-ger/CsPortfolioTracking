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
            $source = (string) ($request->queryParam('source') ?? 'hourly-price-sync');
            $lastSync = $this->syncStatusRepository->getLastSync($userId, $source);

            if ($lastSync === null) {
                JsonResponseFactory::success([
                    'lastSync' => null,
                    'source' => $source,
                    'status' => 'never',
                    'nextSync' => null,
                    'message' => 'No sync history found',
                ]);
                return;
            }

            // Calculate next sync time (hourly, so last sync + 1h)
            $lastSyncRaw = (string) ($lastSync['last_sync_at'] ?? '');
            $lastSyncTime = strtotime($lastSyncRaw);
            if ($lastSyncTime === false) {
                $lastSyncTime = time();
            }
            $nextSyncTime = $lastSyncTime + 3600;
            $now = time();
            $nextSync = date('Y-m-d H:i:s', $nextSyncTime);
            $minutesUntilNext = ceil(($nextSyncTime - $now) / 60);

            JsonResponseFactory::success([
                'source' => (string) ($lastSync['source'] ?? $source),
                'lastSync' => $lastSyncRaw !== '' ? $lastSyncRaw : null,
                'status' => $lastSync['status'],
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
            // sync_status stores latest state per source/user, not a full event history.
            // Expose a compact source-level health snapshot from current rows.
            $rows = $this->syncStatusRepository->getLatestSyncs($this->resolveUserId($request), 100);
            $success = 0;
            $failed = 0;
            $partial = 0;

            foreach ($rows as $row) {
                $state = (string) ($row['status'] ?? '');
                if ($state === 'success') {
                    $success++;
                } elseif ($state === 'failed') {
                    $failed++;
                } elseif ($state === 'partial') {
                    $partial++;
                }
            }

            JsonResponseFactory::success([
                'stats' => [
                    'trackedSources' => count($rows),
                    'successfulSources' => $success,
                    'failedSources' => $failed,
                    'partialSources' => $partial,
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
