<?php
declare(strict_types=1);

namespace App\Http\Auth;

use App\Shared\Http\RoutePattern;

/**
 * Decides which routes may be reached without an authenticated session.
 *
 * Deny-by-default: anything not listed here requires a valid session token. The
 * list is deliberately explicit rather than pattern-based so a newly registered
 * route is private until someone consciously opens it.
 */
final class RouteAccessPolicy
{
    private const PUBLIC_ROUTES = [
        // Steam OpenID handshake — by definition pre-session.
        'POST /api/v1/auth/steam/login',
        'GET /api/v1/auth/steam/login',
        'GET /api/v1/auth/steam/callback',
        // Validates a token itself and answers 401 on its own.
        'GET /api/v1/auth/session/validate',
        // Must stay reachable with an already-rejected token so the client can
        // still clean up; revokes only when the token actually decrypts.
        'POST /api/v1/auth/logout',
        // Non-user-scoped public data.
        'GET /api/v1/push/public-key',
        'GET /api/v1/exchange-rate',
        'GET /api/v1/cs-updates',
    ];

    public function isPublic(string $method, string $path): bool
    {
        $method = strtoupper($method);

        foreach (self::PUBLIC_ROUTES as $route) {
            [$routeMethod, $routePath] = explode(' ', $route, 2);
            if ($method === $routeMethod && RoutePattern::matches($routePath, $path)) {
                return true;
            }
        }

        return false;
    }
}
