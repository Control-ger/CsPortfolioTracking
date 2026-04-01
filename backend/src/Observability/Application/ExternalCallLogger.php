<?php
declare(strict_types=1);

namespace App\Observability\Application;

use App\Observability\Domain\LogCategory;

final class ExternalCallLogger
{
    public function __construct(private readonly ObservabilityService $observabilityService)
    {
    }

    public function request(string $eventName, string $message, array $context = []): void
    {
        $this->observabilityService->info(LogCategory::EXTERNAL, $eventName, $message, $context);
    }

    public function response(
        string $level,
        string $eventName,
        string $message,
        array $context = []
    ): void {
        $this->observabilityService->log($level, LogCategory::EXTERNAL, $eventName, $message, $context);
    }
}

