<?php
declare(strict_types=1);

namespace App\Application\Service;

use PDO;
use Throwable;

final class SyncService
{
    /** @var array<string, bool> */
    private const ALLOWED_TABLES = [
        'investments' => true,
        'watchlist_items' => true,
    ];

    public function __construct(
        private readonly PDO $pdo,
        private readonly SyncEntityService $syncEntityService,
    ) {
    }

    public function ensureTables(): void
    {
        $this->pdo->exec(
            "CREATE TABLE IF NOT EXISTS sync_entities (
                user_id INT NOT NULL,
                entity_table VARCHAR(64) NOT NULL,
                entity_id VARCHAR(191) NOT NULL,
                payload_json LONGTEXT NOT NULL,
                deleted TINYINT(1) NOT NULL DEFAULT 0,
                server_revision INT NOT NULL DEFAULT 1,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, entity_table, entity_id),
                INDEX idx_sync_entities_pull (user_id, updated_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );

        $this->pdo->exec(
            "CREATE TABLE IF NOT EXISTS sync_idempotency (
                user_id INT NOT NULL,
                idempotency_key VARCHAR(191) NOT NULL,
                request_hash CHAR(64) NOT NULL,
                result_json LONGTEXT NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, idempotency_key),
                INDEX idx_sync_idempotency_created (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }

    public function push(int $userId, array $changes): array
    {
        $this->ensureTables();
        // These DDL helpers live on SyncEntityService (the entity layer owns the
        // domain tables). Calling them on $this would fatal with "undefined
        // method" — which is exactly what surfaced once Variante C let the push
        // path actually execute against the server.
        $this->syncEntityService->ensureItemsTable();
        $this->syncEntityService->ensureInvestmentsTable();
        $this->syncEntityService->ensureWatchlistTable();

        $normalizedChanges = $this->normalizeChanges($changes);
        $results = [];

        foreach ($normalizedChanges as $change) {
            $results[] = $this->applyChange($userId, $change);
        }

        return [
            'results' => $results,
            'appliedCount' => count(array_filter($results, static fn (array $row): bool => $row['status'] === 'applied')),
            'conflictCount' => count(array_filter($results, static fn (array $row): bool => $row['status'] === 'conflict')),
            'rejectedCount' => count(array_filter($results, static fn (array $row): bool => $row['status'] === 'rejected')),
        ];
    }

    public function pull(int $userId, ?string $since, int $limit): array
    {
        $this->ensureTables();
        $resolvedLimit = max(1, min($limit, 1000));
        $resolvedSince = $this->resolveSince($since);
        $limitSql = (string) (int) $resolvedLimit;

        $stmt = $this->pdo->prepare(
            "SELECT entity_table, entity_id, payload_json, deleted, server_revision, updated_at
             FROM sync_entities
             WHERE user_id = ? AND updated_at > ?
             ORDER BY updated_at ASC, entity_table ASC, entity_id ASC
             LIMIT {$limitSql}"
        );
        $stmt->execute([$userId, $resolvedSince]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $changes = [];
        foreach ($rows as $row) {
            $changes[] = [
                'table' => (string) $row['entity_table'],
                'id' => (string) $row['entity_id'],
                'op' => ((int) $row['deleted'] === 1) ? 'delete' : 'upsert',
                'payload' => $this->decodePayload((string) $row['payload_json']),
                'serverRevision' => (int) $row['server_revision'],
                'updatedAt' => $this->toIso8601((string) $row['updated_at']),
            ];
        }

        return [
            'serverTime' => gmdate('c'),
            'changes' => $changes,
            'count' => count($changes),
        ];
    }

    public function upsertServerEntity(int $userId, string $table, string $id, array $payload): array
    {
        $normalizedTable = strtolower(trim($table));
        $normalizedId = trim($id);
        if (!isset(self::ALLOWED_TABLES[$normalizedTable])) {
            throw new \InvalidArgumentException("Invalid table: {$table}");
        }
        if ($normalizedId === '') {
            throw new \InvalidArgumentException('Missing id');
        }

        return $this->storeServerEntity($userId, $normalizedTable, $normalizedId, false, $payload);
    }

    public function deleteServerEntity(int $userId, string $table, string $id): array
    {
        $normalizedTable = strtolower(trim($table));
        $normalizedId = trim($id);
        if (!isset(self::ALLOWED_TABLES[$normalizedTable])) {
            throw new \InvalidArgumentException("Invalid table: {$table}");
        }
        if ($normalizedId === '') {
            throw new \InvalidArgumentException('Missing id');
        }

        return $this->storeServerEntity($userId, $normalizedTable, $normalizedId, true, []);
    }

    private function applyChange(int $userId, array $change): array
    {
        $requestHash = hash(
            'sha256',
            json_encode(
                [
                    'op' => $change['op'],
                    'table' => $change['table'],
                    'id' => $change['id'],
                    'payload' => $change['payload'],
                    'clientRevision' => $change['clientRevision'],
                ],
                JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
            )
        );

        $idempotencyRow = $this->findIdempotency($userId, (string) $change['idempotencyKey']);
        if ($idempotencyRow !== null) {
            if ((string) $idempotencyRow['request_hash'] !== $requestHash) {
                return $this->finalizeChangeResult([
                    'status' => 'rejected',
                    'table' => $change['table'],
                    'id' => $change['id'],
                    'errorCode' => 'IDEMPOTENCY_KEY_REUSE',
                    'message' => 'Idempotency key reused with different payload.',
                ], $change);
            }

            return $this->finalizeChangeResult(
                $this->decodePayload((string) $idempotencyRow['result_json']),
                $change
            );
        }

        $this->pdo->beginTransaction();
        try {
            $entity = $this->findEntityForUpdate($userId, (string) $change['table'], (string) $change['id']);
            $existingPayload = $entity ? $this->decodePayload((string) ($entity['payload_json'] ?? '{}')) : [];
            $currentRevision = $entity ? (int) $entity['server_revision'] : 0;
            $clientRevision = (int) $change['clientRevision'];

            if ($clientRevision > 0 && $currentRevision > 0 && $clientRevision < $currentRevision) {
                $result = $this->finalizeChangeResult([
                    'status' => 'conflict',
                    'table' => $change['table'],
                    'id' => $change['id'],
                    'serverRevision' => $currentRevision,
                    'updatedAt' => $this->toIso8601((string) $entity['updated_at']),
                ], $change);
                $this->insertIdempotency($userId, (string) $change['idempotencyKey'], $requestHash, $result);
                $this->pdo->commit();
                return $result;
            }

            $nextRevision = max(1, $currentRevision + 1);
            $deleted = $change['op'] === 'delete' ? 1 : 0;
            $domainPayload = $this->applyDomainChange(
                $userId,
                (string) $change['table'],
                (string) $change['op'],
                (string) $change['id'],
                is_array($change['payload']) ? $change['payload'] : [],
                $existingPayload
            );
            $payloadToPersist = $deleted ? $domainPayload : $domainPayload;
            $payload = $this->encodePayload($payloadToPersist);

            $stmt = $this->pdo->prepare(
                "INSERT INTO sync_entities (user_id, entity_table, entity_id, payload_json, deleted, server_revision)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    payload_json = VALUES(payload_json),
                    deleted = VALUES(deleted),
                    server_revision = VALUES(server_revision),
                    updated_at = CURRENT_TIMESTAMP"
            );
            $stmt->execute([
                $userId,
                $change['table'],
                $change['id'],
                $payload,
                $deleted,
                $nextRevision,
            ]);

            $updatedRow = $this->findEntityForUpdate($userId, (string) $change['table'], (string) $change['id']);
            $result = $this->finalizeChangeResult([
                'status' => 'applied',
                'table' => $change['table'],
                'id' => $change['id'],
                'serverRevision' => $updatedRow ? (int) $updatedRow['server_revision'] : $nextRevision,
                'updatedAt' => $updatedRow ? $this->toIso8601((string) $updatedRow['updated_at']) : gmdate('c'),
            ], $change);

            $this->insertIdempotency($userId, (string) $change['idempotencyKey'], $requestHash, $result);
            $this->pdo->commit();
            return $result;
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            return $this->finalizeChangeResult([
                'status' => 'rejected',
                'table' => $change['table'],
                'id' => $change['id'],
                'errorCode' => 'SYNC_APPLY_FAILED',
                'message' => $exception->getMessage(),
            ], $change);
        }
    }

    private function finalizeChangeResult(array $result, array $change): array
    {
        $result['table'] = (string) ($result['table'] ?? $change['table'] ?? '');
        $result['id'] = (string) ($result['id'] ?? $change['id'] ?? '');
        $result['op'] = (string) ($result['op'] ?? $change['op'] ?? 'upsert');
        $result['idempotencyKey'] = (string) ($change['idempotencyKey'] ?? $result['idempotencyKey'] ?? '');
        $result['clientRevision'] = (int) ($result['clientRevision'] ?? $change['clientRevision'] ?? 0);

        return $result;
    }

    private function applyDomainChange(
        int $userId,
        string $table,
        string $op,
        string $entityId,
        array $payload,
        array $existingPayload
    ): array {
        return $this->syncEntityService->applyDomainChange($userId, $table, $op, $entityId, $payload, $existingPayload);
    }

    private function storeServerEntity(int $userId, string $table, string $id, bool $deleted, array $payload): array
    {
        $this->ensureTables();
        $this->pdo->beginTransaction();
        try {
            $entity = $this->findEntityForUpdate($userId, $table, $id);
            $currentRevision = $entity ? (int) $entity['server_revision'] : 0;
            $nextRevision = max(1, $currentRevision + 1);

            $stmt = $this->pdo->prepare(
                "INSERT INTO sync_entities (user_id, entity_table, entity_id, payload_json, deleted, server_revision)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    payload_json = VALUES(payload_json),
                    deleted = VALUES(deleted),
                    server_revision = VALUES(server_revision),
                    updated_at = CURRENT_TIMESTAMP"
            );
            $stmt->execute([
                $userId,
                $table,
                $id,
                $this->encodePayload($deleted ? [] : $payload),
                $deleted ? 1 : 0,
                $nextRevision,
            ]);

            $updatedRow = $this->findEntityForUpdate($userId, $table, $id);
            $this->pdo->commit();

            return [
                'table' => $table,
                'id' => $id,
                'serverRevision' => $updatedRow ? (int) $updatedRow['server_revision'] : $nextRevision,
                'updatedAt' => $updatedRow ? $this->toIso8601((string) $updatedRow['updated_at']) : gmdate('c'),
            ];
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
    }

    private function normalizeChanges(array $changes): array
    {
        $normalized = [];
        foreach ($changes as $index => $change) {
            if (!is_array($change)) {
                throw new \InvalidArgumentException("Change at index {$index} must be an object.");
            }

            $op = strtolower(trim((string) ($change['op'] ?? '')));
            $table = strtolower(trim((string) ($change['table'] ?? '')));
            $id = trim((string) ($change['id'] ?? ''));
            $idempotencyKey = trim((string) ($change['idempotencyKey'] ?? ''));
            $clientRevision = (int) ($change['clientRevision'] ?? 0);
            $payload = $change['payload'] ?? [];

            if (!in_array($op, ['upsert', 'delete'], true)) {
                throw new \InvalidArgumentException("Invalid op at index {$index}: {$op}");
            }
            if (!isset(self::ALLOWED_TABLES[$table])) {
                throw new \InvalidArgumentException("Invalid table at index {$index}: {$table}");
            }
            if ($id === '') {
                throw new \InvalidArgumentException("Missing id at index {$index}");
            }
            if ($idempotencyKey === '' || strlen($idempotencyKey) > 191) {
                throw new \InvalidArgumentException("Invalid idempotencyKey at index {$index}");
            }
            if ($op === 'upsert' && !is_array($payload)) {
                throw new \InvalidArgumentException("Payload for upsert at index {$index} must be an object.");
            }
            if ($op === 'delete') {
                $payload = [];
            }

            $normalized[] = [
                'op' => $op,
                'table' => $table,
                'id' => $id,
                'payload' => $payload,
                'idempotencyKey' => $idempotencyKey,
                'clientRevision' => max(0, $clientRevision),
            ];
        }

        return $normalized;
    }

    private function findEntityForUpdate(int $userId, string $table, string $id): ?array
    {
        $stmt = $this->pdo->prepare(
            "SELECT user_id, entity_table, entity_id, payload_json, deleted, server_revision, updated_at
             FROM sync_entities
             WHERE user_id = ? AND entity_table = ? AND entity_id = ?
             FOR UPDATE"
        );
        $stmt->execute([$userId, $table, $id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row !== false ? $row : null;
    }

    private function findIdempotency(int $userId, string $idempotencyKey): ?array
    {
        $stmt = $this->pdo->prepare(
            "SELECT user_id, idempotency_key, request_hash, result_json
             FROM sync_idempotency
             WHERE user_id = ? AND idempotency_key = ?"
        );
        $stmt->execute([$userId, $idempotencyKey]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row !== false ? $row : null;
    }

    private function insertIdempotency(int $userId, string $idempotencyKey, string $requestHash, array $result): void
    {
        $stmt = $this->pdo->prepare(
            "INSERT INTO sync_idempotency (user_id, idempotency_key, request_hash, result_json)
             VALUES (?, ?, ?, ?)"
        );
        $stmt->execute([$userId, $idempotencyKey, $requestHash, $this->encodePayload($result)]);
    }

    private function encodePayload(array $payload): string
    {
        return json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}';
    }

    private function decodePayload(string $json): array
    {
        $decoded = json_decode($json, true);
        return is_array($decoded) ? $decoded : [];
    }

    private function resolveSince(?string $since): string
    {
        if (!is_string($since) || trim($since) === '') {
            return '1970-01-01 00:00:00';
        }

        $timestamp = strtotime($since);
        if ($timestamp === false) {
            throw new \InvalidArgumentException('Invalid since parameter. Expected ISO8601 timestamp.');
        }

        return gmdate('Y-m-d H:i:s', $timestamp);
    }

    private function toIso8601(string $timestamp): string
    {
        $ts = strtotime($timestamp);
        if ($ts === false) {
            return gmdate('c');
        }
        return gmdate('c', $ts);
    }
}
