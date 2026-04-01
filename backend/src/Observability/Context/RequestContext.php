<?php
declare(strict_types=1);

namespace App\Observability\Context;

final class RequestContext
{
    public function __construct(
        public readonly string $requestId,
        public readonly string $method,
        public readonly string $path,
        public readonly ?string $userAgent = null,
        public readonly ?string $ip = null
    ) {
    }

    public function toArray(): array
    {
        return [
            'requestId' => $this->requestId,
            'method' => $this->method,
            'path' => $this->path,
            'userAgent' => $this->userAgent,
            'ip' => $this->ip,
        ];
    }
}

