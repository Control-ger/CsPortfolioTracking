<?php
declare(strict_types=1);

namespace App\Observability\Domain;

final class LogCategory
{
    public const HTTP = 'http';
    public const DOMAIN = 'domain';
    public const EXTERNAL = 'external';
    public const ERROR = 'error';
    public const DB = 'db';
    public const SYSTEM = 'system';
    public const FRONTEND = 'frontend';

    public static function normalize(string $value): string
    {
        $normalized = strtolower(trim($value));

        return match ($normalized) {
            self::HTTP,
            self::DOMAIN,
            self::EXTERNAL,
            self::ERROR,
            self::DB,
            self::SYSTEM,
            self::FRONTEND => $normalized,
            default => self::SYSTEM,
        };
    }
}

