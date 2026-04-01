<?php
declare(strict_types=1);

namespace App\Observability\Domain;

final class LogLevel
{
    public const DEBUG = 'debug';
    public const INFO = 'info';
    public const WARNING = 'warning';
    public const ERROR = 'error';

    public static function normalize(string $value): string
    {
        $normalized = strtolower(trim($value));

        return match ($normalized) {
            self::DEBUG, self::INFO, self::WARNING, self::ERROR => $normalized,
            'warn' => self::WARNING,
            'err' => self::ERROR,
            default => self::INFO,
        };
    }
}

