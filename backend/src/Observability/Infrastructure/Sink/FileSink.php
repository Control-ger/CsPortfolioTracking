<?php
declare(strict_types=1);

namespace App\Observability\Infrastructure\Sink;

final class FileSink
{
    public function __construct(
        private readonly string $logDirectory = '/var/www/html/logs',
        private readonly string $appLogFileName = 'app.log'
    ) {
    }

    public function writeLegacy(string $level, string $message, array $context = []): void
    {
        $timestamp = date('Y-m-d H:i:s');
        $contextJson = $context === []
            ? ''
            : ' | ' . (json_encode($context, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}');
        $line = sprintf('[%s] %s: %s%s%s', $timestamp, strtoupper($level), $message, $contextJson, PHP_EOL);

        $this->ensureLogDirectory();
        @file_put_contents($this->getAppLogPath(), $line, FILE_APPEND);
        $this->writeToStderr($line);
    }

    private function ensureLogDirectory(): void
    {
        if (!is_dir($this->logDirectory)) {
            @mkdir($this->logDirectory, 0755, true);
        }
    }

    private function getAppLogPath(): string
    {
        return rtrim($this->logDirectory, '/\\') . DIRECTORY_SEPARATOR . $this->appLogFileName;
    }

    private function writeToStderr(string $line): void
    {
        $stderr = @fopen('php://stderr', 'wb');
        if ($stderr === false) {
            return;
        }

        @fwrite($stderr, $line);
        @fclose($stderr);
    }
}

