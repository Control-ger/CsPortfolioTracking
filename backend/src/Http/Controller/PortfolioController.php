<?php
declare(strict_types=1);

namespace App\Http\Controller;

use App\Application\Service\PortfolioService;
use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Request;
use Throwable;

final class PortfolioController
{
    public function __construct(private readonly PortfolioService $***REMOVED***Service)
    {
    }

    public function investments(Request $request): void
    {
        try {
            JsonResponseFactory::success($this->***REMOVED***Service->getEnrichedInvestments());
        } catch (Throwable $exception) {
            JsonResponseFactory::error('PORTFOLIO_INVESTMENTS_FAILED', $exception->getMessage(), [], 500);
        }
    }

    public function summary(Request $request): void
    {
        try {
            $rows = $this->***REMOVED***Service->getEnrichedInvestments();
            JsonResponseFactory::success($this->***REMOVED***Service->getSummary($rows)->toArray());
        } catch (Throwable $exception) {
            JsonResponseFactory::error('PORTFOLIO_SUMMARY_FAILED', $exception->getMessage(), [], 500);
        }
    }

    public function history(Request $request): void
    {
        try {
            JsonResponseFactory::success($this->***REMOVED***Service->getHistory());
        } catch (Throwable $exception) {
            JsonResponseFactory::error('PORTFOLIO_HISTORY_FAILED', $exception->getMessage(), [], 500);
        }
    }

    public function saveDailyValue(Request $request): void
    {
        try {
            $inputValue = $request->body['totalValue'] ?? $request->body['total_value'] ?? null;
            $value = is_numeric($inputValue) ? (float) $inputValue : null;
            JsonResponseFactory::success($this->***REMOVED***Service->saveDailyValue($value), statusCode: 200);
        } catch (Throwable $exception) {
            JsonResponseFactory::error('PORTFOLIO_SAVE_FAILED', $exception->getMessage(), [], 500);
        }
    }
}
