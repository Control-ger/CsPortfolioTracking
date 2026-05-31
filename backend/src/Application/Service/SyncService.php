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

    /** @var array<int, bool> */
    private array $csfloatLivePriceAvailabilityCache = [];

    public function __construct(private readonly PDO $pdo)
    {
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
        $this->ensureItemsTable();
        $this->ensureInvestmentsTable();
        $this->ensureWatchlistTable();

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
        return match ($table) {
            'investments' => $this->applyInvestmentChange($userId, $op, $entityId, $payload, $existingPayload),
            'watchlist_items' => $this->applyWatchlistChange($userId, $op, $entityId, $payload, $existingPayload),
            default => $payload,
        };
    }

    private function applyInvestmentChange(
        int $userId,
        string $op,
        string $entityId,
        array $payload,
        array $existingPayload
    ): array {

        if ($op === 'delete') {
            $this->deleteInvestmentForSync($userId, $entityId, $payload, $existingPayload);
            return $existingPayload;
        }

        $resolvedName = trim((string) ($payload['marketHashName'] ?? $payload['name'] ?? $existingPayload['name'] ?? ''));
        if ($resolvedName === '') {
            throw new \InvalidArgumentException('Investment sync upsert requires name or marketHashName.');
        }

        $resolvedType = trim((string) ($payload['type'] ?? $existingPayload['type'] ?? 'skin'));
        if ($resolvedType === '') {
            $resolvedType = 'skin';
        }

        $candidateServerId = $this->extractPositiveInt($payload['serverId'] ?? null)
            ?? $this->extractPositiveInt($existingPayload['serverId'] ?? null)
            ?? $this->extractPositiveInt($entityId);
        $targetInvestment = $candidateServerId !== null
            ? $this->findInvestmentByIdForUser($userId, $candidateServerId)
            : null;

        $itemId = $this->resolveItemIdForSync($payload, $resolvedName, $resolvedType);
        $platform = $this->normalizePlatform((string) ($payload['platform'] ?? $payload['source'] ?? $existingPayload['platform'] ?? 'desktop_sync'));
        $externalTradeId = $this->resolveExternalTradeId($entityId, $payload, $existingPayload);
        $fundingMode = $this->normalizeFundingMode((string) ($payload['fundingMode'] ?? $existingPayload['fundingMode'] ?? 'wallet_funded'));
        $quantity = max(1, (int) ($payload['quantity'] ?? $existingPayload['quantity'] ?? 1));
        $buyPriceUsd = $this->normalizePriceUsd($payload, $existingPayload);
        $purchasedAt = $this->normalizeDateTime((string) ($payload['purchasedAt'] ?? $existingPayload['purchasedAt'] ?? ''));

        if ($targetInvestment === null) {
            $targetInvestment = $this->findInvestmentByExternalTrade($userId, $platform, $externalTradeId);
        }

        $skinBaronTransferId = $this->resolveSkinBaronTransferId($payload, $existingPayload);
        $skinBaronOfferLink = $this->resolveSkinBaronOfferLink($payload, $existingPayload);
        if (
            $targetInvestment === null
            && $platform === 'skinbaron'
            && $skinBaronTransferId !== null
            && $skinBaronOfferLink !== null
        ) {
            $targetInvestment = $this->findSkinBaronInvestmentByTransferOffer(
                $userId,
                $skinBaronTransferId,
                $skinBaronOfferLink
            );
        }

        $existingExternalTradeId = trim((string) ($targetInvestment['external_trade_id'] ?? ''));
        if ($existingExternalTradeId !== '') {
            $externalTradeId = mb_substr($existingExternalTradeId, 0, 255);
        }

        if ($platform === 'skinbaron') {
            $existingItemId = $this->extractPositiveInt($targetInvestment['item_id'] ?? null);
            if ($existingItemId !== null && $existingItemId !== $itemId) {
                $existingHasCsfloatPrice = $this->hasCsfloatLivePriceForItem($existingItemId);
                $candidateHasCsfloatPrice = $this->hasCsfloatLivePriceForItem($itemId);
                // Guard against regressions from stale/ambiguous local payloads:
                // never replace a priced SkinBaron mapping with an unpriced one.
                if ($existingHasCsfloatPrice && !$candidateHasCsfloatPrice) {
                    $itemId = $existingItemId;
                }
            }
        }

        $mergedPayload = $this->mergeExcludedFlagsForInvestmentSync(
            $payload,
            $existingPayload,
            $targetInvestment,
            $platform,
            $externalTradeId
        );

        if ($targetInvestment !== null) {
            $stmt = $this->pdo->prepare(
                'UPDATE investments
                 SET item_id = ?, buy_price_usd = ?, quantity = ?, funding_mode = ?,
                     platform = ?, external_trade_id = ?, purchased_at = ?, raw_payload_json = ?
                 WHERE user_id = ? AND id = ?'
            );
            $stmt->execute([
                $itemId,
                $buyPriceUsd,
                $quantity,
                $fundingMode,
                $platform,
                $externalTradeId,
                $purchasedAt,
                $this->encodePayload($mergedPayload),
                $userId,
                (int) $targetInvestment['id'],
            ]);
            $row = $this->findInvestmentByIdForUser($userId, (int) $targetInvestment['id']);
        } else {
            $stmt = $this->pdo->prepare(
                'INSERT INTO investments (
                    user_id,
                    item_id,
                    buy_price_usd,
                    quantity,
                    funding_mode,
                    platform,
                    external_trade_id,
                    purchased_at,
                    raw_payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    user_id = VALUES(user_id),
                    item_id = VALUES(item_id),
                    buy_price_usd = VALUES(buy_price_usd),
                    quantity = VALUES(quantity),
                    funding_mode = VALUES(funding_mode),
                    platform = VALUES(platform),
                    external_trade_id = VALUES(external_trade_id),
                    purchased_at = VALUES(purchased_at),
                    raw_payload_json = VALUES(raw_payload_json)'
            );
            $stmt->execute([
                $userId,
                $itemId,
                $buyPriceUsd,
                $quantity,
                $fundingMode,
                $platform,
                $externalTradeId,
                $purchasedAt,
                $this->encodePayload($mergedPayload),
            ]);
            $row = $this->findInvestmentByExternalTrade($userId, $platform, $externalTradeId);
        }
        $serverId = $row ? (int) ($row['id'] ?? 0) : null;

        return [
            ...$mergedPayload,
            'id' => $entityId,
            'userId' => (string) $userId,
            'itemId' => (string) $itemId,
            'name' => $resolvedName,
            'marketHashName' => $resolvedName,
            'type' => $resolvedType,
            'quantity' => $quantity,
            'buyPriceUsd' => $buyPriceUsd,
            'fundingMode' => $fundingMode,
            'platform' => $platform,
            'externalTradeId' => $externalTradeId,
            'bucket' => $this->normalizeBucket((string) ($mergedPayload['bucket'] ?? 'investment')),
            'purchasedAt' => $purchasedAt,
            'serverId' => $serverId,
            'updatedAt' => gmdate('c'),
        ];
    }

    private function mergeExcludedFlagsForInvestmentSync(
        array $payload,
        array $existingPayload,
        ?array $existingInvestmentRow,
        string $platform,
        string $externalTradeId
    ): array {
        $merged = $payload;
        $existingRowPayload = $this->decodePayload((string) ($existingInvestmentRow['raw_payload_json'] ?? '{}'));

        if (!array_key_exists('excluded', $merged)) {
            if (array_key_exists('excluded', $existingPayload)) {
                $merged['excluded'] = $this->toBooleanFlag($existingPayload['excluded']);
            } elseif (array_key_exists('excluded', $existingRowPayload)) {
                $merged['excluded'] = $this->toBooleanFlag($existingRowPayload['excluded']);
            }
        }

        if (!array_key_exists('isExcluded', $merged)) {
            if (array_key_exists('isExcluded', $existingPayload)) {
                $merged['isExcluded'] = $this->toBooleanFlag($existingPayload['isExcluded']);
            } elseif (array_key_exists('isExcluded', $existingRowPayload)) {
                $merged['isExcluded'] = $this->toBooleanFlag($existingRowPayload['isExcluded']);
            }
        }

        if (array_key_exists('excluded', $merged) && !array_key_exists('isExcluded', $merged)) {
            $merged['isExcluded'] = $this->toBooleanFlag($merged['excluded']);
        } elseif (!array_key_exists('excluded', $merged) && array_key_exists('isExcluded', $merged)) {
            $merged['excluded'] = $this->toBooleanFlag($merged['isExcluded']);
        } elseif (array_key_exists('excluded', $merged) && array_key_exists('isExcluded', $merged)) {
            $normalized = $this->toBooleanFlag($merged['excluded']);
            $merged['excluded'] = $normalized;
            $merged['isExcluded'] = $normalized;
        }

        if (!array_key_exists('platform', $merged) || trim((string) $merged['platform']) === '') {
            $merged['platform'] = $platform;
        }
        if (!array_key_exists('externalTradeId', $merged) || trim((string) $merged['externalTradeId']) === '') {
            $merged['externalTradeId'] = $externalTradeId;
        }
        if (!array_key_exists('bucket', $merged)) {
            if (array_key_exists('bucket', $existingPayload)) {
                $merged['bucket'] = $this->normalizeBucket((string) $existingPayload['bucket']);
            } elseif (array_key_exists('bucket', $existingRowPayload)) {
                $merged['bucket'] = $this->normalizeBucket((string) $existingRowPayload['bucket']);
            } else {
                $merged['bucket'] = $platform === 'steam_inventory' ? 'inventory' : 'investment';
            }
        } else {
            $merged['bucket'] = $this->normalizeBucket((string) $merged['bucket']);
        }

        if (!array_key_exists('overpayEnabled', $merged)) {
            if (array_key_exists('overpayEnabled', $existingPayload)) {
                $merged['overpayEnabled'] = $this->toBooleanFlag($existingPayload['overpayEnabled']);
            } elseif (array_key_exists('overpayEnabled', $existingRowPayload)) {
                $merged['overpayEnabled'] = $this->toBooleanFlag($existingRowPayload['overpayEnabled']);
            } elseif (array_key_exists('isOverpayCandidate', $existingPayload)) {
                $merged['overpayEnabled'] = $this->toBooleanFlag($existingPayload['isOverpayCandidate']);
            } elseif (array_key_exists('isOverpayCandidate', $existingRowPayload)) {
                $merged['overpayEnabled'] = $this->toBooleanFlag($existingRowPayload['isOverpayCandidate']);
            }
        }
        if (!array_key_exists('isOverpayCandidate', $merged) && array_key_exists('overpayEnabled', $merged)) {
            $merged['isOverpayCandidate'] = $this->toBooleanFlag($merged['overpayEnabled']);
        } elseif (array_key_exists('isOverpayCandidate', $merged) && !array_key_exists('overpayEnabled', $merged)) {
            $merged['overpayEnabled'] = $this->toBooleanFlag($merged['isOverpayCandidate']);
        } elseif (array_key_exists('isOverpayCandidate', $merged) && array_key_exists('overpayEnabled', $merged)) {
            $normalizedOverpayFlag = $this->toBooleanFlag($merged['overpayEnabled']);
            $merged['overpayEnabled'] = $normalizedOverpayFlag;
            $merged['isOverpayCandidate'] = $normalizedOverpayFlag;
        }

        if (!array_key_exists('overpayFloorEur', $merged)) {
            if (array_key_exists('overpayFloorEur', $existingPayload)) {
                $merged['overpayFloorEur'] = is_numeric($existingPayload['overpayFloorEur'])
                    ? max(0.0, round((float) $existingPayload['overpayFloorEur'], 2))
                    : null;
            } elseif (array_key_exists('overpayFloorEur', $existingRowPayload)) {
                $merged['overpayFloorEur'] = is_numeric($existingRowPayload['overpayFloorEur'])
                    ? max(0.0, round((float) $existingRowPayload['overpayFloorEur'], 2))
                    : null;
            }
        } elseif (!is_numeric($merged['overpayFloorEur'] ?? null)) {
            $merged['overpayFloorEur'] = null;
        } else {
            $merged['overpayFloorEur'] = max(0.0, round((float) $merged['overpayFloorEur'], 2));
        }

        if (!array_key_exists('overpayNote', $merged)) {
            if (array_key_exists('overpayNote', $existingPayload)) {
                $merged['overpayNote'] = trim((string) $existingPayload['overpayNote']);
            } elseif (array_key_exists('overpayNote', $existingRowPayload)) {
                $merged['overpayNote'] = trim((string) $existingRowPayload['overpayNote']);
            }
        } else {
            $merged['overpayNote'] = trim((string) $merged['overpayNote']);
        }
        if (array_key_exists('overpayNote', $merged) && $merged['overpayNote'] === '') {
            $merged['overpayNote'] = null;
        }

        return $merged;
    }

    private function applyWatchlistChange(
        int $userId,
        string $op,
        string $entityId,
        array $payload,
        array $existingPayload
    ): array {

        if ($op === 'delete') {
            $this->deleteWatchlistForSync($userId, $entityId, $payload, $existingPayload);
            return $existingPayload;
        }

        $resolvedName = trim((string) ($payload['marketHashName'] ?? $payload['name'] ?? $existingPayload['name'] ?? ''));
        if ($resolvedName === '') {
            throw new \InvalidArgumentException('Watchlist sync upsert requires name or marketHashName.');
        }

        $resolvedType = trim((string) ($payload['type'] ?? $existingPayload['type'] ?? 'skin'));
        if ($resolvedType === '') {
            $resolvedType = 'skin';
        }

        $itemId = $this->resolveItemIdForSync($payload, $resolvedName, $resolvedType);
        $resolvedItem = $this->findItemById($itemId);
        $resolvedImageUrl = trim((string) (
            $payload['imageUrl']
            ?? $payload['image_url']
            ?? $existingPayload['imageUrl']
            ?? $existingPayload['image_url']
            ?? ($resolvedItem['image_url'] ?? '')
        ));
        $stmt = $this->pdo->prepare(
            'INSERT INTO watchlist (user_id, item_id, alert_price_usd)
             VALUES (?, ?, NULL)
             ON DUPLICATE KEY UPDATE
                alert_price_usd = VALUES(alert_price_usd)'
        );
        $stmt->execute([$userId, $itemId]);

        $watchlistRow = $this->findWatchlistByUserAndItem($userId, $itemId);
        $serverId = $watchlistRow ? (int) ($watchlistRow['id'] ?? 0) : null;

        return [
            ...$payload,
            'id' => $entityId,
            'userId' => (string) $userId,
            'itemId' => (string) $itemId,
            'name' => $resolvedName,
            'marketHashName' => $resolvedName,
            'type' => $resolvedType,
            'imageUrl' => $resolvedImageUrl !== '' ? $resolvedImageUrl : null,
            'serverId' => $serverId,
            'updatedAt' => gmdate('c'),
        ];
    }

    private function deleteInvestmentForSync(int $userId, string $entityId, array $payload, array $existingPayload): void
    {
        $candidateServerId = $this->extractPositiveInt($payload['serverId'] ?? null)
            ?? $this->extractPositiveInt($existingPayload['serverId'] ?? null)
            ?? $this->extractPositiveInt($entityId);

        if ($candidateServerId !== null) {
            $stmt = $this->pdo->prepare('DELETE FROM investments WHERE user_id = ? AND id = ?');
            $stmt->execute([$userId, $candidateServerId]);
            if ($stmt->rowCount() > 0) {
                return;
            }
        }

        $platform = $this->normalizePlatform((string) ($payload['platform'] ?? $payload['source'] ?? $existingPayload['platform'] ?? 'desktop_sync'));
        $externalTradeId = $this->resolveExternalTradeId($entityId, $payload, $existingPayload);
        $stmt = $this->pdo->prepare(
            'DELETE FROM investments WHERE user_id = ? AND platform = ? AND external_trade_id = ?'
        );
        $stmt->execute([$userId, $platform, $externalTradeId]);
    }

    private function deleteWatchlistForSync(int $userId, string $entityId, array $payload, array $existingPayload): void
    {
        $candidateServerId = $this->extractPositiveInt($payload['serverId'] ?? null)
            ?? $this->extractPositiveInt($existingPayload['serverId'] ?? null)
            ?? $this->extractPositiveInt($entityId);

        if ($candidateServerId !== null) {
            $stmt = $this->pdo->prepare('DELETE FROM watchlist WHERE user_id = ? AND id = ?');
            $stmt->execute([$userId, $candidateServerId]);
            if ($stmt->rowCount() > 0) {
                return;
            }
        }

        $candidateItemId = $this->extractPositiveInt($payload['itemId'] ?? null)
            ?? $this->extractPositiveInt($existingPayload['itemId'] ?? null);
        if ($candidateItemId !== null) {
            $stmt = $this->pdo->prepare('DELETE FROM watchlist WHERE user_id = ? AND item_id = ?');
            $stmt->execute([$userId, $candidateItemId]);
            if ($stmt->rowCount() > 0) {
                return;
            }
        }

        $resolvedName = trim((string) ($payload['marketHashName'] ?? $payload['name'] ?? $existingPayload['name'] ?? ''));
        if ($resolvedName !== '') {
            $itemId = $this->findItemIdByName($resolvedName);
            if ($itemId !== null) {
                $stmt = $this->pdo->prepare('DELETE FROM watchlist WHERE user_id = ? AND item_id = ?');
                $stmt->execute([$userId, $itemId]);
            }
        }
    }

    private function ensureItemsTable(): void
    {
        $this->pdo->exec(
            "CREATE TABLE IF NOT EXISTS items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                csfloat_id VARCHAR(255) UNIQUE,
                name VARCHAR(255) NOT NULL,
                market_hash_name VARCHAR(255) NOT NULL UNIQUE,
                type VARCHAR(64),
                image_url VARCHAR(512),
                rarity VARCHAR(64),
                collection VARCHAR(128),
                exterior VARCHAR(64),
                stattrak BOOL NOT NULL DEFAULT FALSE,
                item_type VARCHAR(64),
                item_type_label VARCHAR(128),
                market_type_label VARCHAR(128),
                wear_key VARCHAR(64),
                wear_label VARCHAR(64),
                catalog_cached_at TIMESTAMP NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_market_hash_name (market_hash_name),
                INDEX idx_type (type),
                INDEX idx_csfloat_id (csfloat_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }

    private function ensureInvestmentsTable(): void
    {
        $this->pdo->exec(
            "CREATE TABLE IF NOT EXISTS investments (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                item_id INT NOT NULL,
                buy_price_usd DECIMAL(10,2) NOT NULL,
                quantity INT NOT NULL,
                funding_mode ENUM('cash_in','wallet_funded') NOT NULL DEFAULT 'wallet_funded',
                platform VARCHAR(64),
                external_trade_id VARCHAR(255),
                purchased_at TIMESTAMP NOT NULL,
                raw_payload_json JSON,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (item_id) REFERENCES items(id),
                INDEX idx_user_item (user_id, item_id),
                INDEX idx_purchased_at (purchased_at),
                UNIQUE KEY uq_external_trade (platform, external_trade_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }

    private function ensureWatchlistTable(): void
    {
        $this->pdo->exec(
            "CREATE TABLE IF NOT EXISTS watchlist (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                item_id INT NOT NULL,
                alert_price_usd DECIMAL(10,2) NULL,
                added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
                UNIQUE idx_user_item (user_id, item_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }

    private function resolveItemIdForSync(array $payload, string $fallbackName, string $fallbackType): int
    {
        $imageUrl = trim((string) ($payload['imageUrl'] ?? ''));
        $resolvedImageUrl = $imageUrl !== '' ? $imageUrl : null;

        $candidateItemId = $this->extractPositiveInt($payload['itemId'] ?? null);
        if ($candidateItemId !== null) {
            $candidateItem = $this->findItemById($candidateItemId);
            if ($candidateItem !== null) {
                if ($resolvedImageUrl !== null) {
                    $canonicalByImage = $this->findItemIdByImageUrl($resolvedImageUrl);
                    if ($canonicalByImage !== null && $canonicalByImage !== $candidateItemId) {
                        return $canonicalByImage;
                    }
                }
                return $candidateItemId;
            }
        }

        $itemName = trim((string) ($payload['marketHashName'] ?? $payload['name'] ?? $fallbackName));
        if ($itemName === '') {
            $itemName = $fallbackName;
        }
        $itemType = trim((string) ($payload['type'] ?? $fallbackType));
        if ($itemType === '') {
            $itemType = 'skin';
        }

        return $this->findOrCreateItem($itemName, $itemType, $resolvedImageUrl);
    }

    private function findItemById(int $itemId): ?array
    {
        $stmt = $this->pdo->prepare('SELECT id, name, market_hash_name, type, image_url FROM items WHERE id = ? LIMIT 1');
        $stmt->execute([$itemId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row !== false ? $row : null;
    }

    private function findItemIdByName(string $name): ?int
    {
        $stmt = $this->pdo->prepare(
            'SELECT id FROM items WHERE market_hash_name = ? OR name = ? LIMIT 1'
        );
        $stmt->execute([$name, $name]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($row === false) {
            return null;
        }
        return $this->extractPositiveInt($row['id'] ?? null);
    }

    private function findItemIdByImageUrl(string $imageUrl): ?int
    {
        $normalizedUrl = trim($imageUrl);
        if ($normalizedUrl === '') {
            return null;
        }

        $stmt = $this->pdo->prepare(
            'SELECT id FROM items WHERE image_url = ? LIMIT 1'
        );
        $stmt->execute([$normalizedUrl]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        $exactId = $row !== false ? $this->extractPositiveInt($row['id'] ?? null) : null;
        if ($exactId !== null) {
            return $exactId;
        }

        $steamImageToken = $this->extractSteamImageToken($normalizedUrl);
        if ($steamImageToken === null) {
            return null;
        }

        $stmt = $this->pdo->prepare(
            'SELECT id
             FROM items
             WHERE image_url IS NOT NULL
               AND image_url LIKE ?
             ORDER BY catalog_cached_at DESC, updated_at DESC, id DESC
             LIMIT 1'
        );
        $stmt->execute(['%/economy/image/' . $steamImageToken . '%']);
        $tokenRow = $stmt->fetch(PDO::FETCH_ASSOC);
        return $tokenRow !== false ? $this->extractPositiveInt($tokenRow['id'] ?? null) : null;
    }

    private function extractSteamImageToken(string $imageUrl): ?string
    {
        $trimmed = trim($imageUrl);
        if ($trimmed === '') {
            return null;
        }

        if (preg_match('~/economy/image/([^?]+)~i', $trimmed, $matches) !== 1) {
            return null;
        }

        $token = trim((string) ($matches[1] ?? ''));
        if ($token === '') {
            return null;
        }

        return $token;
    }

    private function findOrCreateItem(string $name, string $type, ?string $imageUrl = null): int
    {
        $normalizedName = trim((string) preg_replace('/\s+/', ' ', $name));
        if ($normalizedName === '') {
            throw new \RuntimeException('Failed to resolve item for sync payload (empty name).');
        }

        $existingByName = $this->findItemIdByName($normalizedName);
        if ($existingByName !== null) {
            return $existingByName;
        }

        if ($imageUrl !== null && trim($imageUrl) !== '') {
            $existingByImage = $this->findItemIdByImageUrl($imageUrl);
            if ($existingByImage !== null) {
                return $existingByImage;
            }
        }

        throw new \RuntimeException(
            sprintf(
                'Item "%s" not found in server catalog. Run server pricing cron/catalog sync first.',
                $normalizedName
            )
        );
    }

    private function resolveExternalTradeId(string $entityId, array $payload, array $existingPayload): string
    {
        $candidate = trim((string) (
            $payload['externalTradeId']
            ?? $payload['steamAssetId']
            ?? $existingPayload['externalTradeId']
            ?? $existingPayload['steamAssetId']
            ?? $entityId
        ));
        if ($candidate === '') {
            $candidate = $entityId;
        }
        return mb_substr($candidate, 0, 255);
    }

    private function resolveSkinBaronTransferId(array $payload, array $existingPayload): ?string
    {
        $candidate = $payload['skinBaronTransferId']
            ?? $payload['skinBaronSaleId']
            ?? $existingPayload['skinBaronTransferId']
            ?? $existingPayload['skinBaronSaleId']
            ?? null;

        if (!is_scalar($candidate)) {
            return null;
        }

        $normalized = trim((string) $candidate);
        if ($normalized === '') {
            return null;
        }

        return mb_substr($normalized, 0, 255);
    }

    private function resolveSkinBaronOfferLink(array $payload, array $existingPayload): ?string
    {
        $candidate = $payload['skinBaronOfferLink']
            ?? $payload['offerLink']
            ?? $existingPayload['skinBaronOfferLink']
            ?? $existingPayload['offerLink']
            ?? null;

        if (!is_scalar($candidate)) {
            return null;
        }

        $normalized = trim((string) $candidate);
        if ($normalized === '') {
            return null;
        }

        return mb_substr($normalized, 0, 512);
    }

    private function normalizePlatform(string $platform): string
    {
        $normalized = strtolower(trim($platform));
        if ($normalized === '') {
            return 'desktop_sync';
        }
        return mb_substr($normalized, 0, 64);
    }

    private function normalizeFundingMode(string $fundingMode): string
    {
        $normalized = strtolower(trim($fundingMode));
        return $normalized === 'cash_in' ? 'cash_in' : 'wallet_funded';
    }

    private function normalizeBucket(string $bucket): string
    {
        $normalized = strtolower(trim($bucket));
        return $normalized === 'inventory' ? 'inventory' : 'investment';
    }

    private function normalizePriceUsd(array $payload, array $existingPayload): float
    {
        $candidate = $payload['buyPriceUsd']
            ?? $payload['buyPrice']
            ?? $existingPayload['buyPriceUsd']
            ?? $existingPayload['buyPrice']
            ?? 0;
        if (!is_numeric($candidate)) {
            return 0.0;
        }
        return max(0.0, round((float) $candidate, 2));
    }

    private function normalizeDateTime(string $value): string
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return gmdate('Y-m-d H:i:s');
        }
        $timestamp = strtotime($trimmed);
        if ($timestamp === false) {
            return gmdate('Y-m-d H:i:s');
        }
        return gmdate('Y-m-d H:i:s', $timestamp);
    }

    private function findInvestmentByExternalTrade(int $userId, string $platform, string $externalTradeId): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, item_id, platform, external_trade_id, raw_payload_json
             FROM investments
             WHERE user_id = ? AND platform = ? AND external_trade_id = ?
             LIMIT 1'
        );
        $stmt->execute([$userId, $platform, $externalTradeId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row !== false ? $row : null;
    }

    private function findSkinBaronInvestmentByTransferOffer(int $userId, string $transferId, string $offerLink): ?array
    {
        $transferLookup = strtolower(trim($transferId));
        $offerLookup = strtolower(trim($offerLink));
        if ($transferLookup === '' || $offerLookup === '') {
            return null;
        }

        $stmt = $this->pdo->prepare(
            "SELECT id, item_id, platform, external_trade_id, raw_payload_json
             FROM investments
             WHERE user_id = ?
               AND platform = 'skinbaron'
               AND (
                 LOWER(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(raw_payload_json, '$.skinBaronTransferId')), ''))) = ?
                 OR LOWER(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(raw_payload_json, '$.skinBaronSaleId')), ''))) = ?
               )
               AND (
                 LOWER(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(raw_payload_json, '$.skinBaronOfferLink')), ''))) = ?
                 OR LOWER(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(raw_payload_json, '$.offerLink')), ''))) = ?
               )
             LIMIT 1"
        );
        $stmt->execute([$userId, $transferLookup, $transferLookup, $offerLookup, $offerLookup]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row !== false ? $row : null;
    }

    private function findInvestmentByIdForUser(int $userId, int $investmentId): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, item_id, platform, external_trade_id, raw_payload_json
             FROM investments
             WHERE user_id = ? AND id = ?
             LIMIT 1'
        );
        $stmt->execute([$userId, $investmentId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row !== false ? $row : null;
    }

    private function hasCsfloatLivePriceForItem(int $itemId): bool
    {
        if ($itemId <= 0) {
            return false;
        }

        if (array_key_exists($itemId, $this->csfloatLivePriceAvailabilityCache)) {
            return $this->csfloatLivePriceAvailabilityCache[$itemId];
        }

        $stmt = $this->pdo->prepare(
            "SELECT 1
             FROM item_live_cache
             WHERE item_id = ?
               AND price_source = 'csfloat'
             LIMIT 1"
        );
        $stmt->execute([$itemId]);
        $hasPrice = $stmt->fetchColumn() !== false;
        $this->csfloatLivePriceAvailabilityCache[$itemId] = $hasPrice;

        return $hasPrice;
    }

    private function findWatchlistByUserAndItem(int $userId, int $itemId): ?array
    {
        $stmt = $this->pdo->prepare('SELECT id FROM watchlist WHERE user_id = ? AND item_id = ? LIMIT 1');
        $stmt->execute([$userId, $itemId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row !== false ? $row : null;
    }

    private function extractPositiveInt(mixed $value): ?int
    {
        if (is_int($value)) {
            return $value > 0 ? $value : null;
        }
        if (is_string($value) && trim($value) !== '' && is_numeric($value)) {
            $parsed = (int) $value;
            return $parsed > 0 ? $parsed : null;
        }
        if (is_float($value) || is_bool($value)) {
            $parsed = (int) $value;
            return $parsed > 0 ? $parsed : null;
        }
        return null;
    }

    private function toBooleanFlag(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if (is_numeric($value)) {
            return (int) $value === 1;
        }
        if (is_string($value)) {
            $normalized = strtolower(trim($value));
            return in_array($normalized, ['1', 'true', 'yes', 'on'], true);
        }
        return false;
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
