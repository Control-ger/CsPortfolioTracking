<?php
declare(strict_types=1);

namespace App\Shared\Http;

/**
 * Shared path-pattern matching for route-scoped policies (auth gate, rate limits).
 *
 * Placeholders mirror the Router: `{id}` matches a numeric segment, `{key}` any
 * single segment. A trailing `*` matches the remainder of the path, so a policy
 * can cover a whole subtree (`/api/v1/settings/*`).
 */
final class RoutePattern
{
    public static function matches(string $pattern, string $path): bool
    {
        if ($pattern === $path) {
            return true;
        }

        if (!str_contains($pattern, '{') && !str_contains($pattern, '*')) {
            return false;
        }

        $regex = preg_quote($pattern, '#');
        $regex = str_replace('\{id\}', '\d+', $regex);
        $regex = str_replace('\{key\}', '[^/]+', $regex);
        $regex = str_replace('\*', '.*', $regex);

        return preg_match('#^' . $regex . '$#', $path) === 1;
    }

    /**
     * Specificity score used to pick the most precise of several matching rules.
     * Concrete segments outweigh placeholders; wildcards score lowest.
     */
    public static function specificity(string $pattern): int
    {
        if (str_contains($pattern, '*')) {
            return 1;
        }

        return str_contains($pattern, '{') ? 2 : 3;
    }
}
