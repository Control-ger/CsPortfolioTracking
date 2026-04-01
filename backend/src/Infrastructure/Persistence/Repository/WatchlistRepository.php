<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class WatchlistRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS watchlist (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            type VARCHAR(50) DEFAULT 'skin',
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_name (name),
            INDEX idx_added_at (added_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            RepositoryObservability::schemaEnsured(self::class, 'watchlist');
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['table' => 'watchlist']
            );
            throw $exception;
        }
    }

    public function findAll(): array
    {
        $sql = 'SELECT id, name, type, added_at FROM watchlist ORDER BY added_at DESC';

        try {
            $stmt = $this->pdo->query($sql);
            return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception
            );
            throw $exception;
        }
    }

    public function existsByName(string $name): bool
    {
        $sql = 'SELECT id FROM watchlist WHERE name = ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$name]);
            return (bool) $stmt->fetch(PDO::FETCH_ASSOC);
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['name' => $name]
            );
            throw $exception;
        }
    }

    public function insert(string $name, string $type): int
    {
        $sql = 'INSERT INTO watchlist (name, type) VALUES (?, ?)';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$name, $type]);
            return (int) $this->pdo->lastInsertId();
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['name' => $name, 'type' => $type]
            );
            throw $exception;
        }
    }

    public function deleteById(int $id): bool
    {
        $sql = 'DELETE FROM watchlist WHERE id = ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$id]);
            return $stmt->rowCount() > 0;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['id' => $id]
            );
            throw $exception;
        }
    }
}
