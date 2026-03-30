<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence;

use App\Config\DatabaseConfig;
use PDO;

final class DatabaseConnectionFactory
{
    public function __construct(private readonly DatabaseConfig $config)
    {
    }

    public function create(): PDO
    {
        $dsn = sprintf(
            'mysql:host=%s;***REMOVED***name=%s;charset=%s',
            $this->config->host,
            $this->config->database,
            $this->config->charset
        );

        $pdo = new PDO($dsn, $this->config->username, $this->config->password);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        return $pdo;
    }
}
