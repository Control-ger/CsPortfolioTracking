<?php
declare(strict_types=1);

namespace App\Http\Controller;

use App\Application\Service\PortfolioService;
use App\Application\Service\ScalingShadowReadService;
use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Request;
use App\Shared\Logger;
use Throwable;

final class PortfolioController
{
    public function __construct(
        private readonly PortfolioService $portfolioService,
        private readonly ?ScalingShadowReadService $scalingShadowReadService = null
    ) {
    }

    public function investments(Request $request): void
    {
        try {
            $userId = $this->resolveUserId($request);
            $rows = $this->portfolioService->getEnrichedInvestments($userId, true);
            JsonResponseFactory::success(
                $rows,
                [
                    'warnings' => $this->portfolioService->consumePricingWarnings(),
                    'readPath' => $this->primaryScalingReadEnabled() ? 'scaling_primary' : 'legacy',
                ]
            );
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
            $usePrimaryScalingRead = $this->primaryScalingReadEnabled() && $this->scalingShadowReadService !== null;
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
                $rows = $this->portfolioService->getEnrichedInvestments($userId);
                $summary = $this->portfolioService->getSummary($rows)->toArray();
                $meta = ['warnings' => $this->portfolioService->consumePricingWarnings()];
                $meta['readPath'] = 'legacy';
            }

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
            JsonResponseFactory::success($this->portfolioService->getComposition($this->resolveUserId($request)));
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

    public function toggleExcludeInvestment(Request $request, int $id): void
    {
        try {
            $exclude = filter_var($request->body['exclude'] ?? false, FILTER_VALIDATE_BOOL);
            $success = $this->portfolioService->toggleExcludeInvestment($this->resolveUserId($request), $id, $exclude);

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

            JsonResponseFactory::success(
                ['success' => true, 'investmentId' => $id, 'excluded' => $exclude],
                [],
                200
            );
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
