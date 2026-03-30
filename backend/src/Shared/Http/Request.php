<?php
declare(strict_types=1);

namespace App\Shared\Http;

final class Request
{
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly array $query,
        public readonly array $body
    ) {
    }

    public static function fromGlobals(): self
    {
        $uriPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
        $basePos = strpos($uriPath, '/api/v1/');
        $path = $basePos === false ? $uriPath : substr($uriPath, $basePos);
        $jsonBody = json_decode((string) file_get_contents('php://input'), true);

        return new self(
            method: strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET'),
            path: $path,
            query: $_GET,
            body: is_array($jsonBody) ? $jsonBody : $_POST
        );
    }
}
