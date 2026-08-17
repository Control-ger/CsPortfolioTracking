<?php
declare(strict_types=1);

namespace App\Http\Controller;

use App\Http\Auth\RequestUserScopeResolver;
use App\Application\Service\WatchlistService;
use App\Application\Service\SyncService;
use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Request;
use App\Shared\Http\UserScopeAuthorizationException;
use App\Shared\Logger;
use InvalidArgumentException;
use RuntimeException;
use Throwable;

final class WatchlistController
{
    public function __construct(
        private readonly WatchlistService $watchlistService,
        private readonly SyncService $syncService,
        private readonly RequestUserScopeResolver $userScopeResolver
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
                'readPath' => 'legacy',
            ];

            JsonResponseFactory::success(
                $items,
                $meta
            );
        } catch (UserScopeAuthorizationException $exception) {
            JsonResponseFactory::error($exception->getErrorCode(), $exception->getMessage(), $exception->getDetails(), $exception->getStatusCode());
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
            $minPriceEur = $this->parsePriceBound($request->query['minPriceEur'] ?? null, 'minPriceEur');
            $maxPriceEur = $this->parsePriceBound($request->query['maxPriceEur'] ?? null, 'maxPriceEur');

            // A search filter reacts to live typing, so a reversed range is
            // swapped instead of rejected — the user is mid-input, not wrong.
            if ($minPriceEur !== null && $maxPriceEur !== null && $minPriceEur > $maxPriceEur) {
                [$minPriceEur, $maxPriceEur] = [$maxPriceEur, $minPriceEur];
            }

            $results = $this->watchlistService->searchAvailableItems(
                $userId,
                $query,
                $limit,
                $itemType,
                $wear,
                $page,
                $sortBy,
                $minPriceEur,
                $maxPriceEur
            );
            JsonResponseFactory::success(
                $results,
                ['warnings' => $this->watchlistService->consumePricingWarnings()]
            );
        } catch (InvalidArgumentException $exception) {
            Logger::event(
                'warning',
                'error',
                'error.validation',
                'Watchlist search validation failed',
                ['statusCode' => 400, 'exception' => $exception]
            );
            JsonResponseFactory::error('WATCHLIST_SEARCH_INVALID', $exception->getMessage(), [], 400);
        } catch (UserScopeAuthorizationException $exception) {
            JsonResponseFactory::error($exception->getErrorCode(), $exception->getMessage(), $exception->getDetails(), $exception->getStatusCode());
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

    /**
     * Reads an optional EUR price bound from the query string.
     * An empty value means "no bound"; anything non-numeric or negative is a
     * client error rather than something to silently ignore.
     */
    private function parsePriceBound(mixed $raw, string $paramName): ?float
    {
        if ($raw === null || trim((string) $raw) === '') {
            return null;
        }

        if (!is_numeric($raw)) {
            throw new InvalidArgumentException(sprintf('%s must be a number.', $paramName));
        }

        $value = (float) $raw;
        if ($value < 0) {
            throw new InvalidArgumentException(sprintf('%s must not be negative.', $paramName));
        }

        return $value;
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
        } catch (UserScopeAuthorizationException $exception) {
            JsonResponseFactory::error($exception->getErrorCode(), $exception->getMessage(), $exception->getDetails(), $exception->getStatusCode());
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
            if (!$this->watchlistService->deleteItem($id, $userId)) {
                JsonResponseFactory::error('WATCHLIST_NOT_FOUND', 'Item nicht gefunden.', [], 404);
                return;
            }
            $this->syncService->deleteServerEntity($userId, 'watchlist_items', (string) $id);
            JsonResponseFactory::success(['deleted' => true], statusCode: 200);
        } catch (UserScopeAuthorizationException $exception) {
            JsonResponseFactory::error($exception->getErrorCode(), $exception->getMessage(), $exception->getDetails(), $exception->getStatusCode());
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
        } catch (UserScopeAuthorizationException $exception) {
            JsonResponseFactory::error($exception->getErrorCode(), $exception->getMessage(), $exception->getDetails(), $exception->getStatusCode());
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

    /**
     * Set or clear a watchlist item's target price.
     *
     * `alertPriceUsd: null` is a valid body — it clears the target. That is why
     * the field is only rejected when it is present *and* not a usable number,
     * rather than being required.
     */
    public function updateTarget(Request $request, int $id): void
    {
        try {
            $userId = $this->resolveUserId($request);

            $rawPrice = $request->body['alertPriceUsd'] ?? null;
            if ($rawPrice !== null && (!is_numeric($rawPrice) || (float) $rawPrice <= 0)) {
                JsonResponseFactory::error(
                    'INVALID_TARGET_PRICE',
                    'alertPriceUsd muss eine positive Zahl oder null sein.',
                    [],
                    400
                );
                return;
            }

            $rawAnchor = $request->body['alertAnchorPriceUsd'] ?? null;
            if ($rawAnchor !== null && !is_numeric($rawAnchor)) {
                JsonResponseFactory::error(
                    'INVALID_TARGET_PRICE',
                    'alertAnchorPriceUsd muss eine Zahl oder null sein.',
                    [],
                    400
                );
                return;
            }

            $syncPayload = $this->watchlistService->updateTarget(
                $userId,
                $id,
                $rawPrice !== null ? (float) $rawPrice : null,
                isset($request->body['alertDirection']) ? (string) $request->body['alertDirection'] : null,
                $rawAnchor !== null ? (float) $rawAnchor : null
            );

            // Publish to sync so desktop clients pick the target up on their next
            // pull instead of only seeing it on the web.
            $this->syncService->upsertServerEntity(
                $userId,
                'watchlist_items',
                (string) $id,
                $syncPayload
            );

            JsonResponseFactory::success($syncPayload, [], 200);
        } catch (UserScopeAuthorizationException $exception) {
            JsonResponseFactory::error($exception->getErrorCode(), $exception->getMessage(), $exception->getDetails(), $exception->getStatusCode());
        } catch (RuntimeException $exception) {
            JsonResponseFactory::error('WATCHLIST_NOT_FOUND', 'Item nicht gefunden.', [], 404);
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'error',
                'error.http_5xx',
                'Watchlist target update failed',
                ['statusCode' => 500, 'exception' => $exception]
            );
            JsonResponseFactory::error('WATCHLIST_TARGET_UPDATE_FAILED', $exception->getMessage(), [], 500);
        }
    }

    private function resolveUserId(Request $request): int
    {
        return $this->userScopeResolver->resolve($request);
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
        } catch (UserScopeAuthorizationException $exception) {
            JsonResponseFactory::error($exception->getErrorCode(), $exception->getMessage(), $exception->getDetails(), $exception->getStatusCode());
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
}
