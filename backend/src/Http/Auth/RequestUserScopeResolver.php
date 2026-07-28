<?php
declare(strict_types=1);

namespace App\Http\Auth;

use App\Infrastructure\Persistence\Repository\UserRepository;
use App\Shared\Http\Request;
use App\Shared\Http\UserScopeAuthorizationException;
use App\Shared\Logger;

/**
 * Maps a request onto the numeric user id its data may be read/written under.
 *
 * The authenticated identity is resolved once per request by RequestAuthenticator
 * and injected here; this class only compares an explicitly requested scope
 * against it. It never validates a token itself and never derives identity from
 * client-supplied headers.
 */
final class RequestUserScopeResolver
{
    private const STEAM_ID_PATTERN = '/^[1-9]\d{10,}$/';
    private const STEAM_PREFIXED_PATTERN = '/^steam-([1-9]\d{10,})$/i';
    private const NUMERIC_USER_ID_PATTERN = '/^[1-9]\d{0,9}$/';

    public function __construct(
        private readonly UserRepository $userRepository,
        private readonly RequestIdentity $identity,
        private readonly bool $authEnforced,
    ) {
    }

    public function resolve(Request $request): int
    {
        $authenticatedSteamId = $this->identity->steamId;
        $authenticatedUserId = $this->identity->userId;
        $requestedSteamId = $this->extractRequestedSteamId($request);
        $requestedUserId = $this->extractRequestedUserId($request);

        if ($requestedSteamId !== null) {
            if ($authenticatedSteamId === null) {
                throw new UserScopeAuthorizationException(
                    'AUTH_REQUIRED',
                    'Authentifizierte Session fuer Steam-gebundene Requests erforderlich.',
                    401
                );
            }

            if ($authenticatedSteamId !== $requestedSteamId) {
                throw new UserScopeAuthorizationException(
                    'USER_SCOPE_FORBIDDEN',
                    'Angefragter Steam-Scope passt nicht zur authentifizierten Session.',
                    403
                );
            }

            return $this->userRepository->findOrCreateBySteamId($requestedSteamId);
        }

        if ($requestedUserId !== null) {
            if ($authenticatedUserId === null) {
                throw new UserScopeAuthorizationException(
                    'AUTH_REQUIRED',
                    'Authentifizierte Session fuer explizite User-Scope-Requests erforderlich.',
                    401
                );
            }

            if ($authenticatedUserId !== $requestedUserId) {
                throw new UserScopeAuthorizationException(
                    'USER_SCOPE_FORBIDDEN',
                    'Angefragter User-Scope passt nicht zur authentifizierten Session.',
                    403
                );
            }

            return $authenticatedUserId;
        }

        if ($authenticatedUserId !== null) {
            return $authenticatedUserId;
        }

        if ($authenticatedSteamId !== null) {
            return $this->userRepository->findOrCreateBySteamId($authenticatedSteamId);
        }

        return $this->resolveUnauthenticated($request);
    }

    /**
     * No session and no explicit scope.
     *
     * Historically this silently returned user 1, which handed a caller without
     * any credential the default account's portfolio, watchlist and settings. With
     * the auth gate enforced such a request never reaches a controller, so this is
     * a hard 401. While the gate is still in observe-only mode the legacy fallback
     * remains, but it is logged as the security event it is.
     */
    private function resolveUnauthenticated(Request $request): int
    {
        if ($this->authEnforced) {
            throw new UserScopeAuthorizationException(
                'AUTH_REQUIRED',
                'Authentifizierte Session erforderlich.',
                401
            );
        }

        Logger::event(
            'warning',
            'security',
            'security.auth.anonymous_default_scope',
            'Unauthenticated request resolved to legacy default user scope',
            [
                'method' => $request->method,
                'route' => $request->path,
                'credentialPresent' => $this->identity->tokenPresent,
            ]
        );

        return 1;
    }

    private function extractRequestedSteamId(Request $request): ?string
    {
        foreach ([
            $request->headers['x-steam-id'] ?? null,
            $request->headers['steam-id'] ?? null,
            $request->query['steamId'] ?? null,
            $request->query['steam_id'] ?? null,
            $request->body['steamId'] ?? null,
            $request->body['steam_id'] ?? null,
            $request->query['userId'] ?? null,
            $request->query['user_id'] ?? null,
            $request->body['userId'] ?? null,
            $request->body['user_id'] ?? null,
        ] as $candidate) {
            $normalized = $this->normalizeSteamId($candidate);
            if ($normalized !== null) {
                return $normalized;
            }
        }

        return null;
    }

    private function extractRequestedUserId(Request $request): ?int
    {
        foreach ([
            $request->headers['x-user-id'] ?? null,
            $request->headers['user-id'] ?? null,
            $request->query['userId'] ?? null,
            $request->query['user_id'] ?? null,
            $request->body['userId'] ?? null,
            $request->body['user_id'] ?? null,
        ] as $candidate) {
            if ($this->normalizeSteamId($candidate) !== null) {
                continue;
            }

            $normalized = $this->normalizeNumericUserId($candidate);
            if ($normalized !== null) {
                return $normalized;
            }
        }

        return null;
    }

    private function normalizeSteamId(mixed $value): ?string
    {
        $raw = trim((string) ($value ?? ''));
        if ($raw === '') {
            return null;
        }

        if (preg_match(self::STEAM_PREFIXED_PATTERN, $raw, $matches) === 1) {
            return $matches[1];
        }

        if (preg_match(self::STEAM_ID_PATTERN, $raw) === 1) {
            return $raw;
        }

        return null;
    }

    private function normalizeNumericUserId(mixed $value): ?int
    {
        $raw = trim((string) ($value ?? ''));
        if ($raw === '' || preg_match(self::NUMERIC_USER_ID_PATTERN, $raw) !== 1) {
            return null;
        }

        $userId = (int) $raw;
        return $userId > 0 ? $userId : null;
    }
}
