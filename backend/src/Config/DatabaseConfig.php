<?php
declare(strict_types=1);

namespace App\Config;

final class DatabaseConfig
{
    public string $host;
    public string $database;
    public string $charset;
    public string $username;
    public string $password;

    public function __construct()
    {
        $this->host = $this->readEnv('DB_HOST', '***REMOVED***');
        $this->database = $this->readEnv('DB_NAME', '***REMOVED***', ['MYSQL_DATABASE']);
        $this->charset = $this->readEnv('DB_CHARSET', 'utf8');
        $this->username = $this->readEnv('DB_USER', '***REMOVED***', ['MYSQL_USER']);
        $this->password = $this->readEnv('DB_PASSWORD', '***REMOVED***123', ['MYSQL_PASSWORD']);
    }

    private function readEnv(string $key, string $default, array $aliases = []): string
    {
        $keys = array_merge([$key], $aliases);
        foreach ($keys as $envKey) {
            $value = $_ENV[$envKey] ?? getenv($envKey);
            if (is_string($value) && $value !== '') {
                return $value;
            }
        }

        return $default;
    }
}