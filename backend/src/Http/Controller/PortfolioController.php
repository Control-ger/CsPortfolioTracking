<?php
declare(strict_types=1);

namespace App\Http\Controller;

use App\Http\Auth\RequestUserScopeResolver;
use App\Application\Service\PortfolioService;
use App\Application\Service\ScalingShadowReadService;
use App\Application\Service\SyncService;
use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Request;
use App\Shared\Http\UserScopeAuthorizationException;
use App\Shared\Logger;
use Throwable;

final class PortfolioController
{
    public function __construct(
        private readonly PortfolioService $portfolioService,
        private readonly SyncService $syncService,
        private readonly ?ScalingShadowReadService $scalingShadowReadService = null,
        private readonly ?RequestUserScopeResolver $userScopeResolver = null
    ) {
    }

    public function investments(Request $request): void
    {
        try {
            $userId = $this->resolveUserId($request);
            $scope = $this->resolveScope($request);
            $rows = $this->portfolioService->getEnrichedInvestments($userId, true, $scope);
            JsonResponseFactory::success(
                $rows,
                [
                    'warnings' => $this->portfolioService->consumePricingWarnings(),
                    'scope' => $scope,
                    'readPath' => $this->primaryScalingReadEnabled() ? 'scaling_primary' : 'legacy',
                ]
            );
        } catch (UserScopeAuthorizationException $exception) {
            JsonResponseFactory::error($exception->getErrorCode(), $exception->getMessage(), $exception->getDetails(), $exception->getStatusCode());
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'error',
                'error.http_5xx',
                'Portfolio investments request failed',
                ['statusCode' => 500, 'exception' => $exception]
            );
            JsonResponseFactory::error('PORTFOLIO_INVESTMENTS_FAILED', $exception->getMessage(), [], 500);
        }
    }

    public function summary(Request $request): void
    {
        try {
            $userId = $this->resolveUserId($request);
            $scope = $this->resolveScope($request);
            $usePrimaryScalingRead = $scope === 'all'
                && $this->primaryScalingReadEnabled()
                && $this->scalingShadowReadService !== null;
            $summary = [];
            $meta = ['warnings' => []];

            if ($usePrimaryScalingRead) {
                $scaled = $this->scalingShadowReadService->buildPortfolioSummary($userId);
                $totalValue = (float) ($scaled['totalValue'] ?? 0.0);
                $totalInvested = (float) ($scaled['totalInvested'] ?? 0.0);
                $totalProfitEuro = $totalValue - $totalInvested;
                $summary = [
                    'totalValue' => $totalValue,
                    'totalInvested' => $totalInvested,
                    'totalQuantity' => (int) ($scaled['totalQuantity'] ?? 0),
                    'totalProfitEuro' => $totalProfitEuro,
                    'totalRoiPercent' => $totalInvested > 0 ? ($totalProfitEuro / $totalInvested) * 100 : 0.0,
                    'totalNetValue' => $totalValue,
                    'totalNetProfitEuro' => $totalProfitEuro,
                    'totalNetRoiPercent' => $totalInvested > 0 ? ($totalProfitEuro / $totalInvested) * 100 : 0.0,
                    'isPositive' => $totalProfitEuro >= 0,
                    'chartColor' => $totalProfitEuro >= 0 ? '#22c55e' : '#ef4444',
                    'liveItemsCount' => (int) ($scaled['pricedPositions'] ?? 0),
                    'staleLiveItemsCount' => 0,
                    'staleLiveItemsRatioPercent' => 0.0,
                    'freshestDataAgeSeconds' => null,
                    'oldestDataAgeSeconds' => null,
                ];
                $meta['readPath'] = 'scaling_primary';
            } else {
                $rows = $this->portfolioService->getEnrichedInvestments(
                    $userId,
                    false,
                    $scope,
                    false
                );
                $summary = $this->portfolioService->getSummary($rows)->toArray();
                $meta = ['warnings' => $this->portfolioService->consumePricingWarnings()];
                $meta['readPath'] = 'legacy';
            }
            $meta['scope'] = $scope;

            if ($this->shadowReadEnabled() && $this->scalingShadowReadService !== null) {
                $shadow = $this->scalingShadowReadService->buildPortfolioSummary($userId);
                $delta = abs(((float) ($summary['totalValue'] ?? 0.0)) - ((float) ($shadow['totalValue'] ?? 0.0)));
                $meta['shadowRead'] = [
                    'enabled' => true,
                    'totalValueDelta' => round($delta, 2),
                    'positions' => (int) ($shadow['positions'] ?? 0),
                ];

                if ($delta > 0.5) {
                    Logger::event(
                        'warning',
                        'domain',
                        'domain.shadow_read.portfolio_summary_mismatch',
                        'Portfolio summary mismatch between legacy and scalable shadow read',
                        [
                            'userId' => $userId,
                            'legacyTotalValue' => (float) ($summary['totalValue'] ?? 0.0),
                            'shadowTotalValue' => (float) ($shadow['totalValue'] ?? 0.0),
                            'delta' => round($delta, 2),
                        ]
                    );
                }
            }

            JsonResponseFactory::success(
                $summary,
                $meta
            );
        } catch (UserScopeAuthorizationException $exception) {
            JsonResponseFactory::error($exception->getErrorCode(), $exception->getMessage(), $exception->getDetails(), $exception->getStatusCode());
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'error',
                'error.http_5xx',
                'Portfolio summary request failed',
                ['statusCode' => 500, 'exception' => $exception]
            );
            JsonResponseFactory::error('PORTFOLIO_SUMMARY_FAILED', $exception->getMessage(), [], 500);
        }
    }

    public function history(Request $request): void
    {
        try {
            JsonResponseFactory::success($this->portfolioService->getHistory($this->resolveUserId($request)));
        } catch (UserScopeAuthorizationException $exception) {
            JsonResponseFactory::error($exception->getErrorCode(), $exception->getMessage(), $exception->getDetails(), $exception->getStatusCode());
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'error',
                'error.http_5xx',
                'Portfolio history request failed',
                ['statusCode' => 500, 'exception' => $exception]
            );
            JsonResponseFactory::error('PORTFOLIO_HISTORY_FAILED', $exception->getMessage(), [], 500);
        }
    }

    public function investmentHistory(Request $request, int $id): void
    {
        try {
            JsonResponseFactory::success($this->portfolioService->getInvestmentHistory($this->resolveUserId($request), $id));
        } catch (UserScopeAuthorizationException $exception) {
            JsonResponseFactory::error($exception->getErrorCode(), $exception->getMessage(), $exception->getDetails(), $exception->getStatusCode());
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'error',
                'error.http_5xx',
                'Portfolio position history request failed',
                ['statusCode' => 500, 'exception' => $exception]
            );
            JsonResponseFactory::error('PORTFOLIO_POSITION_HISTORY_FAILED', $exception->getMessage(), [], 500);
        }
    }

    public function itemPriceHistory(Request $request, int $id): void
    {
        try {
            $fromDate = null;
            if (isset($request->query['fromDate']) && is_string($request->query['fromDate'])) {
                $fromDate = (string) $request->query['fromDate'];
            }
            // userId currently unused, but keep resolution consistent with other endpoints.
            $this->resolveUserId($request);
            JsonResponseFactory::success($this->portfolioService->getItemPriceHistory($id, $fromDate));
        } catch (UserScopeAuthorizationException $exception) {
            JsonResponseFactory::error($exception->getErrorCode(), $exception->getMessage(), $exception->getDetails(), $exception->getStatusCode());
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'error',
                'error.http_5xx',
                'Item price history request failed',
                ['statusCode' => 500, 'itemId' => $id, 'exception' => $exception]
            );
            JsonResponseFactory::error('ITEM_PRICE_HISTORY_FAILED', $exception->getMessage(), [], 500);
        }
    }

    public function saveDailyValue(Request $request): void
    {
        try {
            $inputValue = $request->body['totalValue'] ?? $request->body['total_value'] ?? null;
            $value = is_numeric($inputValue) ? (float) $inputValue : null;
            JsonResponseFactory::success(
                $this->portfolioService->saveDailyValue($this->resolveUserId($request), $value),
                ['warnings' => $this->portfolioService->consumePricingWarnings()],
                200
            );
        } catch (UserScopeAuthorizationException $exception) {
            JsonResponseFactory::error($exception->getErrorCode(), $exception->getMessage(), $exception->getDetails(), $exception->getStatusCode());
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'error',
                'error.http_5xx',
                'Portfolio save daily value request failed',
                ['statusCode' => 500, 'exception' => $exception]
            );
            JsonResponseFactory::error('PORTFOLIO_SAVE_FAILED', $exception->getMessage(), [], 500);
        }
    }

    public function composition(Request $request): void
    {
        try {
            $scope = $this->resolveScope($request);
            JsonResponseFactory::success(
                $this->portfolioService->getComposition($this->resolveUserId($request), $scope),
                ['scope' => $scope]
            );
        } catch (UserScopeAuthorizationException $exception) {
            JsonResponseFactory::error($exception->getErrorCode(), $exception->getMessage(), $exception->getDetails(), $exception->getStatusCode());
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'error',
                'error.http_5xx',
                'Portfolio composition request failed',
                ['statusCode' => 500, 'exception' => $exception]
            );
            JsonResponseFactory::error('PORTFOLIO_COMPOSITION_FAILED', $exception->getMessage(), [], 500);
        }
    }

    public function refreshStalePrices(Request $request): void
    {
        try {
            $userId = $this->resolveUserId($request);
            $scope = $this->resolveScope($request);
            $limitInput = $request->body['limit'] ?? $request->query['limit'] ?? null;
            $limit = is_numeric($limitInput) ? (int) $limitInput : 200;

            JsonResponseFactory::success(
                $this->portfolioService->refreshStalePrices($userId, $scope, $limit),
                ['warnings' => $this->portfolioService->consumePricingWarnings()],
                200
            );
        } catch (UserScopeAuthorizationException $exception) {
            JsonResponseFactory::error($exception->getErrorCode(), $exception->getMessage(), $exception->getDetails(), $exception->getStatusCode());
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'error',
                'error.http_5xx',
                'Portfolio stale price refresh request failed',
                ['statusCode' => 500, 'exception' => $exception]
            );
            JsonResponseFactory::error('PORTFOLIO_REFRESH_STALE_FAILED', $exception->getMessage(), [], 500);
        }
    }

    public function toggleExcludeInvestment(Request $request, int $id): void
    {
        try {
            $userId = $this->resolveUserId($request);
            $exclude = filter_var($request->body['exclude'] ?? false, FILTER_VALIDATE_BOOL);
            $success = $this->portfolioService->toggleExcludeInvestment($userId, $id, $exclude);

            if (!$success) {
                JsonResponseFactory::error(
                    'INVESTMENT_NOT_FOUND',
                    'Investition mit dieser ID nicht gefunden.',
                    ['id' => $id],
                    404
                );
                return;
            }

            Logger::event(
                'info',
                'domain',
                'domain.portfolio.investment_exclude_toggled',
                'Investment exclude flag toggled',
                ['investmentId' => $id, 'exclude' => $exclude]
            );

            $syncPayload = $this->portfolioService->buildInvestmentSyncPayload($userId, $id, $exclude, null);
            if (is_array($syncPayload)) {
                $this->syncService->upsertServerEntity(
                    $userId,
                    'investments',
                    (string) $id,
                    $syncPayload
                );
            }

            JsonResponseFactory::success(
                ['success' => true, 'investmentId' => $id, 'excluded' => $exclude],
                [],
                200
            );
        } catch (UserScopeAuthorizationException $exception) {
            JsonResponseFactory::error($exception->getErrorCode(), $exception->getMessage(), $exception->getDetails(), $exception->getStatusCode());
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'error',
                'error.http_5xx',
                'Portfolio toggle exclude investment failed',
                ['statusCode' => 500, 'investmentId' => $id, 'exception' => $exception]
            );
            JsonResponseFactory::error('PORTFOLIO_TOGGLE_EXCLUDE_FAILED', $exception->getMessage(), [], 500);
        }
    }

    public function updateInvestmentBucket(Request $request, int $id): void
    {
        try {
            $userId = $this->resolveUserId($request);
            $bucket = strtolower(trim((string) ($request->body['bucket'] ?? 'investment')));
            if (!in_array($bucket, ['investment', 'inventory'], true)) {
                JsonResponseFactory::error(
                    'INVALID_BUCKET',
                    'Bucket muss investment oder inventory sein.',
                    ['bucket' => $bucket],
                    400
                );
                return;
            }

            $success = $this->portfolioService->updateInvestmentBucket($userId, $id, $bucket);
            if (!$success) {
                JsonResponseFactory::error(
                    'INVESTMENT_NOT_FOUND',
                    'Investition mit dieser ID nicht gefunden.',
                    ['id' => $id],
                    404
                );
                return;
            }

            $syncPayload = $this->portfolioService->buildInvestmentSyncPayload($userId, $id, null, $bucket);
            if (is_array($syncPayload)) {
                $this->syncService->upsertServerEntity(
                    $userId,
                    'investments',
                    (string) $id,
                    $syncPayload
                );
            }

            JsonResponseFactory::success(
                ['success' => true, 'investmentId' => $id, 'bucket' => $bucket],
                [],
                200
            );
        } catch (UserScopeAuthorizationException $exception) {
            JsonResponseFactory::error($exception->getErrorCode(), $exception->getMessage(), $exception->getDetails(), $exception->getStatusCode());
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'error',
                'error.http_5xx',
                'Portfolio update investment bucket failed',
                ['statusCode' => 500, 'investmentId' => $id, 'exception' => $exception]
            );
            JsonResponseFactory::error('PORTFOLIO_UPDATE_BUCKET_FAILED', $exception->getMessage(), [], 500);
        }
    }

    public function updateInvestmentOverpay(Request $request, int $id): void
    {
        try {
            $userId = $this->resolveUserId($request);
            $overpayEnabled = filter_var(
                $request->body['overpayEnabled'] ?? $request->body['isOverpayCandidate'] ?? false,
                FILTER_VALIDATE_BOOL
            );
            $overpayFloorInput = $request->body['overpayFloorEur'] ?? null;
            $overpayFloorEur = null;
            if ($overpayFloorInput !== null && $overpayFloorInput !== '') {
                if (!is_numeric($overpayFloorInput)) {
                    JsonResponseFactory::error(
                        'INVALID_OVERPAY_FLOOR',
                        'overpayFloorEur muss numerisch sein.',
                        ['overpayFloorEur' => $overpayFloorInput],
                        400
                    );
                    return;
                }
                $overpayFloorEur = max(0.0, round((float) $overpayFloorInput, 2));
            }
            $overpayNote = isset($request->body['overpayNote']) ? (string) $request->body['overpayNote'] : null;

            $success = $this->portfolioService->updateInvestmentOverpayProfile(
                $userId,
                $id,
                $overpayEnabled,
                $overpayFloorEur,
                $overpayNote
            );
            if (!$success) {
                JsonResponseFactory::error(
                    'INVESTMENT_NOT_FOUND',
                    'Investition mit dieser ID nicht gefunden.',
                    ['id' => $id],
                    404
                );
                return;
            }

            $syncPayload = $this->portfolioService->buildInvestmentSyncPayload($userId, $id, null, null);
            if (is_array($syncPayload)) {
                $this->syncService->upsertServerEntity(
                    $userId,
                    'investments',
                    (string) $id,
                    $syncPayload
                );
            }

            JsonResponseFactory::success(
                [
                    'success' => true,
                    'investmentId' => $id,
                    'overpayEnabled' => $overpayEnabled,
                    'overpayFloorEur' => $overpayFloorEur,
                    'overpayNote' => $overpayNote,
                ],
                [],
                200
            );
        } catch (UserScopeAuthorizationException $exception) {
            JsonResponseFactory::error($exception->getErrorCode(), $exception->getMessage(), $exception->getDetails(), $exception->getStatusCode());
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'error',
                'error.http_5xx',
                'Portfolio update overpay profile failed',
                ['statusCode' => 500, 'investmentId' => $id, 'exception' => $exception]
            );
            JsonResponseFactory::error('PORTFOLIO_UPDATE_OVERPAY_FAILED', $exception->getMessage(), [], 500);
        }
    }

    private function resolveUserId(Request $request): int
    {
        if ($this->userScopeResolver !== null) {
            return $this->userScopeResolver->resolve($request);
        }

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

    private function resolveScope(Request $request): string
    {
        $scopeInput = $request->query['scope'] ?? $request->body['scope'] ?? 'investments';
        $scope = strtolower(trim((string) $scopeInput));
        return $scope === 'all' ? 'all' : 'investments';
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
