<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

final class UserRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS users (
            id            INT AUTO_INCREMENT PRIMARY KEY,
            steam_id      VARCHAR(64)  NOT NULL UNIQUE,
            steam_name    VARCHAR(128) DEFAULT NULL,
            steam_avatar  VARCHAR(512) DEFAULT NULL,
            email         VARCHAR(255) DEFAULT NULL,
            role          VARCHAR(32)  NOT NULL DEFAULT 'user',
            is_active     BOOL         NOT NULL DEFAULT TRUE,
            last_login_at TIMESTAMP    NULL,
            created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_steam_id (steam_id),
            INDEX idx_steam_name (steam_name),
            INDEX idx_email (email)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

        try {
            $this->pdo->exec($sql);
            $this->ensureSteamColumns();
            $this->ensureSteamIdIndex();
            RepositoryObservability::schemaEnsured(self::class, 'users');
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['table' => 'users']
            );
            throw $exception;
        }
    }

    private function ensureSteamColumns(): void
    {
        $columns = [
            'steam_id' => "ALTER TABLE users ADD COLUMN steam_id VARCHAR(64) NULL AFTER id",
            'steam_name' => "ALTER TABLE users ADD COLUMN steam_name VARCHAR(128) DEFAULT NULL AFTER steam_id",
            'steam_avatar' => "ALTER TABLE users ADD COLUMN steam_avatar VARCHAR(512) DEFAULT NULL AFTER steam_name",
            'last_login_at' => "ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP NULL AFTER is_active",
        ];

        foreach ($columns as $column => $alterSql) {
            if ($this->columnExists('users', $column)) {
                continue;
            }

            try {
                $this->pdo->exec($alterSql);
            } catch (Throwable $exception) {
                RepositoryObservability::queryFailed(
                    self::class,
                    __FUNCTION__,
                    $alterSql,
                    $exception,
                    ['column' => $column]
                );
            }
        }

        try {
            $this->pdo->exec("UPDATE users SET steam_id = CONCAT('legacy-', id) WHERE steam_id IS NULL OR steam_id = ''");
            $this->pdo->exec("ALTER TABLE users MODIFY COLUMN steam_id VARCHAR(64) NOT NULL");
            $this->pdo->exec("ALTER TABLE users MODIFY COLUMN email VARCHAR(255) NULL");
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                'ALTER TABLE users MODIFY COLUMN steam_id VARCHAR(64) NOT NULL',
                $exception,
                []
            );
        }
    }

    private function ensureSteamIdIndex(): void
    {
        if ($this->indexExists('users', 'steam_id') || $this->indexExists('users', 'idx_steam_id')) {
            return;
        }

        try {
            $this->pdo->exec('ALTER TABLE users ADD UNIQUE KEY uq_users_steam_id (steam_id)');
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                'ALTER TABLE users ADD UNIQUE KEY uq_users_steam_id (steam_id)',
                $exception,
                []
            );
        }
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

    public function findById(int $id): ?array
    {
        $sql = 'SELECT id, steam_id, steam_name, steam_avatar, email, role, is_active, last_login_at, created_at, updated_at
                FROM users WHERE id = ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$id]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return $row ?: null;
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

    public function findBySteamId(string $steamId): ?array
    {
        $sql = 'SELECT id, steam_id, steam_name, steam_avatar, email, role, is_active, last_login_at, created_at, updated_at
                FROM users WHERE steam_id = ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$steamId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return $row ?: null;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['steamId' => $steamId]
            );
            throw $exception;
        }
    }

    public function findByEmail(?string $email): ?array
    {
        if ($email === null || trim($email) === '') {
            return null;
        }

        $sql = 'SELECT id, steam_id, steam_name, steam_avatar, email, role, is_active, last_login_at, created_at, updated_at
                FROM users WHERE email = ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$email]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return $row ?: null;
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['email' => $email]
            );
            throw $exception;
        }
    }

    public function findOrCreateBySteamId(string $steamId, ?string $steamName = null, ?string $steamAvatar = null, ?string $email = null, string $role = 'user'): int
    {
        $existing = $this->findBySteamId($steamId);
        if ($existing !== null) {
            $this->updateSteamProfile((int) $existing['id'], $steamName, $steamAvatar, $email);
            return (int) $existing['id'];
        }

        $sql = 'INSERT INTO users (steam_id, steam_name, steam_avatar, email, role, is_active, last_login_at)
                VALUES (?, ?, ?, ?, ?, ?, NOW())';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([
                $steamId,
                $steamName,
                $steamAvatar,
                $email,
                $role,
                true,
            ]);
            return (int) $this->pdo->lastInsertId();
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['steamId' => $steamId]
            );
            throw $exception;
        }
    }

    /**
     * Legacy compatibility helper.
     *
     * @deprecated Prefer `findOrCreateBySteamId()` for Steam login flows.
     */
    public function create(string $email, string $username, string $passwordHash, string $role = 'user'): int
    {
        $steamId = 'legacy-' . sha1($email . '|' . $username . '|' . $passwordHash);

        return $this->findOrCreateBySteamId($steamId, $username, null, $email, $role);
    }

    public function updateSteamProfile(int $id, ?string $steamName = null, ?string $steamAvatar = null, ?string $email = null): void
    {
        $sql = 'UPDATE users
                SET steam_name = COALESCE(?, steam_name),
                    steam_avatar = COALESCE(?, steam_avatar),
                    email = COALESCE(?, email),
                    last_login_at = NOW()
                WHERE id = ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$steamName, $steamAvatar, $email, $id]);
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

    public function touchLastLoginBySteamId(string $steamId): void
    {
        $sql = 'UPDATE users SET last_login_at = NOW() WHERE steam_id = ?';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$steamId]);
        } catch (Throwable $exception) {
            RepositoryObservability::queryFailed(
                self::class,
                __FUNCTION__,
                $sql,
                $exception,
                ['steamId' => $steamId]
            );
            throw $exception;
        }
    }

    public function ensureDefaultUser(): int
    {
        $this->ensureTable();

        $existing = $this->findBySteamId('legacy-default-user');
        if ($existing !== null) {
            return (int) $existing['id'];
        }

        return $this->findOrCreateBySteamId(
            'legacy-default-user',
            'default',
            null,
            'default@csportfolio.local',
            'admin'
        );
    }
}
