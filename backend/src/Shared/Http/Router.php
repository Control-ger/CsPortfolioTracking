<?php
declare(strict_types=1);

namespace App\Shared\Http;

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

        if ($request->method === 'DELETE' && preg_match('#^/api/v1/watchlist/(\d+)$#', $request->path, $matches) === 1) {
            $handler = $this->routes['DELETE /api/v1/watchlist/{id}'] ?? null;
            if ($handler !== null) {
                $handler($request, (int) $matches[1]);
                return;
            }
        }

        JsonResponseFactory::error('ROUTE_NOT_FOUND', 'Route nicht gefunden.', ['path' => $request->path], 404);
    }
}
