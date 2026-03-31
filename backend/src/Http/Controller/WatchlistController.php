<?php
declare(strict_types=1);

namespace App\Http\Controller;

use App\Application\Service\WatchlistService;
use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Request;
use RuntimeException;
use Throwable;

final class WatchlistController
{
    public function __construct(private readonly WatchlistService $watchlistService)
    {
    }

    public function list(Request $request): void
    {
        try {
            $syncLive = filter_var($request->query['syncLive'] ?? false, FILTER_VALIDATE_BOOL);
            JsonResponseFactory::success($this->watchlistService->listWithMetrics($syncLive));
        } catch (Throwable $exception) {
            JsonResponseFactory::error('WATCHLIST_LIST_FAILED', $exception->getMessage(), [], 500);
        }
    }

    public function search(Request $request): void
    {
        try {
            $query = (string) ($request->query['query'] ?? '');
            $limit = (int) ($request->query['limit'] ?? 6);
            $itemType = (string) ($request->query['itemType'] ?? '');
            $wear = (string) ($request->query['wear'] ?? '');

            JsonResponseFactory::success(
                $this->watchlistService->searchAvailableItems($query, $limit, $itemType, $wear)
            );
        } catch (Throwable $exception) {
            JsonResponseFactory::error('WATCHLIST_SEARCH_FAILED', $exception->getMessage(), [], 500);
        }
    }

    public function create(Request $request): void
    {
        try {
            $name = (string) ($request->body['name'] ?? '');
            $type = (string) ($request->body['type'] ?? 'skin');
            JsonResponseFactory::success($this->watchlistService->addItem($name, $type), statusCode: 201);
        } catch (RuntimeException $exception) {
            JsonResponseFactory::error('WATCHLIST_CONFLICT', $exception->getMessage(), [], 409);
        } catch (Throwable $exception) {
            JsonResponseFactory::error('WATCHLIST_CREATE_FAILED', $exception->getMessage(), [], 400);
        }
    }

    public function delete(Request $request, int $id): void
    {
        try {
            if (!$this->watchlistService->deleteItem($id)) {
                JsonResponseFactory::error('WATCHLIST_NOT_FOUND', 'Item nicht gefunden.', [], 404);
                return;
            }
            JsonResponseFactory::success(['deleted' => true], statusCode: 200);
        } catch (Throwable $exception) {
            JsonResponseFactory::error('WATCHLIST_DELETE_FAILED', $exception->getMessage(), [], 500);
        }
    }

    public function refresh(Request $request): void
    {
        try {
            JsonResponseFactory::success($this->watchlistService->refreshPrices());
        } catch (Throwable $exception) {
            JsonResponseFactory::error('WATCHLIST_REFRESH_FAILED', $exception->getMessage(), [], 500);
        }
    }
}
