<?php
declare(strict_types=1);

namespace App\Http\Auth;

use App\Http\Controller\SteamAuthController;
use App\Infrastructure\Persistence\Repository\UserRepository;
use App\Shared\Http\Request;
use App\Shared\Http\UserScopeAuthorizationException;

final class RequestUserScopeResolver
{
    private const STEAM_ID_PATTERN = '/^[1-9]\d{10,}$/';
    private const STEAM_PREFIXED_PATTERN = '/^steam-([1-9]\d{10,})$/i';
    private const NUMERIC_USER_ID_PATTERN = '/^[1-9]\d{0,9}$/';

    public function __construct(
        private readonly UserRepository $userRepository,
        private readonly SteamAuthController $steamAuthController
    ) {
    }

    public function resolve(Request $request): int
    {
        $authenticatedUser = $this->resolveAuthenticatedUser($request);
        $authenticatedSteamId = $this->normalizeSteamId($authenticatedUser['steamId'] ?? null);
        $authenticatedUserId = $this->normalizeNumericUserId($authenticatedUser['userId'] ?? null);
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

        return 1;
    }

    private function resolveAuthenticatedUser(Request $request): ?array
    {
        $token = $this->extractSessionToken($request);
        if ($token === '') {
            return null;
        }

        return $this->steamAuthController->validateSession($token);
    }

    private function extractSessionToken(Request $request): string
    {
        $authHeader = trim((string) ($request->headers['authorization'] ?? $request->headers['x-auth-token'] ?? ''));
        if ($authHeader === '') {
            return '';
        }

        if (str_starts_with(strtolower($authHeader), 'bearer ')) {
            return trim(substr($authHeader, 7));
        }

        return $authHeader;
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
