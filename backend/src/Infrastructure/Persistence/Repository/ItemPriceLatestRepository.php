<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class ItemPriceLatestRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function findByItemId(int $itemId): ?array
    {
        $sql = 'SELECT item_id, price_usd, exchange_rate_id, price_source, provider_timestamp, fetched_at
                FROM item_price_latest
                WHERE item_id = ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$itemId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return $row ?: null;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['itemId' => $itemId]
            );
            throw $exception;
        }
    }

    public function countRows(): int
    {
        $sql = 'SELECT COUNT(*) FROM item_price_latest';
        $stmt = $this->pdo->query($sql);
        return (int) ($stmt?->fetchColumn() ?: 0);
    }
}

