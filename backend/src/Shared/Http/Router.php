<?php
declare(strict_types=1);

namespace App\Shared\Http;

use App\Shared\Logger;

final class Router
{
    /** @var array<string, callable> */
    private array $routes = [];

    public function register(string $method, string $path, callable $handler): void
    {
        $this->routes[strtoupper($method) . ' ' . $path] = $handler;
    }

    public function dispatch(Request $request): void
    {
        $key = $request->method . ' ' . $request->path;
        if (isset($this->routes[$key])) {
            ($this->routes[$key])($request);
            return;
        }

        foreach ($this->routes as $routeKey => $handler) {
            [$method, $routePath] = explode(' ', $routeKey, 2);
            if ($method !== $request->method || !str_contains($routePath, '{id}')) {
                continue;
            }

            $pattern = '#^' . str_replace('\{id\}', '(\\d+)', preg_quote($routePath, '#')) . '$#';
            if (preg_match($pattern, $request->path, $matches) !== 1) {
                continue;
            }

            $handler($request, (int) $matches[1]);
            return;
        }

        Logger::event(
            'warning',
            'error',
            'error.route_not_found',
            'Route not found',
            [
                'method' => $request->method,
                'route' => $request->path,
                'statusCode' => 404,
            ]
        );
        JsonResponseFactory::error('ROUTE_NOT_FOUND', 'Route nicht gefunden.', ['path' => $request->path], 404);
    }
}
