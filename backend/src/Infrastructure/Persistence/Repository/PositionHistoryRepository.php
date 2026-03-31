<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;

final class PositionHistoryRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS position_history (
            id INT AUTO_INCREMENT PRIMARY KEY,
            investment_id INT NOT NULL,
            date DATE NOT NULL,
            quantity INT NOT NULL,
            unit_price DECIMAL(10, 2) NOT NULL,
            total_value DECIMAL(12, 2) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_investment_date (investment_id, date),
            INDEX idx_investment_date (investment_id, date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
        $this->pdo->exec($sql);
    }

    public function upsertSnapshot(
        int $investmentId,
        string $date,
        int $quantity,
        float $unitPrice,
        float $totalValue
    ): void {
        $stmt = $this->pdo->prepare(
            'INSERT INTO position_history (investment_id, date, quantity, unit_price, total_value)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                 quantity = VALUES(quantity),
                 unit_price = VALUES(unit_price),
                 total_value = VALUES(total_value)'
        );
        $stmt->execute([$investmentId, $date, $quantity, $unitPrice, $totalValue]);
    }

    public function findHistoryByInvestmentId(int $investmentId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT date, quantity, unit_price, total_value
             FROM position_history
             WHERE investment_id = ?
             ORDER BY date ASC'
        );
        $stmt->execute([$investmentId]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }
}
