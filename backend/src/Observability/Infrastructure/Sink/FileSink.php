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
        if (@file_put_contents($this->getAppLogPath(), $line, FILE_APPEND) === false) {
            self::warnOnceAboutUnwritableLog($this->getAppLogPath());
        }
        $this->writeToStderr($line);
    }

    /**
     * A silenced write failure here is invisible by construction, and that is how
     * every request-scoped event went missing for web traffic while the root-owned
     * cron kept the same file growing — the log looked healthy, so nobody looked.
     * Reported once per process to `error_log` (Apache's error log, hence the
     * container log) rather than per request, which would only trade one blind
     * spot for a flood.
     */
    private static bool $unwritableLogReported = false;

    private static function warnOnceAboutUnwritableLog(string $path): void
    {
        if (self::$unwritableLogReported) {
            return;
        }

        self::$unwritableLogReported = true;
        error_log(
            '[observability] cannot append to ' . $path
            . ' — request-scoped events are being dropped. Check ownership: the web user needs write access.'
        );
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

