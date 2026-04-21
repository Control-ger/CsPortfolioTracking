<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class CacheMaintenanceRepository
{
    private const LIVE_CACHE_MAX_AGE_HOURS = 72;      // Max 72h alt (dann als stale markiert)
    private const CATALOG_CACHE_MAX_AGE_HOURS = 168;  // Max 7d alt (quasi-statisch)
    // Price History: Unbegrenzt aufbewahren — historische Daten sind wertvoll für Trends!
    // Wenn DB-Speicher knapp wird, kan man später noch ein sehr hohes Limit setzen (z.B. 10+ Jahre)

    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * Bereinigt den Live-Cache von Einträgen die älter als MAX_AGE_HOURS sind.
     * Gibt die Anzahl der gelöschten Einträge zurück.
     */
    public function cleanupLiveCache(): int
    {
        $cutoffTime = date('Y-m-d H:i:s', time() - (self::LIVE_CACHE_MAX_AGE_HOURS * 3600));
        $sql = 'DELETE FROM item_live_cache WHERE fetched_at < ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$cutoffTime]);
            $deletedCount = $stmt->rowCount();

            if ($deletedCount > 0) {
                RepositoryObservability::migrationColumnAdded(
                    self::class,
                    'item_live_cache',
                    'cleanup',
                    ['deletedRows' => $deletedCount, 'cutoffTime' => $cutoffTime]
                );
            }

            return $deletedCount;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['cutoffTime' => $cutoffTime]
            );
            throw $exception;
        }
    }

    /**
     * Bereinigt den Katalog-Cache von Einträgen die älter als MAX_AGE_HOURS sind.
     */
    public function cleanupCatalogCache(): int
    {
        $cutoffTime = date('Y-m-d H:i:s', time() - (self::CATALOG_CACHE_MAX_AGE_HOURS * 3600));
        $sql = 'DELETE FROM item_catalog WHERE cached_at < ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$cutoffTime]);
            $deletedCount = $stmt->rowCount();

            if ($deletedCount > 0) {
                RepositoryObservability::migrationColumnAdded(
                    self::class,
                    'item_catalog',
                    'cleanup',
                    ['deletedRows' => $deletedCount, 'cutoffTime' => $cutoffTime]
                );
            }

            return $deletedCount;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['cutoffTime' => $cutoffTime]
            );
            throw $exception;
        }
    }

    /**
     * Price History wird NICHT gelöscht — historische Daten sind wertvoll für Trends und Analysen.
     * Falls DB-Speicher kritisch wird, kann man hier später ein hohes Limit setzen (z.B. 10 Jahre+).
     * Momentan: Unbegrenzte Aufbewahrung.
     */
    public function cleanupPriceHistory(): int
    {
        // Keine Bereinigung — alle Daten behalten!
        return 0;
    }

    /**
     * Führt alle Cleanups durch und gibt Statistik zurück.
     */
    public function runAllCleanups(): array
    {
        $startTime = microtime(true);

        $liveCacheDeleted = $this->cleanupLiveCache();
        $catalogCacheDeleted = $this->cleanupCatalogCache();
        $priceHistoryDeleted = $this->cleanupPriceHistory();

        $durationMs = (int) ((microtime(true) - $startTime) * 1000);

        $cleanupStats = [
            'liveCacheDeleted' => $liveCacheDeleted,
            'catalogCacheDeleted' => $catalogCacheDeleted,
            'priceHistoryDeleted' => $priceHistoryDeleted,
            'durationMs' => $durationMs,
        ];

        $this->logMaintenanceRun($cleanupStats);

        return [
            'liveCacheDeleted' => $liveCacheDeleted,
            'catalogCacheDeleted' => $catalogCacheDeleted,
            'priceHistoryDeleted' => $priceHistoryDeleted,
            'executedAt' => date('Y-m-d H:i:s'),
            'durationMs' => $durationMs,
        ];
    }

    /**
     * Gibt DB-Statistiken zurück (Cache-Größe, Anzahl Einträge, etc.).
     */
    public function getCacheStatistics(): array
    {
        try {
            $liveStats = $this->pdo->query(
                'SELECT COUNT(*) as count,
                        MIN(fetched_at) as oldest,
                        MAX(fetched_at) as newest
                 FROM item_live_cache'
            )?->fetch(\PDO::FETCH_ASSOC) ?: [];

            $catalogStats = $this->pdo->query(
                'SELECT COUNT(*) as count,
                        MIN(cached_at) as oldest,
                        MAX(cached_at) as newest
                 FROM item_catalog'
            )?->fetch(\PDO::FETCH_ASSOC) ?: [];

            $priceStats = $this->pdo->query(
                'SELECT COUNT(*) as count,
                        MIN(date) as oldest,
                        MAX(date) as newest
                 FROM price_history'
            )?->fetch(\PDO::FETCH_ASSOC) ?: [];

            return [
                'liveCache' => [
                    'count' => (int) ($liveStats['count'] ?? 0),
                    'oldest' => $liveStats['oldest'] ?? null,
                    'newest' => $liveStats['newest'] ?? null,
                    'maxAgeHours' => self::LIVE_CACHE_MAX_AGE_HOURS,
                    'strategy' => 'Refresh hourly, keep for 72 hours',
                ],
                'catalogCache' => [
                    'count' => (int) ($catalogStats['count'] ?? 0),
                    'oldest' => $catalogStats['oldest'] ?? null,
                    'newest' => $catalogStats['newest'] ?? null,
                    'maxAgeHours' => self::CATALOG_CACHE_MAX_AGE_HOURS,
                    'strategy' => 'Quasi-static, keep for 7 days',
                ],
                'priceHistory' => [
                    'count' => (int) ($priceStats['count'] ?? 0),
                    'oldest' => $priceStats['oldest'] ?? null,
                    'newest' => $priceStats['newest'] ?? null,
                    'retentionDays' => null,
                    'strategy' => 'Keep ALL — valuable for trend analysis',
                ],
            ];
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                'SELECT statistics',
                $exception
            );
            return [];
        }
    }

    /**
     * Speichert Cache-Maintenance Logs in der Datenbank für Monitoring/Debugging.
     */
    public function logMaintenanceRun(array $cleanupStats): void
    {
        $this->ensureCacheMaintenanceLogsTable();

        $sql = 'INSERT INTO cache_maintenance_logs (
                    executed_at,
                    live_cache_deleted,
                    catalog_cache_deleted,
                    price_history_deleted,
                    duration_ms
                ) VALUES (?, ?, ?, ?, ?)';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([
                date('Y-m-d H:i:s'),
                (int) ($cleanupStats['liveCacheDeleted'] ?? 0),
                (int) ($cleanupStats['catalogCacheDeleted'] ?? 0),
                (int) ($cleanupStats['priceHistoryDeleted'] ?? 0),
                (int) ($cleanupStats['durationMs'] ?? 0),
            ]);
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['stats' => $cleanupStats]
            );
            // Nicht werfen — Logging sollte nicht den Hauptprozess crashen
        }
    }

    /**
     * Gibt die letzten Cache-Maintenance-Logs zurück (für Debug-Panel).
     */
    public function getMaintenanceLogs(int $limit = 50): array
    {
        $this->ensureCacheMaintenanceLogsTable();

        $sql = 'SELECT executed_at, live_cache_deleted, catalog_cache_deleted,
                       price_history_deleted, duration_ms
                FROM cache_maintenance_logs
                ORDER BY executed_at DESC
                LIMIT ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$limit]);
            return $stmt->fetchAll(\PDO::FETCH_ASSOC) ?: [];
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['limit' => $limit]
            );
            return [];
        }
    }

    /**
     * Gibt Statistik über Cache-Maintenance-Runs zurück.
     */
    public function getMaintenanceStats(int $lastDaysCount = 7): array
    {
        $this->ensureCacheMaintenanceLogsTable();

        $cutoffDate = date('Y-m-d H:i:s', time() - ($lastDaysCount * 86400));
        $sql = 'SELECT
                    COUNT(*) as total_runs,
                    SUM(live_cache_deleted) as total_live_deleted,
                    SUM(catalog_cache_deleted) as total_catalog_deleted,
                    SUM(price_history_deleted) as total_price_deleted,
                    AVG(duration_ms) as avg_duration_ms,
                    MAX(duration_ms) as max_duration_ms,
                    MIN(duration_ms) as min_duration_ms
                FROM cache_maintenance_logs
                WHERE executed_at > ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$cutoffDate]);
            return $stmt->fetch(\PDO::FETCH_ASSOC) ?: [];
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['cutoffDate' => $cutoffDate, 'lastDaysCount' => $lastDaysCount]
            );
            return [];
        }
    }

    private function ensureCacheMaintenanceLogsTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS cache_maintenance_logs (
                    id BIGINT AUTO_INCREMENT PRIMARY KEY,
                    executed_at DATETIME NOT NULL,
                    live_cache_deleted INT DEFAULT 0,
                    catalog_cache_deleted INT DEFAULT 0,
                    price_history_deleted INT DEFAULT 0,
                    duration_ms INT DEFAULT 0,
                    INDEX idx_executed_at (executed_at DESC)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            RepositoryObservability::schemaEnsured(self::class, 'cache_maintenance_logs');
        } catch (Throwable $exception) {
            // Tabelle existiert wahrscheinlich bereits
            if (strpos($exception->getMessage(), 'already exists') === false) {
                RepositoryObservability::queryFailed(
                    self::class,
                    __FUNCTION__,
                    $sql,
                    $exception,
                    ['table' => 'cache_maintenance_logs']
                );
            }
        }
    }
}
