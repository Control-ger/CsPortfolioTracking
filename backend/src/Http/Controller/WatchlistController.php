<?php
declare(strict_types=1);

namespace App\Http\Controller;

use App\Application\Service\ScalingShadowReadService;
use App\Application\Service\WatchlistService;
use App\Application\Service\SyncService;
use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Request;
use App\Shared\Logger;
use InvalidArgumentException;
use RuntimeException;
use Throwable;

final class WatchlistController
{
    public function __construct(
        private readonly WatchlistService $watchlistService,
        private readonly SyncService $syncService,
        private readonly ?ScalingShadowReadService $scalingShadowReadService = null
    )
    {
    }

    public function list(Request $request): void
    {
        try {
            $userId = $this->resolveUserId($request);
            $syncLive = filter_var($request->query['syncLive'] ?? false, FILTER_VALIDATE_BOOL);
            $items = $this->watchlistService->listWithMetrics($userId, $syncLive);
            $meta = [
                'warnings' => $this->watchlistService->consumePricingWarnings(),
                'readPath' => $this->primaryScalingReadEnabled() ? 'scaling_primary' : 'legacy',
            ];

            if ($this->shadowReadEnabled() && $this->scalingShadowReadService !== null) {
                $shadow = $this->scalingShadowReadService->buildWatchlistStats($userId);
                $meta['shadowRead'] = [
                    'enabled' => true,
                    'totalItems' => (int) ($shadow['totalItems'] ?? 0),
                    'pricedItems' => (int) ($shadow['pricedItems'] ?? 0),
                ];
            }

            JsonResponseFactory::success(
                $items,
                $meta
            );
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'error',
                'error.http_5xx',
                'Watchlist list request failed',
                ['statusCode' => 500, 'exception' => $exception]
            );
            JsonResponseFactory::error('WATCHLIST_LIST_FAILED', $exception->getMessage(), [], 500);
        }
    }

    public function search(Request $request): void
    {
        try {
            $userId = $this->resolveUserId($request);
            $query = (string) ($request->query['query'] ?? '');
            $limit = (int) ($request->query['limit'] ?? 6);
            $page = (int) ($request->query['page'] ?? 1);
            $itemType = (string) ($request->query['itemType'] ?? '');
            $wear = (string) ($request->query['wear'] ?? '');
            $sortBy = (string) ($request->query['sortBy'] ?? '');

            $results = $this->watchlistService->searchAvailableItems($userId, $query, $limit, $itemType, $wear, $page, $sortBy);
            JsonResponseFactory::success(
                $results,
                ['warnings' => $this->watchlistService->consumePricingWarnings()]
            );
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'error',
                'error.http_5xx',
                'Watchlist search request failed',
                ['statusCode' => 500, 'exception' => $exception]
            );
            JsonResponseFactory::error('WATCHLIST_SEARCH_FAILED', $exception->getMessage(), [], 500);
        }
    }

    public function create(Request $request): void
    {
        try {
            $userId = $this->resolveUserId($request);
            $name = (string) ($request->body['name'] ?? '');
            $type = (string) ($request->body['type'] ?? 'skin');
            $created = $this->watchlistService->addItem($userId, $name, $type);
            $syncPayload = [
                'id' => (string) ($created['id'] ?? ''),
                'userId' => (string) $userId,
                'name' => (string) ($created['name'] ?? $name),
                'marketHashName' => (string) ($created['name'] ?? $name),
                'type' => (string) ($created['type'] ?? $type),
                'imageUrl' => isset($created['imageUrl']) ? (string) $created['imageUrl'] : null,
                'itemId' => isset($created['itemId']) ? (string) $created['itemId'] : null,
                'serverId' => isset($created['id']) ? (int) $created['id'] : null,
                'createdAt' => $created['createdAt'] ?? gmdate('c'),
                'updatedAt' => $created['updatedAt'] ?? gmdate('c'),
            ];
            $this->syncService->upsertServerEntity(
                $userId,
                'watchlist_items',
                (string) ($created['id'] ?? ''),
                $syncPayload
            );
            JsonResponseFactory::success(
                $created,
                ['warnings' => $this->watchlistService->consumePricingWarnings()],
                201
            );
        } catch (RuntimeException $exception) {
            Logger::event(
                'warning',
                'error',
                'error.conflict',
                'Watchlist conflict',
                ['statusCode' => 409, 'exception' => $exception]
            );
            JsonResponseFactory::error('WATCHLIST_CONFLICT', $exception->getMessage(), [], 409);
        } catch (InvalidArgumentException $exception) {
            Logger::event(
                'warning',
                'error',
                'error.validation',
                'Watchlist validation failed',
                ['statusCode' => 400, 'exception' => $exception]
            );
            JsonResponseFactory::error('WATCHLIST_CREATE_FAILED', $exception->getMessage(), [], 400);
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'error',
                'error.http_5xx',
                'Watchlist create request failed',
                ['statusCode' => 500, 'exception' => $exception]
            );
            JsonResponseFactory::error('WATCHLIST_CREATE_FAILED', $exception->getMessage(), [], 500);
        }
    }

    public function delete(Request $request, int $id): void
    {
        try {
            $userId = $this->resolveUserId($request);
            if (!$this->watchlistService->deleteItem($id)) {
                JsonResponseFactory::error('WATCHLIST_NOT_FOUND', 'Item nicht gefunden.', [], 404);
                return;
            }
            $this->syncService->deleteServerEntity($userId, 'watchlist_items', (string) $id);
            JsonResponseFactory::success(['deleted' => true], statusCode: 200);
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'error',
                'error.http_5xx',
                'Watchlist delete request failed',
                ['statusCode' => 500, 'exception' => $exception]
            );
            JsonResponseFactory::error('WATCHLIST_DELETE_FAILED', $exception->getMessage(), [], 500);
        }
    }

    public function refresh(Request $request): void
    {
        try {
            JsonResponseFactory::success(
                $this->watchlistService->refreshPrices($this->resolveUserId($request)),
                ['warnings' => $this->watchlistService->consumePricingWarnings()]
            );
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'error',
                'error.http_5xx',
                'Watchlist refresh request failed',
                ['statusCode' => 500, 'exception' => $exception]
            );
            JsonResponseFactory::error('WATCHLIST_REFRESH_FAILED', $exception->getMessage(), [], 500);
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

    public function createBatch(Request $request): void
    {
        try {
            $userId = $this->resolveUserId($request);
            $items = $request->body['items'] ?? [];
            if (!is_array($items)) {
                JsonResponseFactory::error('WATCHLIST_BATCH_INVALID', 'items muss ein Array sein.', [], 400);
                return;
            }

            $result = $this->watchlistService->addItemsBatch($userId, $items);
            foreach ($result['created'] as $created) {
                $syncPayload = [
                    'id' => (string) ($created['id'] ?? ''),
                    'userId' => (string) $userId,
                    'name' => (string) ($created['name'] ?? ''),
                    'marketHashName' => (string) ($created['name'] ?? ''),
                    'type' => (string) ($created['type'] ?? 'skin'),
                    'imageUrl' => isset($created['imageUrl']) ? (string) $created['imageUrl'] : null,
                    'itemId' => isset($created['itemId']) ? (string) $created['itemId'] : null,
                    'serverId' => isset($created['id']) ? (int) $created['id'] : null,
                    'createdAt' => $created['createdAt'] ?? gmdate('c'),
                    'updatedAt' => $created['updatedAt'] ?? gmdate('c'),
                ];
                $this->syncService->upsertServerEntity(
                    $userId,
                    'watchlist_items',
                    (string) ($created['id'] ?? ''),
                    $syncPayload
                );
            }

            JsonResponseFactory::success(
                $result,
                ['warnings' => $this->watchlistService->consumePricingWarnings()],
                200
            );
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'error',
                'error.http_5xx',
                'Watchlist batch create request failed',
                ['statusCode' => 500, 'exception' => $exception]
            );
            JsonResponseFactory::error('WATCHLIST_BATCH_CREATE_FAILED', $exception->getMessage(), [], 500);
        }
    }

    private function shadowReadEnabled(): bool
    {
        $value = getenv('SCALING_SHADOW_READ_ENABLED');
        if ($value === false || $value === null) {
            return false;
        }

        return in_array(strtolower(trim((string) $value)), ['1', 'true', 'yes', 'on'], true);
    }

    private function primaryScalingReadEnabled(): bool
    {
        $value = getenv('SCALING_PRIMARY_READ_ENABLED');
        if ($value === false || $value === null) {
            return false;
        }

        return in_array(strtolower(trim((string) $value)), ['1', 'true', 'yes', 'on'], true);
    }
}
