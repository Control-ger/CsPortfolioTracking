<?php
declare(strict_types=1);

namespace App\Application\Service;

use PDO;
use Throwable;

final class ScalingShadowReadService
{
    public function __construct(
        private readonly PDO $pdo
    ) {
    }

    public function buildPortfolioSummary(int $userId): array
    {
        $positionsSql = 'SELECT
                            COUNT(*) AS positions,
                            COALESCE(SUM(quantity_open), 0) AS total_quantity,
                            COALESCE(SUM(total_cost_usd), 0) AS total_invested_usd
                         FROM user_positions
                         WHERE user_id = ? AND quantity_open > 0';
        $valueSql = 'SELECT
                        COALESCE(SUM(up.quantity_open * ipl.price_usd), 0) AS total_value_usd,
                        COALESCE(COUNT(ipl.item_id), 0) AS priced_positions
                     FROM user_positions up
                     INNER JOIN item_price_latest ipl ON ipl.item_id = up.item_id
                     WHERE up.user_id = ? AND up.quantity_open > 0';
        $rateSql = 'SELECT usd_to_eur
                    FROM exchange_rates
                    ORDER BY date DESC, id DESC
                    LIMIT 1';

        try {
            $positionsStmt = $this->pdo->prepare($positionsSql);
            $positionsStmt->execute([$userId]);
            $positionsRow = $positionsStmt->fetch(PDO::FETCH_ASSOC) ?: [];

            $valueStmt = $this->pdo->prepare($valueSql);
            $valueStmt->execute([$userId]);
            $valueRow = $valueStmt->fetch(PDO::FETCH_ASSOC) ?: [];

            $rateStmt = $this->pdo->query($rateSql);
            $usdToEur = (float) ($rateStmt?->fetchColumn() ?: 0.0);
            if ($usdToEur <= 0) {
                $usdToEur = 1.0;
            }

            $totalValueUsd = (float) ($valueRow['total_value_usd'] ?? 0.0);
            $totalInvestedUsd = (float) ($positionsRow['total_invested_usd'] ?? 0.0);

            return [
                'positions' => (int) ($positionsRow['positions'] ?? 0),
                'pricedPositions' => (int) ($valueRow['priced_positions'] ?? 0),
                'totalQuantity' => (int) ($positionsRow['total_quantity'] ?? 0),
                'totalValue' => round($totalValueUsd * $usdToEur, 2),
                'totalInvested' => round($totalInvestedUsd * $usdToEur, 2),
            ];
        } catch (Throwable) {
            return [
                'positions' => 0,
                'pricedPositions' => 0,
                'totalQuantity' => 0,
                'totalValue' => 0.0,
                'totalInvested' => 0.0,
            ];
        }
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
