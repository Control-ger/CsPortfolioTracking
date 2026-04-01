<?php
declare(strict_types=1);

namespace App\Observability\Infrastructure\Persistence;

use App\Observability\Domain\LogEvent;
use DateTimeImmutable;
use DateTimeZone;
use PDO;
use PDOException;

final class ObservabilityEventRepository
{
    private bool $tableEnsured = false;

    public function __construct(
        private readonly PDO $pdo,
        private readonly int $defaultRetentionDays = 30
    ) {
    }

    public function ensureTable(): void
    {
        if ($this->tableEnsured) {
            return;
        }

        try {
            $this->pdo->exec($this->buildCreateTableSql('JSON'));
        } catch (PDOException) {
            $this->pdo->exec($this->buildCreateTableSql('LONGTEXT'));
        }

        $this->tableEnsured = true;
    }

    public function save(LogEvent $event): void
    {
        $this->ensureTable();

        $row = $event->toDatabaseRow();
        $stmt = $this->pdo->prepare(
            'INSERT INTO observability_events (
                timestamp_utc,
                level,
                category,
                event_name,
                message,
                request_id,
                method,
                route,
                status_code,
                duration_ms,
                context_json
            ) VALUES (
                :timestamp_utc,
                :level,
                :category,
                :event_name,
                :message,
                :request_id,
                :method,
                :route,
                :status_code,
                :duration_ms,
                :context_json
            )'
        );

        $stmt->execute($row);
    }

    public function findEvents(array $filters, int $limit = 100): array
    {
        $this->ensureTable();

        $clauses = [];
        $params = [];

        if (isset($filters['category']) && $filters['category'] !== '') {
            $clauses[] = 'category = :category';
            $params['category'] = (string) $filters['category'];
        }

        if (isset($filters['level']) && $filters['level'] !== '') {
            $clauses[] = 'level = :level';
            $params['level'] = (string) $filters['level'];
        }

        if (isset($filters['event']) && $filters['event'] !== '') {
            $clauses[] = 'event_name = :event_name';
            $params['event_name'] = (string) $filters['event'];
        }

        if (isset($filters['requestId']) && $filters['requestId'] !== '') {
            $clauses[] = 'request_id = :request_id';
            $params['request_id'] = (string) $filters['requestId'];
        }

        $from = $this->parseUtcDateTime($filters['from'] ?? null);
        if ($from !== null) {
            $clauses[] = 'timestamp_utc >= :from_ts';
            $params['from_ts'] = $from;
        }

        $to = $this->parseUtcDateTime($filters['to'] ?? null);
        if ($to !== null) {
            $clauses[] = 'timestamp_utc <= :to_ts';
            $params['to_ts'] = $to;
        }

        $sql = 'SELECT
            timestamp_utc,
            level,
            category,
            event_name,
            message,
            request_id,
            method,
            route,
            status_code,
            duration_ms,
            context_json
            FROM observability_events';

        if ($clauses !== []) {
            $sql .= ' WHERE ' . implode(' AND ', $clauses);
        }

        $sql .= ' ORDER BY timestamp_utc DESC, id DESC LIMIT :limit';
        $stmt = $this->pdo->prepare($sql);

        foreach ($params as $key => $value) {
            $stmt->bindValue(':' . $key, $value);
        }

        $stmt->bindValue(':limit', max(1, min($limit, 1000)), PDO::PARAM_INT);
        $stmt->execute();

        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        return array_map(
            fn(array $row): array => $this->mapRowToApiPayload($row),
            $rows
        );
    }

    public function pruneOldEvents(?int $retentionDays = null): int
    {
        $this->ensureTable();
        $days = $retentionDays ?? $this->defaultRetentionDays;
        if ($days <= 0) {
            $days = 30;
        }

        return (int) $this->pdo->exec(
            sprintf(
                'DELETE FROM observability_events
                 WHERE timestamp_utc < (UTC_TIMESTAMP() - INTERVAL %d DAY)',
                max(1, $days)
            )
        );
    }

    private function buildCreateTableSql(string $contextType): string
    {
        return sprintf(
            "CREATE TABLE IF NOT EXISTS observability_events (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                timestamp_utc DATETIME NOT NULL,
                level VARCHAR(16) NOT NULL,
                category VARCHAR(32) NOT NULL,
                event_name VARCHAR(128) NOT NULL,
                message VARCHAR(512) NOT NULL,
                request_id VARCHAR(64) DEFAULT NULL,
                method VARCHAR(16) DEFAULT NULL,
                route VARCHAR(255) DEFAULT NULL,
                status_code INT DEFAULT NULL,
                duration_ms INT DEFAULT NULL,
                context_json %s DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_ts (timestamp_utc),
                INDEX idx_level (level),
                INDEX idx_category (category),
                INDEX idx_event_name (event_name),
                INDEX idx_request_id (request_id),
                INDEX idx_route_status (route, status_code)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            $contextType
        );
    }

    private function parseUtcDateTime(mixed $value): ?string
    {
        if (!is_string($value) || trim($value) === '') {
            return null;
        }

        try {
            $dateTime = new DateTimeImmutable($value, new DateTimeZone('UTC'));
        } catch (\Throwable) {
            return null;
        }

        return $dateTime->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    }

    private function mapRowToApiPayload(array $row): array
    {
        $contextRaw = $row['context_json'] ?? null;
        $context = [];
        if (is_string($contextRaw) && trim($contextRaw) !== '') {
            $decodedContext = json_decode($contextRaw, true);
            if (is_array($decodedContext)) {
                $context = $decodedContext;
            } else {
                $context = ['contextDecodeFailed' => true];
            }
        }

        $timestampString = (string) ($row['timestamp_utc'] ?? '');
        $timestampUtc = $this->normalizeTimestamp($timestampString);

        return [
            'timestamp' => $timestampUtc,
            'level' => (string) ($row['level'] ?? ''),
            'category' => (string) ($row['category'] ?? ''),
            'event' => (string) ($row['event_name'] ?? ''),
            'message' => (string) ($row['message'] ?? ''),
            'requestId' => isset($row['request_id']) ? (string) $row['request_id'] : null,
            'method' => isset($row['method']) ? (string) $row['method'] : null,
            'route' => isset($row['route']) ? (string) $row['route'] : null,
            'statusCode' => isset($row['status_code']) ? (int) $row['status_code'] : null,
            'durationMs' => isset($row['duration_ms']) ? (int) $row['duration_ms'] : null,
            'context' => $context,
        ];
    }

    private function normalizeTimestamp(string $timestampString): string
    {
        if ($timestampString === '') {
            return gmdate('Y-m-d\TH:i:s\Z');
        }

        $timestamp = strtotime($timestampString . ' UTC');
        if ($timestamp === false) {
            return gmdate('Y-m-d\TH:i:s\Z');
        }

        return gmdate('Y-m-d\TH:i:s\Z', $timestamp);
    }
}
