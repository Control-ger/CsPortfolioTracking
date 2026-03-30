<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;

final class InvestmentRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function findAll(): array
    {
        $stmt = $this->pdo->query('SELECT id, name, type, buy_price, quantity FROM investments');
        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }
}
