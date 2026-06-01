<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class UserPortfolioGroupsRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS user_portfolio_groups (
            user_id      INT            NOT NULL PRIMARY KEY,
            groups_json  LONGTEXT       NOT NULL,
            created_at   TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at   TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            RepositoryObservability::schemaEnsured(self::class, 'user_portfolio_groups');
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['table' => 'user_portfolio_groups']
            );
            throw $exception;
        }
    }

    public function getByUserId(int $userId): array
    {
        $this->ensureTable();

        $sql = 'SELECT groups_json, updated_at
                FROM user_portfolio_groups
                WHERE user_id = ?
                LIMIT 1';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$userId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!is_array($row)) {
                return [
                    'userId' => $userId,
                    'groups' => [],
                    'updatedAt' => null,
                    'source' => 'defaults',
                ];
            }

            $decoded = json_decode((string) ($row['groups_json'] ?? '[]'), true);
            return [
                'userId' => $userId,
                'groups' => $this->normalizeGroupsPayload(is_array($decoded) ? $decoded : []),
                'updatedAt' => isset($row['updated_at']) ? (string) $row['updated_at'] : null,
                'source' => 'db',
            ];
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

    public function upsertByUserId(int $userId, array $groups): array
    {
        $this->ensureTable();

        $normalizedGroups = $this->normalizeGroupsPayload($groups);
        $payload = json_encode($normalizedGroups, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (!is_string($payload)) {
            $payload = '[]';
        }

        $sql = 'INSERT INTO user_portfolio_groups (user_id, groups_json)
                VALUES (?, ?)
                ON DUPLICATE KEY UPDATE
                    groups_json = VALUES(groups_json),
                    updated_at = CURRENT_TIMESTAMP';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$userId, $payload]);
            return $this->getByUserId($userId);
        } catch (Throwable $exception) {
            RepositoryObservability::upsertFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['userId' => $userId]
            );
            throw $exception;
        }
    }

    /**
     * @param array<int, mixed> $groups
     * @return array<int, array<string, mixed>>
     */
    private function normalizeGroupsPayload(array $groups): array
    {
        $normalized = [];
        $groupCount = 0;

        foreach ($groups as $group) {
            if (!is_array($group)) {
                continue;
            }

            $id = trim((string) ($group['id'] ?? ''));
            $name = trim((string) ($group['name'] ?? ''));
            if ($id === '' || $name === '') {
                continue;
            }

            $thesis = trim((string) ($group['thesis'] ?? ''));
            $createdAt = trim((string) ($group['createdAt'] ?? ''));
            $updatedAt = trim((string) ($group['updatedAt'] ?? ''));

            $memberIds = [];
            $seenMemberIds = [];
            $members = $group['memberInvestmentIds'] ?? [];
            if (is_array($members)) {
                foreach ($members as $memberId) {
                    $candidate = trim((string) $memberId);
                    if ($candidate === '' || isset($seenMemberIds[$candidate])) {
                        continue;
                    }
                    $seenMemberIds[$candidate] = true;
                    $memberIds[] = $candidate;
                    if (count($memberIds) >= 5000) {
                        break;
                    }
                }
            }

            $normalized[] = [
                'id' => $id,
                'name' => $name,
                'thesis' => $thesis,
                'memberInvestmentIds' => $memberIds,
                'createdAt' => $createdAt !== '' ? $createdAt : gmdate('c'),
                'updatedAt' => $updatedAt !== '' ? $updatedAt : ($createdAt !== '' ? $createdAt : gmdate('c')),
            ];

            $groupCount += 1;
            if ($groupCount >= 500) {
                break;
            }
        }

        return $normalized;
    }
}
