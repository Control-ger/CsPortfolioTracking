<?php
declare(strict_types=1);

namespace App\Observability\Context;

final class RequestContextStore
{
    private static ?RequestContext $requestContext = null;

    public static function set(RequestContext $requestContext): void
    {
        self::$requestContext = $requestContext;
    }

    public static function get(): ?RequestContext
    {
        return self::$requestContext;
    }

    public static function clear(): void
    {
        self::$requestContext = null;
    }
}

