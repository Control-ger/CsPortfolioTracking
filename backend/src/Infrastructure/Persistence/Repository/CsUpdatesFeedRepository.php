<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class CsUpdatesFeedRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS cs_updates_feed (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            source VARCHAR(32) NOT NULL,
            external_id VARCHAR(191) NOT NULL,
            title VARCHAR(512) NOT NULL,
            url VARCHAR(1024) NOT NULL,
            summary_raw TEXT NULL,
            published_at DATETIME NOT NULL,
            changelist_id BIGINT NULL,
            build_id BIGINT NULL,
            branch VARCHAR(64) NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY ux_cs_updates_external_id (external_id),
            KEY ix_cs_updates_published_at (published_at),
            KEY ix_cs_updates_changelist_id (changelist_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            RepositoryObservability::schemaEnsured(self::class, 'cs_updates_feed');
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['table' => 'cs_updates_feed']
            );
            throw $exception;
        }
    }

    /**
     * @param array<string,mixed> $row
     */
    public function upsert(array $row): bool
    {
        $sql = "INSERT INTO cs_updates_feed (
                    source, external_id, title, url, summary_raw, published_at, changelist_id, build_id, branch
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    title = VALUES(title),
                    url = VALUES(url),
                    summary_raw = VALUES(summary_raw),
                    published_at = VALUES(published_at),
                    changelist_id = VALUES(changelist_id),
                    build_id = VALUES(build_id),
                    branch = VALUES(branch),
                    updated_at = CURRENT_TIMESTAMP";

        $params = [
            (string) ($row['source'] ?? 'steamdb_rss'),
            (string) ($row['external_id'] ?? ''),
            (string) ($row['title'] ?? ''),
            (string) ($row['url'] ?? ''),
            isset($row['summary_raw']) ? (string) $row['summary_raw'] : null,
            (string) ($row['published_at'] ?? gmdate('Y-m-d H:i:s')),
            isset($row['changelist_id']) ? (int) $row['changelist_id'] : null,
            isset($row['build_id']) ? (int) $row['build_id'] : null,
            isset($row['branch']) ? (string) $row['branch'] : null,
        ];

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            return $stmt->rowCount() === 1;
        } catch (Throwable $exception) {
            RepositoryObservability::upsertFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['externalId' => (string) ($row['external_id'] ?? '')]
            );
            throw $exception;
        }
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public function listLatest(int $limit = 50, ?string $beforeIso = null): array
    {
        $resolvedLimit = max(1, min(200, $limit));
        $params = [];
        $sql = "SELECT
                    id,
                    source,
                    external_id,
                    title,
                    url,
                    summary_raw,
                    published_at,
                    changelist_id,
                    build_id,
                    branch,
                    created_at,
                    updated_at
                FROM cs_updates_feed";

        if ($beforeIso !== null && trim($beforeIso) !== '') {
            $before = (new \DateTimeImmutable($beforeIso))->setTimezone(new \DateTimeZone('UTC'));
            $sql .= ' WHERE published_at < ?';
            $params[] = $before->format('Y-m-d H:i:s');
        }

        $sql .= ' ORDER BY published_at DESC, id DESC LIMIT ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            foreach ($params as $index => $value) {
                $stmt->bindValue($index + 1, $value, PDO::PARAM_STR);
            }
            $stmt->bindValue(count($params) + 1, $resolvedLimit, PDO::PARAM_INT);
            $stmt->execute();

            return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['limit' => $resolvedLimit, 'beforeIso' => $beforeIso]
            );
            throw $exception;
        }
    }

    /**
     * @return array<string,mixed>|null
     */
    public function findByExternalId(string $externalId): ?array
    {
        $sql = "SELECT
                    id,
                    source,
                    external_id,
                    title,
                    url,
                    summary_raw,
                    published_at,
                    changelist_id,
                    build_id,
                    branch,
                    created_at,
                    updated_at
                FROM cs_updates_feed
                WHERE external_id = ?
                LIMIT 1";

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$externalId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return is_array($row) ? $row : null;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['externalId' => $externalId]
            );
            throw $exception;
        }
    }
}
