<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;

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
        $this->pdo->exec($sql);
    }

    public function findAll(): array
    {
        $stmt = $this->pdo->query('SELECT id, name, type, added_at FROM watchlist ORDER BY added_at DESC');
        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    public function existsByName(string $name): bool
    {
        $stmt = $this->pdo->prepare('SELECT id FROM watchlist WHERE name = ?');
        $stmt->execute([$name]);
        return (bool) $stmt->fetch(PDO::FETCH_ASSOC);
    }

    public function insert(string $name, string $type): int
    {
        $stmt = $this->pdo->prepare('INSERT INTO watchlist (name, type) VALUES (?, ?)');
        $stmt->execute([$name, $type]);
        return (int) $this->pdo->lastInsertId();
    }

    public function deleteById(int $id): bool
    {
        $stmt = $this->pdo->prepare('DELETE FROM watchlist WHERE id = ?');
        $stmt->execute([$id]);
        return $stmt->rowCount() > 0;
    }
}
