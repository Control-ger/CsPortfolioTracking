<?php
declare(strict_types=1);

namespace App\Http\Controller;

use App\Application\Service\FeeSettingsService;
use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Request;
use App\Shared\Logger;
use InvalidArgumentException;
use Throwable;

final class SettingsController
{
    public function __construct(private readonly FeeSettingsService $feeSettingsService)
    {
    }

    public function fees(Request $request): void
    {
        try {
            JsonResponseFactory::success($this->feeSettingsService->getSettings());
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'error',
                'error.http_5xx',
                'Fee settings read request failed',
                ['statusCode' => 500, 'exception' => $exception]
            );
            JsonResponseFactory::error('SETTINGS_FETCH_FAILED', $exception->getMessage(), [], 500);
        }
    }

    public function updateFees(Request $request): void
    {
        try {
            $updated = $this->feeSettingsService->updateSettings($request->body);
            JsonResponseFactory::success($updated, statusCode: 200);
        } catch (InvalidArgumentException $exception) {
            Logger::event(
                'warning',
                'error',
                'error.validation',
                'Fee settings validation failed',
                ['statusCode' => 400, 'exception' => $exception]
            );
            JsonResponseFactory::error('SETTINGS_VALIDATION_FAILED', $exception->getMessage(), [], 400);
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'error',
                'error.http_5xx',
                'Fee settings update request failed',
                ['statusCode' => 500, 'exception' => $exception]
            );
            JsonResponseFactory::error('SETTINGS_SAVE_FAILED', $exception->getMessage(), [], 500);
        }
    }
}

