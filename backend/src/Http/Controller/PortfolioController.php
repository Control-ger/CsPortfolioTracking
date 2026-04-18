<?php
declare(strict_types=1);

namespace App\Http\Controller;

use App\Application\Service\PortfolioService;
use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Request;
use App\Shared\Logger;
use Throwable;

final class PortfolioController
{
    public function __construct(private readonly PortfolioService $portfolioService)
    {
    }

    public function investments(Request $request): void
    {
        try {
            $rows = $this->portfolioService->getEnrichedInvestments();
            JsonResponseFactory::success(
                $rows,
                ['warnings' => $this->portfolioService->consumePricingWarnings()]
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
            $rows = $this->portfolioService->getEnrichedInvestments();
            JsonResponseFactory::success(
                $this->portfolioService->getSummary($rows)->toArray(),
                ['warnings' => $this->portfolioService->consumePricingWarnings()]
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
            JsonResponseFactory::success($this->portfolioService->getHistory());
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
            JsonResponseFactory::success($this->portfolioService->getInvestmentHistory($id));
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
                $this->portfolioService->saveDailyValue($value),
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
            JsonResponseFactory::success($this->portfolioService->getComposition());
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
}
