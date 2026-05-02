<?php
declare(strict_types=1);

namespace App\Http\Controller;

use App\Application\Service\CsFloatTradeSyncService;
use App\Infrastructure\Persistence\Repository\SyncStatusRepository;
use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Request;
use App\Shared\Logger;
use Throwable;

final class CsFloatSyncController
{
    public function __construct(
        private readonly CsFloatTradeSyncService $syncService,
        private readonly SyncStatusRepository $syncStatusRepository
    ) {
    }

    public function preview(Request $request): void
    {
        try {
            $limit = $this->readLimit($request);
            $type = $this->readType($request);
            $maxPages = $this->readMaxPages($request);

            $result = $this->syncService->preview(
                $this->resolveUserId($request),
                $limit,
                $type,
                $maxPages
            );

            Logger::event(
                'info',
                'domain',
                'domain.csfloat_trade_sync.preview.completed',
                'CSFloat trade sync preview completed',
                [
                    'type' => $type,
                    'limit' => $limit,
                    'maxPages' => $maxPages,
                    'rawCount' => (int) ($result['rawCount'] ?? 0),
                    'totalFetched' => (int) ($result['totalFetched'] ?? 0),
                    'insertable' => (int) ($result['insertable'] ?? 0),
                    'duplicates' => (int) ($result['duplicates'] ?? 0),
                    'skipped' => (int) ($result['skipped'] ?? 0),
                    'errorsCount' => is_array($result['errors'] ?? null) ? count($result['errors']) : 0,
                ]
            );

            JsonResponseFactory::success($result);
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'error',
                'error.http_5xx',
                'CSFloat trade sync preview failed',
                ['statusCode' => 500, 'exception' => $exception]
            );
            JsonResponseFactory::error('CSFLOAT_SYNC_PREVIEW_FAILED', $exception->getMessage(), [], 500);
        }
    }

    public function execute(Request $request): void
    {
        try {
            $limit = $this->readLimit($request);
            $type = $this->readType($request);
            $maxPages = $this->readMaxPages($request);
            $backupConfirmed = filter_var($request->body['backupConfirmed'] ?? false, FILTER_VALIDATE_BOOL);
            if (!$backupConfirmed) {
                Logger::event(
                    'warning',
                    'domain',
                    'domain.csfloat_trade_sync.execute.rejected_backup_required',
                    'CSFloat trade sync execute rejected because backup was not confirmed',
                    [
                        'type' => $type,
                        'limit' => $limit,
                        'maxPages' => $maxPages,
                    ]
                );

                JsonResponseFactory::error(
                    'CSFLOAT_SYNC_BACKUP_REQUIRED',
                    'Bitte bestaetige zuerst das Preview.',
                    ['backupConfirmed' => false],
                    400
                );
                return;
            }

            $result = $this->syncService->execute(
                $this->resolveUserId($request),
                $limit,
                $type,
                $maxPages
            );

            Logger::event(
                'info',
                'domain',
                'domain.csfloat_trade_sync.execute.completed',
                'CSFloat trade sync execute completed',
                [
                    'type' => $type,
                    'limit' => $limit,
                    'maxPages' => $maxPages,
                    'status' => (string) ($result['status'] ?? 'partial'),
                    'rawCount' => (int) ($result['rawCount'] ?? 0),
                    'totalFetched' => (int) ($result['totalFetched'] ?? 0),
                    'inserted' => (int) ($result['inserted'] ?? 0),
                    'duplicates' => (int) ($result['duplicates'] ?? 0),
                    'skipped' => (int) ($result['skipped'] ?? 0),
                    'errorsCount' => is_array($result['errors'] ?? null) ? count($result['errors']) : 0,
                ]
            );

            $this->syncStatusRepository->ensureTable();
            $this->syncStatusRepository->recordSync(
                $result['status'] ?? 'partial',
                (int) ($result['inserted'] ?? 0),
                (int) (count($result['errors'] ?? [])),
                0,
                $this->buildErrorMessage($result),
                null
            );

            JsonResponseFactory::success($result, [], 201);
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'error',
                'error.http_5xx',
                'CSFloat trade sync execute failed',
                ['statusCode' => 500, 'exception' => $exception]
            );
            JsonResponseFactory::error('CSFLOAT_SYNC_EXECUTE_FAILED', $exception->getMessage(), [], 500);
        }
    }

    private function readLimit(Request $request): int
    {
        $value = $request->body['limit'] ?? $request->query['limit'] ?? 1000;
        return min(max((int) $value, 1), 1000);
    }

    private function readMaxPages(Request $request): int
    {
        $value = $request->body['maxPages'] ?? $request->query['maxPages'] ?? 10;
        return min(max((int) $value, 1), 20);
    }

    private function readType(Request $request): ?string
    {
        $value = strtolower(trim((string) ($request->body['type'] ?? $request->query['type'] ?? 'buy')));
        if ($value === '' || $value === 'all') {
            return null;
        }

        return in_array($value, ['buy', 'sell'], true) ? $value : 'buy';
    }

    private function buildErrorMessage(array $result): ?string
    {
        $errors = $result['errors'] ?? [];
        if (!is_array($errors) || $errors === []) {
            return null;
        }

        return (string) ($errors[0]['message'] ?? 'CSFloat Sync teilweise fehlgeschlagen.');
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

