<?php
declare(strict_types=1);

namespace App\Shared\Http;

final class Request
{
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly array $query,
        public readonly array $body,
        public readonly array $headers = [],
        public readonly ?string $requestId = null,
        public readonly ?string $jsonDecodeError = null
    ) {
    }

    public static function fromGlobals(?string $requestId = null, ?array $headers = null): self
    {
        $uriPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
        $basePos = strpos($uriPath, '/api/v1/');
        $path = $basePos === false ? $uriPath : substr($uriPath, $basePos);
        $resolvedHeaders = $headers ?? self::collectHeaders();

        $rawBody = (string) file_get_contents('php://input');
        $decodedBody = null;
        $jsonDecodeError = null;
        $contentType = strtolower((string) ($resolvedHeaders['content-type'] ?? ''));
        $isJsonPayload = str_contains($contentType, 'application/json')
            || str_contains($contentType, '+json')
            || preg_match('/^\s*[\{\[]/', $rawBody) === 1;
        if ($isJsonPayload && trim($rawBody) !== '') {
            $decodedBody = json_decode($rawBody, true);
            if ($decodedBody === null && json_last_error() !== JSON_ERROR_NONE) {
                $jsonDecodeError = json_last_error_msg();
            }
        }

        return new self(
            method: strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET'),
            path: $path,
            query: $_GET,
            body: is_array($decodedBody) ? $decodedBody : $_POST,
            headers: $resolvedHeaders,
            requestId: $requestId,
            jsonDecodeError: $jsonDecodeError
        );
    }

    private static function collectHeaders(): array
    {
        $headers = [];

        if (function_exists('getallheaders')) {
            $rawHeaders = getallheaders();
            if (is_array($rawHeaders)) {
                foreach ($rawHeaders as $key => $value) {
                    $headers[strtolower((string) $key)] = (string) $value;
                }
            }
        }

        foreach ($_SERVER as $key => $value) {
            if (!is_string($value)) {
                continue;
            }

            if (str_starts_with($key, 'HTTP_')) {
                $headerKey = strtolower(str_replace('_', '-', substr($key, 5)));
                $headers[$headerKey] = $value;
                continue;
            }

            if (in_array($key, ['CONTENT_TYPE', 'CONTENT_LENGTH'], true)) {
                $headerKey = strtolower(str_replace('_', '-', $key));
                $headers[$headerKey] = $value;
            }
        }

        return $headers;
    }
}
