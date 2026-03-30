<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;

final class PortfolioHistoryRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS ***REMOVED***_history (
            id INT AUTO_INCREMENT PRIMARY KEY,
            date DATE NOT NULL UNIQUE,
            total_value DECIMAL(10, 2) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_date (date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
        $this->pdo->exec($sql);
    }

    public function findAll(): array
    {
        $stmt = $this->pdo->query('SELECT id, date, total_value FROM ***REMOVED***_history ORDER BY date ASC');
        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    public function upsertForDate(string $date, float $totalValue): void
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO ***REMOVED***_history (date, total_value) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE total_value = VALUES(total_value)'
        );
        $stmt->execute([$date, $totalValue]);
    }
}
