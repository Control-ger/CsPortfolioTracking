<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;

final class AppSecretsRepository
{
    public function __construct(
        private readonly PDO $pdo
    ) {
    }

    public function ensureTable(): void
    {
        $this->pdo->exec(
            "CREATE TABLE IF NOT EXISTS app_secrets (
                secret_key VARCHAR(191) PRIMARY KEY,
                secret_value LONGTEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_created (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }

    public function getSecret(string $key): ?string
    {
        $stmt = $this->pdo->prepare("SELECT secret_value FROM app_secrets WHERE secret_key = ?");
        $stmt->execute([$key]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        return $row ? (string) $row['secret_value'] : null;
    }

    public function setSecret(string $key, string $value): void
    {
        $stmt = $this->pdo->prepare(
            "INSERT INTO app_secrets (secret_key, secret_value) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE secret_value = ?"
        );
        $stmt->execute([$key, $value, $value]);
    }

    public function hasSecret(string $key): bool
    {
        $stmt = $this->pdo->prepare("SELECT 1 FROM app_secrets WHERE secret_key = ?");
        $stmt->execute([$key]);
        return (bool) $stmt->fetch();
    }
}
