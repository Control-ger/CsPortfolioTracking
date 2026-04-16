<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class InvestmentRepository
{
    private bool $fundingModeColumnChecked = false;

    public function __construct(private readonly PDO $pdo)
    {
    }

    public function findAll(): array
    {
        $this->ensureFundingModeColumn();

        $sql = 'SELECT id, name, type, buy_price, quantity, COALESCE(funding_mode, "wallet_funded") AS funding_mode FROM investments';

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
}
