<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class InvestmentRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS investments (
            id                INT AUTO_INCREMENT PRIMARY KEY,
            user_id           INT            NOT NULL,
            item_id           INT            NOT NULL,
            buy_price_usd     DECIMAL(10,2)  NOT NULL,
            quantity          INT            NOT NULL,
            funding_mode      ENUM('cash_in','wallet_funded') NOT NULL DEFAULT 'wallet_funded',
            platform          VARCHAR(64),
            external_trade_id VARCHAR(255),
            purchased_at      TIMESTAMP      NOT NULL,
            raw_payload_json  JSON,
            created_at        TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (item_id) REFERENCES items(id),
            INDEX idx_user_item (user_id, item_id),
            INDEX idx_purchased_at (purchased_at),
            UNIQUE KEY uq_external_trade (platform, external_trade_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            RepositoryObservability::schemaEnsured(self::class, 'investments');
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception
            );
            throw $exception;
        }
    }

    public function ensureImportColumns(): void
    {
        $this->ensureTable();

        $columns = [
            'platform' => "ALTER TABLE investments ADD COLUMN platform VARCHAR(64) NULL AFTER funding_mode",
            'external_trade_id' => "ALTER TABLE investments ADD COLUMN external_trade_id VARCHAR(255) NULL AFTER platform",
            'raw_payload_json' => "ALTER TABLE investments ADD COLUMN raw_payload_json JSON NULL AFTER purchased_at",
        ];

        foreach ($columns as $column => $sql) {
            if ($this->columnExists('investments', $column)) {
                continue;
            }

            try {
                $this->pdo->exec($sql);
            } catch (Throwable $exception) {
                RepositoryObservability::queryFailed(
                    self::class,
                    __FUNCTION__,
                    $sql,
                    $exception,
                    ['column' => $column]
                );
                throw $exception;
            }
        }

        $this->ensureFundingModeEnum();
        $this->ensureExternalTradeIndex();
    }

    private function columnExists(string $table, string $column): bool
    {
        $sql = "SHOW COLUMNS FROM {$table} WHERE Field = ?";
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([$column]);
        return (bool) $stmt->fetch(PDO::FETCH_ASSOC);
    }

    private function indexExists(string $table, string $indexName): bool
    {
        $sql = "SHOW INDEX FROM {$table} WHERE Key_name = ?";
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([$indexName]);
        return (bool) $stmt->fetch(PDO::FETCH_ASSOC);
    }

    private function ensureFundingModeEnum(): void
    {
        $compatSql = "ALTER TABLE investments
                MODIFY COLUMN funding_mode ENUM('cash','trade','balance','cash_in','wallet_funded') NOT NULL DEFAULT 'wallet_funded'";
        $finalSql = "ALTER TABLE investments
                MODIFY COLUMN funding_mode ENUM('cash_in','wallet_funded') NOT NULL DEFAULT 'wallet_funded'";

        try {
            $this->pdo->exec($compatSql);
            $this->pdo->exec(
                "UPDATE investments SET funding_mode = 'wallet_funded'
                 WHERE funding_mode IS NULL OR funding_mode IN ('cash', 'trade', 'balance', '')"
            );
            $this->pdo->exec($finalSql);
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $finalSql,
                $exception
            );
            throw $exception;
        }
    }

    private function ensureExternalTradeIndex(): void
    {
        if ($this->indexExists('investments', 'uq_external_trade')) {
            return;
        }

        $sql = 'ALTER TABLE investments ADD UNIQUE KEY uq_external_trade (platform, external_trade_id)';
        try {
            $this->pdo->exec($sql);
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception
            );
            throw $exception;
        }
    }

    public function findAll(int $userId): array
    {
        $this->ensureTable();

        $sql = 'SELECT i.id, i.user_id, i.item_id, i.buy_price_usd, i.quantity,
                       i.funding_mode, i.platform, i.external_trade_id, i.purchased_at, i.raw_payload_json,
                       it.name, it.market_hash_name, it.type, it.image_url
                FROM investments i
                JOIN items it ON it.id = i.item_id
                WHERE i.user_id = ?
                ORDER BY it.name ASC';

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

    public function findById(int $id): ?array
    {
        $sql = 'SELECT i.*, it.name, it.market_hash_name, it.type, it.image_url
                FROM investments i
                JOIN items it ON it.id = i.item_id
                WHERE i.id = ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$id]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return $row !== false ? $row : null;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['id' => $id]
            );
            throw $exception;
        }
    }

    public function findByUserAndId(int $userId, int $id): ?array
    {
        $sql = 'SELECT i.*, it.name, it.market_hash_name, it.type, it.image_url
                FROM investments i
                JOIN items it ON it.id = i.item_id
                WHERE i.user_id = ? AND i.id = ?
                LIMIT 1';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$userId, $id]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return $row !== false ? $row : null;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['userId' => $userId, 'id' => $id]
            );
            throw $exception;
        }
    }

    public function findByItemId(int $userId, int $itemId): array
    {
        $sql = 'SELECT i.*, it.name, it.market_hash_name
                FROM investments i
                JOIN items it ON it.id = i.item_id
                WHERE i.user_id = ? AND i.item_id = ?
                ORDER BY i.purchased_at ASC';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$userId, $itemId]);
            return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['userId' => $userId, 'itemId' => $itemId]
            );
            throw $exception;
        }
    }

    public function findExistingExternalTradeIds(array $externalTradeIds, string $platform = 'csfloat'): array
    {
        $normalizedIds = array_values(array_unique(array_filter(array_map(
            static fn ($value) => trim((string) $value),
            $externalTradeIds
        ))));

        if ($normalizedIds === []) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($normalizedIds), '?'));
        $sql = "SELECT external_trade_id FROM investments WHERE platform = ? AND external_trade_id IN ({$placeholders})";

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute(array_merge([$platform], $normalizedIds));
            $rows = $stmt->fetchAll(PDO::FETCH_COLUMN, 0) ?: [];

            $existing = [];
            foreach ($rows as $row) {
                $existing[(string) $row] = true;
            }

            return $existing;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['platform' => $platform, 'ids' => count($normalizedIds)]
            );
            throw $exception;
        }
    }

    public function insertImportedTrade(array $trade): int
    {
        $sql = 'INSERT INTO investments (
                user_id,
                item_id,
                buy_price_usd,
                quantity,
                funding_mode,
                platform,
                external_trade_id,
                purchased_at,
                raw_payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([
                (int) ($trade['userId'] ?? 1),
                (int) ($trade['itemId']),
                (float) ($trade['buyPriceUsd'] ?? 0.0),
                max(1, (int) ($trade['quantity'] ?? 1)),
                (string) ($trade['fundingMode'] ?? 'wallet_funded'),
                (string) ($trade['platform'] ?? 'csfloat'),
                (string) ($trade['externalTradeId'] ?? ''),
                $trade['purchasedAt'] ?? date('Y-m-d H:i:s'),
                $trade['rawPayloadJson'] ?? null,
            ]);

            return (int) $this->pdo->lastInsertId();
        } catch (Throwable $exception) {
            RepositoryObservability::upsertFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                [
                    'platform' => $trade['platform'] ?? 'csfloat',
                    'externalTradeId' => $trade['externalTradeId'] ?? null,
                ]
            );
            throw $exception;
        }
    }

    public function upsertImportedTradeSnapshot(array $trade): int
    {
        $userId = (int) ($trade['userId'] ?? 1);
        $platform = (string) ($trade['platform'] ?? 'csfloat');
        $externalTradeId = (string) ($trade['externalTradeId'] ?? '');
        $incomingPayloadJson = $trade['rawPayloadJson'] ?? null;
        $mergedPayloadJson = $this->mergeRawPayloadForImport($userId, $platform, $externalTradeId, $incomingPayloadJson);

        $sql = 'INSERT INTO investments (
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
                buy_price_usd = VALUES(buy_price_usd),
                quantity = VALUES(quantity),
                funding_mode = VALUES(funding_mode),
                purchased_at = CASE
                    WHEN purchased_at IS NULL THEN VALUES(purchased_at)
                    WHEN VALUES(purchased_at) IS NULL THEN purchased_at
                    ELSE LEAST(purchased_at, VALUES(purchased_at))
                END,
                raw_payload_json = VALUES(raw_payload_json)';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([
                $userId,
                (int) ($trade['itemId']),
                (float) ($trade['buyPriceUsd'] ?? 0.0),
                max(1, (int) ($trade['quantity'] ?? 1)),
                (string) ($trade['fundingMode'] ?? 'wallet_funded'),
                $platform,
                $externalTradeId,
                $trade['purchasedAt'] ?? date('Y-m-d H:i:s'),
                $mergedPayloadJson,
            ]);

            return (int) $this->pdo->lastInsertId();
        } catch (Throwable $exception) {
            RepositoryObservability::upsertFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                [
                    'platform' => $trade['platform'] ?? 'csfloat',
                    'externalTradeId' => $trade['externalTradeId'] ?? null,
                ]
            );
            throw $exception;
        }
    }

    public function delete(int $id): bool
    {
        $sql = 'DELETE FROM investments WHERE id = ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $result = $stmt->execute([$id]);
            return $result && $stmt->rowCount() > 0;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['id' => $id]
            );
            throw $exception;
        }
    }

    public function updateExcludedFlag(int $userId, int $investmentId, bool $exclude): bool
    {
        $this->ensureTable();

        $selectSql = 'SELECT raw_payload_json FROM investments WHERE user_id = ? AND id = ? LIMIT 1';
        $selectStmt = $this->pdo->prepare($selectSql);
        $selectStmt->execute([$userId, $investmentId]);
        $row = $selectStmt->fetch(PDO::FETCH_ASSOC);

        if ($row === false) {
            return false;
        }

        $payload = [];
        $rawPayload = $row['raw_payload_json'] ?? null;
        if (is_string($rawPayload) && trim($rawPayload) !== '') {
            $decoded = json_decode($rawPayload, true);
            if (is_array($decoded)) {
                $payload = $decoded;
            }
        }

        $payload['excluded'] = $exclude;
        $payload['isExcluded'] = $exclude;
        $payload['updatedAt'] = gmdate('c');

        $updateSql = 'UPDATE investments SET raw_payload_json = ? WHERE user_id = ? AND id = ?';
        $updateStmt = $this->pdo->prepare($updateSql);
        $updateStmt->execute([
            json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            $userId,
            $investmentId,
        ]);

        return true;
    }

    private function mergeRawPayloadForImport(
        int $userId,
        string $platform,
        string $externalTradeId,
        mixed $incomingPayloadJson
    ): ?string {
        $incomingPayload = $this->decodeRawPayload($incomingPayloadJson);
        if ($incomingPayload === null) {
            return is_string($incomingPayloadJson) ? $incomingPayloadJson : null;
        }

        $existingPayload = $this->findExistingRawPayloadForExternalTrade($userId, $platform, $externalTradeId);
        if ($existingPayload !== null) {
            if (array_key_exists('excluded', $existingPayload) && !array_key_exists('excluded', $incomingPayload)) {
                $incomingPayload['excluded'] = (bool) $existingPayload['excluded'];
            }
            if (array_key_exists('isExcluded', $existingPayload) && !array_key_exists('isExcluded', $incomingPayload)) {
                $incomingPayload['isExcluded'] = (bool) $existingPayload['isExcluded'];
            }
            if (array_key_exists('bucket', $existingPayload) && !array_key_exists('bucket', $incomingPayload)) {
                $incomingPayload['bucket'] = (string) $existingPayload['bucket'];
            }
            if (array_key_exists('overpayEnabled', $existingPayload) && !array_key_exists('overpayEnabled', $incomingPayload)) {
                $incomingPayload['overpayEnabled'] = (bool) $existingPayload['overpayEnabled'];
            }
            if (array_key_exists('isOverpayCandidate', $existingPayload) && !array_key_exists('isOverpayCandidate', $incomingPayload)) {
                $incomingPayload['isOverpayCandidate'] = (bool) $existingPayload['isOverpayCandidate'];
            }
            if (array_key_exists('overpayFloorEur', $existingPayload) && !array_key_exists('overpayFloorEur', $incomingPayload)) {
                $incomingPayload['overpayFloorEur'] = $existingPayload['overpayFloorEur'];
            }
            if (array_key_exists('overpayNote', $existingPayload) && !array_key_exists('overpayNote', $incomingPayload)) {
                $incomingPayload['overpayNote'] = (string) $existingPayload['overpayNote'];
            }
        }

        return json_encode($incomingPayload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    public function updateBucket(int $userId, int $investmentId, string $bucket): bool
    {
        $this->ensureTable();

        $selectSql = 'SELECT raw_payload_json FROM investments WHERE user_id = ? AND id = ? LIMIT 1';
        $selectStmt = $this->pdo->prepare($selectSql);
        $selectStmt->execute([$userId, $investmentId]);
        $row = $selectStmt->fetch(PDO::FETCH_ASSOC);

        if ($row === false) {
            return false;
        }

        $payload = [];
        $rawPayload = $row['raw_payload_json'] ?? null;
        if (is_string($rawPayload) && trim($rawPayload) !== '') {
            $decoded = json_decode($rawPayload, true);
            if (is_array($decoded)) {
                $payload = $decoded;
            }
        }

        $payload['bucket'] = strtolower(trim($bucket)) === 'inventory' ? 'inventory' : 'investment';
        $payload['updatedAt'] = gmdate('c');

        $updateSql = 'UPDATE investments SET raw_payload_json = ? WHERE user_id = ? AND id = ?';
        $updateStmt = $this->pdo->prepare($updateSql);
        $updateStmt->execute([
            json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            $userId,
            $investmentId,
        ]);

        return true;
    }

    public function updateOverpayProfile(
        int $userId,
        int $investmentId,
        bool $overpayEnabled,
        ?float $overpayFloorEur = null,
        ?string $overpayNote = null
    ): bool {
        $this->ensureTable();

        $selectSql = 'SELECT raw_payload_json FROM investments WHERE user_id = ? AND id = ? LIMIT 1';
        $selectStmt = $this->pdo->prepare($selectSql);
        $selectStmt->execute([$userId, $investmentId]);
        $row = $selectStmt->fetch(PDO::FETCH_ASSOC);

        if ($row === false) {
            return false;
        }

        $payload = [];
        $rawPayload = $row['raw_payload_json'] ?? null;
        if (is_string($rawPayload) && trim($rawPayload) !== '') {
            $decoded = json_decode($rawPayload, true);
            if (is_array($decoded)) {
                $payload = $decoded;
            }
        }

        $payload['overpayEnabled'] = $overpayEnabled;
        $payload['isOverpayCandidate'] = $overpayEnabled;

        if ($overpayFloorEur !== null && $overpayFloorEur > 0) {
            $payload['overpayFloorEur'] = round($overpayFloorEur, 2);
        } else {
            unset($payload['overpayFloorEur']);
        }

        $trimmedNote = trim((string) ($overpayNote ?? ''));
        if ($trimmedNote !== '') {
            $payload['overpayNote'] = mb_substr($trimmedNote, 0, 280);
        } else {
            unset($payload['overpayNote']);
        }

        $payload['updatedAt'] = gmdate('c');

        $updateSql = 'UPDATE investments SET raw_payload_json = ? WHERE user_id = ? AND id = ?';
        $updateStmt = $this->pdo->prepare($updateSql);
        $updateStmt->execute([
            json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            $userId,
            $investmentId,
        ]);

        return true;
    }

    private function findExistingRawPayloadForExternalTrade(int $userId, string $platform, string $externalTradeId): ?array
    {
        if ($externalTradeId === '') {
            return null;
        }

        $sql = 'SELECT raw_payload_json
                FROM investments
                WHERE user_id = ? AND platform = ? AND external_trade_id = ?
                LIMIT 1';
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([$userId, $platform, $externalTradeId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            return null;
        }

        return $this->decodeRawPayload($row['raw_payload_json'] ?? null);
    }

    private function decodeRawPayload(mixed $rawPayload): ?array
    {
        if (!is_string($rawPayload) || trim($rawPayload) === '') {
            return null;
        }

        $decoded = json_decode($rawPayload, true);
        return is_array($decoded) ? $decoded : null;
    }
}
