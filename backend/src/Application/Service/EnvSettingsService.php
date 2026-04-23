<?php
declare(strict_types=1);

namespace App\Application\Service;

final class EnvSettingsService
{
    private string $envPath;

    public function __construct(string $projectRootPath)
    {
        $this->envPath = rtrim($projectRootPath, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . '.env';
    }

    public function getEnvPath(): string
    {
        return $this->envPath;
    }

    public function readEnvFile(): array
    {
        if (!is_file($this->envPath)) {
            return [];
        }

        $lines = file($this->envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if ($lines === false) {
            return [];
        }

        $env = [];
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }

            $equalsPos = strpos($line, '=');
            if ($equalsPos === false) {
                continue;
            }

            $key = trim(substr($line, 0, $equalsPos));
            $value = trim(substr($line, $equalsPos + 1), " \t\n\r\0\x0B\"'");
            $env[$key] = $value;
        }

        return $env;
    }

    public function writeEnvValue(string $key, string $value): bool
    {
        if (!preg_match('/^[A-Z_][A-Z0-9_]*$/', $key)) {
            throw new \InvalidArgumentException('Invalid environment variable name');
        }

        $lines = [];
        $found = false;
        $value = str_replace('"', '\\"', $value);

        if (is_file($this->envPath)) {
            $existingLines = file($this->envPath, FILE_IGNORE_NEW_LINES);
            if ($existingLines !== false) {
                foreach ($existingLines as $line) {
                    $trimmedLine = trim($line);
                    if ($trimmedLine === '' || str_starts_with($trimmedLine, '#')) {
                        $lines[] = $line;
                        continue;
                    }

                    $equalsPos = strpos($trimmedLine, '=');
                    if ($equalsPos === false) {
                        $lines[] = $line;
                        continue;
                    }

                    $existingKey = trim(substr($trimmedLine, 0, $equalsPos));
                    if ($existingKey === $key) {
                        $lines[] = $key . '="' . $value . '"';
                        $found = true;
                    } else {
                        $lines[] = $line;
                    }
                }
            }
        }

        if (!$found) {
            $lines[] = $key . '="' . $value . '"';
        }

        $content = implode("\n", $lines) . "\n";
        $written = file_put_contents($this->envPath, $content, LOCK_EX);

        if ($written !== false) {
            putenv("{$key}={$value}");
            $_ENV[$key] = $value;
        }

        return $written !== false;
    }

    public function getValue(string $key): ?string
    {
        $env = $this->readEnvFile();
        return $env[$key] ?? null;
    }
}
