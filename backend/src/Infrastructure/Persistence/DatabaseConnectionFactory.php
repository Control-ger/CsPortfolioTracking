<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence;

use App\Config\DatabaseConfig;
use App\Shared\Logger;
use PDO;
use Throwable;

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
            'mysql:host=%s;dbname=%s;charset=%s',
            $this->config->host,
            $this->config->database,
            $this->config->charset
        );

        try {
            $pdo = new PDO(
                $dsn,
                $this->config->username,
                $this->config->password,
                [
                    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                ]
            );
            Logger::event(
                'info',
                'db',
                'db.connection.success',
                'Database connection established',
                [
                    'driver' => 'mysql',
                    'host' => $this->config->host,
                    'database' => $this->config->database,
                    'charset' => $this->config->charset,
                ]
            );

            return $pdo;
        } catch (Throwable $exception) {
            Logger::event(
                'error',
                'db',
                'db.connection.failed',
                'Database connection failed',
                [
                    'driver' => 'mysql',
                    'host' => $this->config->host,
                    'database' => $this->config->database,
                    'charset' => $this->config->charset,
                    'exception' => $exception,
                ]
            );
            throw $exception;
        }
    }
}
