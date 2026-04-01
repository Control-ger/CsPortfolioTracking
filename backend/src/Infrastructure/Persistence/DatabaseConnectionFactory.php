<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence;

use PDO;
use App\Config\DatabaseConfig;

final class DatabaseConnectionFactory
{
    private DatabaseConfig $config;

    public function __construct(DatabaseConfig $config)
    {
        $this->config = $config;
    }

    public function create(): PDO
    {
        $dsn = sprintf(
            'mysql:host=%s;***REMOVED***name=%s;charset=%s',
            $this->config->host,
            $this->config->database,
            $this->config->charset
        );

        return new PDO(
            $dsn,
            $this->config->username,
            $this->config->password,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]
        );
    }
}