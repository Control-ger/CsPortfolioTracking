<?php
declare(strict_types=1);

namespace App\Application\Service;

use App\Infrastructure\Persistence\Repository\UserPositionRepository;
use PDO;
use Throwable;

final class ScalingShadowReadService
{
    public function __construct(
        private readonly PDO $pdo,
        private readonly UserPositionRepository $userPositionRepository
    ) {
    }

    public function buildPortfolioSummary(int $userId): array
    {
        $positions = $this->userPositionRepository->findAllByUserId($userId);
        if ($positions === []) {
            return [
                'positions' => 0,
                'totalValue' => 0.0,
                'totalInvested' => 0.0,
            ];
        }

        $totalValue = 0.0;
        $totalInvested = 0.0;
        $positionCount = 0;

        $sql = 'SELECT ipl.price_usd, er.usd_to_eur
                FROM item_price_latest ipl
                INNER JOIN exchange_rates er ON er.id = ipl.exchange_rate_id
                WHERE ipl.item_id = ?
                LIMIT 1';
        $stmt = $this->pdo->prepare($sql);

        foreach ($positions as $row) {
            $itemId = (int) ($row['item_id'] ?? 0);
            $quantity = (int) ($row['quantity_open'] ?? 0);
            $avgBuyPriceUsd = (float) ($row['avg_buy_price_usd'] ?? 0.0);
            if ($itemId <= 0 || $quantity <= 0) {
                continue;
            }

            $stmt->execute([$itemId]);
            $priceRow = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!is_array($priceRow)) {
                continue;
            }

            $priceUsd = (float) ($priceRow['price_usd'] ?? 0.0);
            $usdToEur = (float) ($priceRow['usd_to_eur'] ?? 0.0);
            if ($priceUsd <= 0 || $usdToEur <= 0) {
                continue;
            }

            $totalValue += $quantity * $priceUsd * $usdToEur;
            $totalInvested += $quantity * $avgBuyPriceUsd * $usdToEur;
            $positionCount++;
        }

        return [
            'positions' => $positionCount,
            'totalValue' => round($totalValue, 2),
            'totalInvested' => round($totalInvested, 2),
        ];
    }

    public function buildWatchlistStats(int $userId): array
    {
        $sql = 'SELECT
                    COUNT(*) AS total_items,
                    SUM(CASE WHEN ipl.item_id IS NOT NULL THEN 1 ELSE 0 END) AS priced_items
                FROM watchlist w
                LEFT JOIN item_price_latest ipl ON ipl.item_id = w.item_id
                WHERE w.user_id = ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$userId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
            return [
                'totalItems' => (int) ($row['total_items'] ?? 0),
                'pricedItems' => (int) ($row['priced_items'] ?? 0),
            ];
        } catch (Throwable) {
            return [
                'totalItems' => 0,
                'pricedItems' => 0,
            ];
        }
    }
}

