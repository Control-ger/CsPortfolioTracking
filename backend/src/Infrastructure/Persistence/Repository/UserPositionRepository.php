<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class UserPositionRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function findAllByUserId(int $userId): array
    {
        $sql = 'SELECT user_id, item_id, quantity_open, avg_buy_price_usd, total_cost_usd
                FROM user_positions
                WHERE user_id = ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$userId]);
            return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['userId' => $userId]
            );
            throw $exception;
        }
    }
}

