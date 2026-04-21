<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class InvestmentRepository
{
    private bool $fundingModeColumnChecked = false;
    private bool $excludeFromPortfolioColumnChecked = false;
    private bool $importColumnsChecked = false;

    public function __construct(private readonly PDO $pdo)
    {
    }

    public function findAll(): array
    {
        $this->ensureFundingModeColumn();
        $this->ensureExcludeFromPortfolioColumn();

        $sql = 'SELECT id, name, type, buy_price, quantity, COALESCE(funding_mode, "wallet_funded") AS funding_mode
                FROM investments
                WHERE COALESCE(exclude_from_portfolio, 0) = 0';

        try {
            $stmt = $this->pdo->query($sql);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

            return array_map(
                static function (array $row): array {
                    $fundingMode = (string) ($row['funding_mode'] ?? 'wallet_funded');
                    if (!in_array($fundingMode, ['cash_in', 'wallet_funded'], true)) {
                        $fundingMode = 'wallet_funded';
                    }

                    $row['funding_mode'] = $fundingMode;
                    return $row;
                },
                $rows
            );
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

    public function toggleExcludeFromPortfolio(int $id, bool $exclude): bool
    {
        $this->ensureExcludeFromPortfolioColumn();

        $sql = 'UPDATE investments SET exclude_from_portfolio = ? WHERE id = ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $result = $stmt->execute([(int) $exclude, $id]);

            return $result && $stmt->rowCount() > 0;
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

    public function findById(int $id): ?array
    {
        $sql = 'SELECT * FROM investments WHERE id = ?';

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
                $exception
            );
            throw $exception;
        }
    }

    public function ensureImportColumns(): void
    {
        if ($this->importColumnsChecked) {
            return;
        }

        $this->ensureFundingModeColumn();
        $this->ensureExcludeFromPortfolioColumn();
        $this->ensureColumn('external_source', "ALTER TABLE investments ADD COLUMN external_source VARCHAR(32) NULL DEFAULT NULL AFTER funding_mode");
        $this->ensureColumn('external_trade_id', "ALTER TABLE investments ADD COLUMN external_trade_id VARCHAR(128) NULL DEFAULT NULL AFTER external_source");
        $this->ensureColumn('purchased_at', "ALTER TABLE investments ADD COLUMN purchased_at DATETIME NULL DEFAULT NULL AFTER external_trade_id");
        $this->ensureColumn('raw_payload_json', "ALTER TABLE investments ADD COLUMN raw_payload_json LONGTEXT NULL DEFAULT NULL AFTER purchased_at");
        $this->ensureUniqueExternalTradeIndex();

        $this->importColumnsChecked = true;
    }

    public function findExistingExternalTradeIds(array $externalTradeIds, string $externalSource = 'csfloat'): array
    {
        $this->ensureImportColumns();

        $normalizedIds = array_values(array_unique(array_filter(array_map(
            static fn ($value) => trim((string) $value),
            $externalTradeIds
        ))));

        if ($normalizedIds === []) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($normalizedIds), '?'));
        $sql = "SELECT external_trade_id FROM investments WHERE external_source = ? AND external_trade_id IN ({$placeholders})";

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute(array_merge([$externalSource], $normalizedIds));
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
                ['externalSource' => $externalSource, 'ids' => count($normalizedIds)]
            );
            throw $exception;
        }
    }

    public function insertImportedTrade(array $trade): int
    {
        $this->ensureImportColumns();

        $sql = 'INSERT INTO investments (
                name,
                type,
                buy_price,
                quantity,
                funding_mode,
                external_source,
                external_trade_id,
                purchased_at,
                raw_payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([
                (string) ($trade['name'] ?? 'Unknown Item'),
                (string) ($trade['type'] ?? 'other'),
                (float) ($trade['buyPrice'] ?? 0.0),
                max(1, (int) ($trade['quantity'] ?? 1)),
                (string) ($trade['fundingMode'] ?? 'wallet_funded'),
                (string) ($trade['externalSource'] ?? 'csfloat'),
                (string) ($trade['externalTradeId'] ?? ''),
                $trade['purchasedAt'] ?? null,
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
                    'externalSource' => $trade['externalSource'] ?? 'csfloat',
                    'externalTradeId' => $trade['externalTradeId'] ?? null,
                    'name' => $trade['name'] ?? null,
                ]
            );
            throw $exception;
        }
    }

    public function upsertImportedTradeSnapshot(array $trade): int
    {
        $this->ensureImportColumns();

        $sql = 'INSERT INTO investments (
                name,
                type,
                buy_price,
                quantity,
                funding_mode,
                external_source,
                external_trade_id,
                purchased_at,
                raw_payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                name = VALUES(name),
                type = VALUES(type),
                buy_price = VALUES(buy_price),
                quantity = GREATEST(quantity, VALUES(quantity)),
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
                (string) ($trade['name'] ?? 'Unknown Item'),
                (string) ($trade['type'] ?? 'other'),
                (float) ($trade['buyPrice'] ?? 0.0),
                max(1, (int) ($trade['quantity'] ?? 1)),
                (string) ($trade['fundingMode'] ?? 'wallet_funded'),
                (string) ($trade['externalSource'] ?? 'csfloat'),
                (string) ($trade['externalTradeId'] ?? ''),
                $trade['purchasedAt'] ?? null,
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
                    'externalSource' => $trade['externalSource'] ?? 'csfloat',
                    'externalTradeId' => $trade['externalTradeId'] ?? null,
                    'name' => $trade['name'] ?? null,
                ]
            );
            throw $exception;
        }
    }

    private function ensureFundingModeColumn(): void
    {
        if ($this->fundingModeColumnChecked) {
            return;
        }

        $checkSql = "SHOW COLUMNS FROM investments WHERE Field = 'funding_mode'";

        try {
            $stmt = $this->pdo->query($checkSql);
            $exists = $stmt !== false && $stmt->rowCount() > 0;

            if (!$exists) {
                $alterSql = "ALTER TABLE investments ADD COLUMN funding_mode VARCHAR(32) NOT NULL DEFAULT 'wallet_funded' AFTER quantity";
                $this->pdo->exec($alterSql);
            }

            $this->fundingModeColumnChecked = true;
            RepositoryObservability::schemaEnsured(self::class, 'investments.funding_mode');
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $checkSql,
                $exception,
                ['table' => 'investments', 'column' => 'funding_mode']
            );
            throw $exception;
        }
    }

    private function ensureExcludeFromPortfolioColumn(): void
    {
        if ($this->excludeFromPortfolioColumnChecked) {
            return;
        }

        $this->ensureColumn(
            'exclude_from_portfolio',
            "ALTER TABLE investments ADD COLUMN exclude_from_portfolio TINYINT(1) NOT NULL DEFAULT 0 AFTER funding_mode"
        );

        $this->excludeFromPortfolioColumnChecked = true;
        RepositoryObservability::schemaEnsured(self::class, 'investments.exclude_from_portfolio');
    }

    private function ensureColumn(string $field, string $alterSql): void
    {
        $checkSql = "SHOW COLUMNS FROM investments WHERE Field = '{$field}'";

        try {
            $stmt = $this->pdo->query($checkSql);
            $exists = $stmt !== false && $stmt->rowCount() > 0;

            if (!$exists) {
                $this->pdo->exec($alterSql);
                RepositoryObservability::migrationColumnAdded(self::class, 'investments', $field);
            }
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $checkSql,
                $exception,
                ['table' => 'investments', 'column' => $field]
            );
            throw $exception;
        }
    }

    private function ensureUniqueExternalTradeIndex(): void
    {
        $checkSql = "SHOW INDEX FROM investments WHERE Key_name = 'uq_investments_external_trade'";

        try {
            $stmt = $this->pdo->query($checkSql);
            $exists = $stmt !== false && $stmt->rowCount() > 0;

            if (!$exists) {
                $this->pdo->exec('ALTER TABLE investments ADD UNIQUE KEY uq_investments_external_trade (external_source, external_trade_id)');
            }
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $checkSql,
                $exception,
                ['table' => 'investments', 'index' => 'uq_investments_external_trade']
            );
            throw $exception;
        }
    }
}
