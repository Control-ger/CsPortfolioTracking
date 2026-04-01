<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use App\Shared\Logger;
use Throwable;

final class RepositoryObservability
{
    private function __construct()
    {
    }

    public static function schemaEnsured(string $repository, string $table): void
    {
        Logger::event(
            'info',
            '***REMOVED***',
            '***REMOVED***.schema.ensure_table',
            'Database schema ensured',
            [
                'repository' => $repository,
                'table' => $table,
            ]
        );
    }

    public static function migrationColumnAdded(string $repository, string $table, string $column): void
    {
        Logger::event(
            'info',
            '***REMOVED***',
            '***REMOVED***.schema.migration_column_added',
            'Database schema column added',
            [
                'repository' => $repository,
                'table' => $table,
                'column' => $column,
            ]
        );
    }

    public static function queryFailed(
        string $repository,
        string $operation,
        string $sql,
        Throwable $exception,
        array $context = []
    ): void {
        Logger::event(
            'error',
            '***REMOVED***',
            '***REMOVED***.query.failed',
            'Database query failed',
            array_merge(
                [
                    'repository' => $repository,
                    'operation' => $operation,
                    'sql' => self::truncate($sql, 1200),
                    'exception' => $exception,
                ],
                $context
            )
        );
    }

    public static function upsertFailed(
        string $repository,
        string $operation,
        string $sql,
        Throwable $exception,
        array $context = []
    ): void {
        Logger::event(
            'error',
            '***REMOVED***',
            '***REMOVED***.upsert.failed',
            'Database upsert failed',
            array_merge(
                [
                    'repository' => $repository,
                    'operation' => $operation,
                    'sql' => self::truncate($sql, 1200),
                    'exception' => $exception,
                ],
                $context
            )
        );
    }

    public static function resultEmptyUnexpected(
        string $repository,
        string $operation,
        array $context = []
    ): void {
        Logger::event(
            'warning',
            '***REMOVED***',
            '***REMOVED***.result.empty_unexpected',
            'Database query returned empty result unexpectedly',
            array_merge(
                [
                    'repository' => $repository,
                    'operation' => $operation,
                ],
                $context
            )
        );
    }

    private static function truncate(string $value, int $maxLength): string
    {
        if (strlen($value) <= $maxLength) {
            return $value;
        }

        return substr($value, 0, $maxLength) . '...[truncated]';
    }
}

