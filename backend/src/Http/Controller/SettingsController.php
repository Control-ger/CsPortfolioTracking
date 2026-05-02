<?php
declare(strict_types=1);

namespace App\Http\Controller;

use App\Application\Service\EncryptionService;
use App\Application\Service\EnvSettingsService;
use App\Application\Service\FeeSettingsService;
use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Request;
use App\Shared\Logger;
use InvalidArgumentException;
use RuntimeException;
use Throwable;

final class SettingsController
{
    private readonly EncryptionService $encryptionService;
    private readonly EnvSettingsService $envSettingsService;

    public function __construct(
        private readonly FeeSettingsService $feeSettingsService,
        string $projectRootPath = __DIR__ . '/../../../'
    ) {
        $encryptionKey = getenv('ENCRYPTION_KEY') ?: $_ENV['ENCRYPTION_KEY'] ?? '';
        if (strlen($encryptionKey) < 32) {
            $encryptionKey = str_pad($encryptionKey, 32, '0');
        }
        $this->encryptionService = new EncryptionService($encryptionKey);
        $this->envSettingsService = new EnvSettingsService($projectRootPath);
    }

    public function fees(Request $request): void
    {
        try {
            JsonResponseFactory::success($this->feeSettingsService->getSettings($this->resolveUserId($request)));
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
            $updated = $this->feeSettingsService->updateSettings($this->resolveUserId($request), $request->body);
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

    public function getCsFloatApiKeyStatus(Request $request): void
    {
        try {
            $existingKey = $this->envSettingsService->getValue('CSFLOAT_API_KEY');
            $hasKey = !empty($existingKey) && $existingKey !== 'replace-with-csfloat-api-key';

            JsonResponseFactory::success([
                'configured' => $hasKey,
                'lastFour' => $hasKey ? substr($existingKey, -4) : null,
            ]);
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'error',
                'error.http_5xx',
                'CSFloat API key status request failed',
                ['statusCode' => 500, 'exception' => $exception]
            );
            JsonResponseFactory::error('SETTINGS_FETCH_FAILED', $exception->getMessage(), [], 500);
        }
    }

    public function updateCsFloatApiKey(Request $request): void
    {
        try {
            $encryptedKey = $request->body['encryptedKey'] ?? '';
            if (empty($encryptedKey)) {
                throw new InvalidArgumentException('Encrypted API key is required');
            }

            $apiKey = $this->encryptionService->decrypt($encryptedKey);
            if ($apiKey === null) {
                throw new InvalidArgumentException('Failed to decrypt API key');
            }

            if (strlen($apiKey) < 10) {
                throw new InvalidArgumentException('API key appears to be invalid (too short)');
            }

            $saved = $this->envSettingsService->writeEnvValue('CSFLOAT_API_KEY', $apiKey);
            if (!$saved) {
                throw new RuntimeException('Failed to write API key to environment file');
            }

            Logger::event(
                'info',
                'system',
                'system.config.updated',
                'CSFloat API key updated',
                ['statusCode' => 200]
            );

            JsonResponseFactory::success([
                'success' => true,
                'lastFour' => substr($apiKey, -4),
            ]);
        } catch (InvalidArgumentException $exception) {
            Logger::event(
                'warning',
                'error',
                'error.validation',
                'CSFloat API key validation failed',
                ['statusCode' => 400, 'exception' => $exception]
            );
            JsonResponseFactory::error('SETTINGS_VALIDATION_FAILED', $exception->getMessage(), [], 400);
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'error',
                'error.http_5xx',
                'CSFloat API key update request failed',
                ['statusCode' => 500, 'exception' => $exception]
            );
            JsonResponseFactory::error('SETTINGS_SAVE_FAILED', $exception->getMessage(), [], 500);
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

