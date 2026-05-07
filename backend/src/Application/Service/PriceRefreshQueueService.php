<?php
declare(strict_types=1);

namespace App\Application\Service;

use App\Infrastructure\Persistence\Repository\PriceHistoryRepository;
use PDO;
use Throwable;

final class PriceRefreshQueueService
{
    private const PRIORITY_INVESTMENT = 1;
    private const PRIORITY_WATCHLIST = 2;
    private const PRIORITY_CATALOG = 3;

    public function __construct(
        private readonly PDO $pdo,
        private readonly PricingService $pricingService,
        private readonly PriceHistoryRepository $priceHistoryRepository
    ) {
    }

    public function ensureQueueTable(): void
    {
        $this->pdo->exec(
            "CREATE TABLE IF NOT EXISTS item_price_refresh_queue (
                item_id INT NOT NULL,
                priority TINYINT UNSIGNED NOT NULL DEFAULT 3,
                next_attempt_at DATETIME NOT NULL,
                last_planned_at DATETIME NOT NULL,
                last_attempt_at DATETIME NULL,
                locked_until DATETIME NULL,
                attempts INT NOT NULL DEFAULT 0,
                last_status VARCHAR(32) NULL,
                last_error TEXT NULL,
                last_price_source VARCHAR(64) NULL,
                last_fetched_at DATETIME NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (item_id),
                INDEX idx_queue_due (priority, next_attempt_at),
                INDEX idx_queue_locked (locked_until),
                CONSTRAINT fk_queue_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }

    public function planHourlyQueue(?\DateTimeImmutable $now = null): array
    {
        $this->ensureQueueTable();
        $now = $now ?? new \DateTimeImmutable('now');
        $cycleStart = new \DateTimeImmutable($now->format('Y-m-d H:i:00'));
        if ((int) $now->format('s') > 0) {
            $cycleStart = $cycleStart->modify('+1 minute');
        }

        $itemRows = $this->fetchPrioritizedItemRows();
        $this->cleanupRemovedItems();

        if ($itemRows === []) {
            return [
                'total' => 0,
                'priority1' => 0,
                'priority2' => 0,
                'priority3' => 0,
            ];
        }

        $groups = [
            self::PRIORITY_INVESTMENT => [],
            self::PRIORITY_WATCHLIST => [],
            self::PRIORITY_CATALOG => [],
        ];

        foreach ($itemRows as $row) {
            $priority = (int) ($row['priority'] ?? self::PRIORITY_CATALOG);
            if (!isset($groups[$priority])) {
                $priority = self::PRIORITY_CATALOG;
            }
            $groups[$priority][] = $row;
        }

        $scheduleWindows = [
            self::PRIORITY_INVESTMENT => [0, 10],
            self::PRIORITY_WATCHLIST => [10, 20],
            self::PRIORITY_CATALOG => [20, 30],
        ];

        foreach ($groups as $priority => $rows) {
            [$startMinute, $endMinute] = $scheduleWindows[$priority];
            $count = count($rows);
            foreach ($rows as $index => $row) {
                $itemId = (int) ($row['item_id'] ?? 0);
                if ($itemId <= 0) {
                    continue;
                }

                $scheduledAt = $this->buildScheduledTime(
                    $cycleStart,
                    $startMinute,
                    $endMinute,
                    $index,
                    $count,
                    $itemId
                );
                $this->upsertQueueItem($itemId, $priority, $scheduledAt);
            }
        }

        return [
            'total' => count($itemRows),
            'priority1' => count($groups[self::PRIORITY_INVESTMENT]),
            'priority2' => count($groups[self::PRIORITY_WATCHLIST]),
            'priority3' => count($groups[self::PRIORITY_CATALOG]),
        ];
    }

    public function processDueQueue(int $limit = 25): array
    {
        $this->ensureQueueTable();
        $this->priceHistoryRepository->ensureTable();

        $resolvedLimit = max(1, min($limit, 200));
        $dueRows = $this->fetchDueRows($resolvedLimit);

        if ($dueRows === []) {
            return [
                'processed' => 0,
                'success' => 0,
                'rateLimited' => 0,
                'failed' => 0,
            ];
        }

        $processed = 0;
        $success = 0;
        $rateLimited = 0;
        $failed = 0;

        foreach ($dueRows as $row) {
            $itemId = (int) ($row['item_id'] ?? 0);
            $priority = (int) ($row['priority'] ?? self::PRIORITY_CATALOG);
            $itemName = trim((string) ($row['market_hash_name'] ?? ''));

            if ($itemId <= 0 || $itemName === '') {
                continue;
            }

            if (!$this->acquireItemLock($itemId)) {
                continue;
            }

            $processed++;
            try {
                $snapshot = $this->pricingService->getLivePriceSnapshot($itemName);
                $warnings = $this->pricingService->consumeWarnings();

                $rateLimitWarning = $this->findRateLimitWarning($warnings);
                if ($rateLimitWarning !== null) {
                    $rateLimited++;
                    $this->markRateLimited($itemId, $priority, $rateLimitWarning['message'] ?? 'Rate limit');
                    continue;
                }

                $priceUsd = isset($snapshot['priceUsd']) ? (float) $snapshot['priceUsd'] : 0.0;
                $exchangeRateId = isset($snapshot['exchangeRateId']) ? (int) $snapshot['exchangeRateId'] : 0;
                if ($snapshot === null || $priceUsd <= 0.0 || $exchangeRateId <= 0) {
                    $failed++;
                    $this->markFailure($itemId, $priority, 'No valid live snapshot available.');
                    continue;
                }

                $hourBucket = (new \DateTimeImmutable('now'))->format('Y-m-d H:00:00');
                $priceSource = isset($snapshot['priceSource']) ? (string) $snapshot['priceSource'] : null;
                $this->priceHistoryRepository->upsertPrice(
                    $itemId,
                    $hourBucket,
                    $priceUsd,
                    $exchangeRateId,
                    $priceSource
                );

                $success++;
                $this->markSuccess($itemId, $priceSource);
            } catch (Throwable $exception) {
                $failed++;
                $message = $exception->getMessage();
                if ($this->looksLikeRateLimit($message)) {
                    $rateLimited++;
                    $failed--;
                    $this->markRateLimited($itemId, $priority, $message);
                    continue;
                }

                $this->markFailure($itemId, $priority, $message);
            }
        }

        return [
            'processed' => $processed,
            'success' => $success,
            'rateLimited' => $rateLimited,
            'failed' => $failed,
        ];
    }

    /**
     * @return list<array{item_id:int,priority:int}>
     */
    private function fetchPrioritizedItemRows(): array
    {
        $sql = "SELECT
                    i.id AS item_id,
                    CASE
                        WHEN inv.item_id IS NOT NULL THEN 1
                        WHEN wl.item_id IS NOT NULL THEN 2
                        ELSE 3
                    END AS priority
                FROM items i
                LEFT JOIN (SELECT DISTINCT item_id FROM investments WHERE item_id IS NOT NULL) inv
                    ON inv.item_id = i.id
                LEFT JOIN (SELECT DISTINCT item_id FROM watchlist WHERE item_id IS NOT NULL) wl
                    ON wl.item_id = i.id
                WHERE i.market_hash_name IS NOT NULL
                  AND i.market_hash_name <> ''
                ORDER BY priority ASC, i.id ASC";
        $stmt = $this->pdo->query($sql);
        $rows = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];

        return is_array($rows) ? $rows : [];
    }

    private function cleanupRemovedItems(): void
    {
        $this->pdo->exec(
            "DELETE q FROM item_price_refresh_queue q
             LEFT JOIN items i ON i.id = q.item_id
             WHERE i.id IS NULL"
        );
    }

    private function buildScheduledTime(
        \DateTimeImmutable $cycleStart,
        int $startMinute,
        int $endMinute,
        int $index,
        int $count,
        int $itemId
    ): \DateTimeImmutable {
        $range = max(1, $endMinute - $startMinute);
        $slotIndex = $count <= 1 ? 0.5 : ($index / max(1, $count - 1));
        $minuteInWindow = (int) floor($startMinute + ($slotIndex * max(0, $range - 1)));
        $jitterSeconds = abs(crc32((string) $itemId)) % 60;

        return $cycleStart
            ->modify("+{$minuteInWindow} minutes")
            ->modify("+{$jitterSeconds} seconds");
    }

    private function upsertQueueItem(int $itemId, int $priority, \DateTimeImmutable $scheduledAt): void
    {
        $sql = "INSERT INTO item_price_refresh_queue (
                    item_id, priority, next_attempt_at, last_planned_at, attempts, last_status, locked_until
                ) VALUES (?, ?, ?, NOW(), 0, 'planned', NULL)
                ON DUPLICATE KEY UPDATE
                    priority = VALUES(priority),
                    next_attempt_at = VALUES(next_attempt_at),
                    last_planned_at = NOW(),
                    locked_until = NULL,
                    updated_at = CURRENT_TIMESTAMP";
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([
            $itemId,
            $priority,
            $scheduledAt->format('Y-m-d H:i:s'),
        ]);
    }

    /**
     * @return list<array{item_id:int,priority:int,market_hash_name:string}>
     */
    private function fetchDueRows(int $limit): array
    {
        $sql = "SELECT q.item_id, q.priority, i.market_hash_name
                FROM item_price_refresh_queue q
                INNER JOIN items i ON i.id = q.item_id
                WHERE q.next_attempt_at <= NOW()
                  AND (q.locked_until IS NULL OR q.locked_until <= NOW())
                  AND i.market_hash_name IS NOT NULL
                  AND i.market_hash_name <> ''
                ORDER BY q.priority ASC, q.next_attempt_at ASC
                LIMIT ?";

        $stmt = $this->pdo->prepare($sql);
        $stmt->bindValue(1, $limit, PDO::PARAM_INT);
        $stmt->execute();
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        return is_array($rows) ? $rows : [];
    }

    private function acquireItemLock(int $itemId): bool
    {
        $sql = "UPDATE item_price_refresh_queue
                SET locked_until = DATE_ADD(NOW(), INTERVAL 2 MINUTE),
                    last_attempt_at = NOW(),
                    attempts = attempts + 1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE item_id = ?
                  AND (locked_until IS NULL OR locked_until <= NOW())";
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([$itemId]);

        return $stmt->rowCount() > 0;
    }

    private function markSuccess(int $itemId, ?string $priceSource): void
    {
        $sql = "UPDATE item_price_refresh_queue
                SET last_status = 'success',
                    last_error = NULL,
                    last_price_source = ?,
                    last_fetched_at = NOW(),
                    next_attempt_at = DATE_ADD(NOW(), INTERVAL 90 MINUTE),
                    attempts = 0,
                    locked_until = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE item_id = ?";
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([$priceSource, $itemId]);
    }

    private function markRateLimited(int $itemId, int $priority, string $message): void
    {
        $backoffMinutes = match ($priority) {
            self::PRIORITY_INVESTMENT => 5,
            self::PRIORITY_WATCHLIST => 15,
            default => 30,
        };

        $sql = "UPDATE item_price_refresh_queue
                SET last_status = 'rate_limited',
                    last_error = ?,
                    next_attempt_at = DATE_ADD(NOW(), INTERVAL {$backoffMinutes} MINUTE),
                    locked_until = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE item_id = ?";
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([substr($message, 0, 1000), $itemId]);
    }

    private function markFailure(int $itemId, int $priority, string $message): void
    {
        $backoffMinutes = match ($priority) {
            self::PRIORITY_INVESTMENT => 10,
            self::PRIORITY_WATCHLIST => 20,
            default => 40,
        };

        $sql = "UPDATE item_price_refresh_queue
                SET last_status = 'failed',
                    last_error = ?,
                    next_attempt_at = DATE_ADD(NOW(), INTERVAL {$backoffMinutes} MINUTE),
                    locked_until = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE item_id = ?";
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([substr($message, 0, 1000), $itemId]);
    }

    private function findRateLimitWarning(array $warnings): ?array
    {
        foreach ($warnings as $warning) {
            if (!is_array($warning)) {
                continue;
            }

            if ((int) ($warning['statusCode'] ?? 0) === 429) {
                return $warning;
            }
        }

        return null;
    }

    private function looksLikeRateLimit(string $message): bool
    {
        $normalized = strtolower($message);
        return str_contains($normalized, '429')
            || str_contains($normalized, 'rate limit')
            || str_contains($normalized, 'too many requests');
    }
}
