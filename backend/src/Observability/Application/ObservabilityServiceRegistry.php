<?php
declare(strict_types=1);

namespace App\Observability\Application;

final class ObservabilityServiceRegistry
{
    private static ?ObservabilityService $service = null;

    public static function set(ObservabilityService $service): void
    {
        self::$service = $service;
    }

    public static function get(): ?ObservabilityService
    {
        return self::$service;
    }
}

