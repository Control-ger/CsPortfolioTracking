<?php
declare(strict_types=1);

namespace App\Shared\Http;

final class JsonResponseFactory
{
    public static function success(mixed $data, array $meta = [], int $statusCode = 200): void
    {
        http_response_code($statusCode);
        header('Content-Type: application/json');
        echo json_encode(['data' => $data, 'meta' => $meta], JSON_UNESCAPED_UNICODE);
    }

    public static function error(string $code, string $message, array $details = [], int $statusCode = 400): void
    {
        http_response_code($statusCode);
        header('Content-Type: application/json');
        echo json_encode(
            ['error' => ['code' => $code, 'message' => $message, 'details' => $details]],
            JSON_UNESCAPED_UNICODE
        );
    }
}
