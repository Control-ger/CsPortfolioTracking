<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Repository;

use PDO;
use Throwable;

/**
 * Repository for temporary OAuth/OpenID state tokens
 * Used for CSRF protection during Steam authentication
 */
final class AuthStateRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }
    
    public function ensureTable(): void
    {
        $sql = "CREATE TABLE IF NOT EXISTS auth_state_tokens (
            id            INT AUTO_INCREMENT PRIMARY KEY,
            state         VARCHAR(64)  NOT NULL,
            return_url    VARCHAR(512) NOT NULL,
            expires_at    TIMESTAMP    NOT NULL,
            created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_state (state),
            INDEX idx_expires (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
        
        try {
            $this->pdo->exec($sql);
        } catch (Throwable $exception) {
            error_log("Failed to create auth_state_tokens table: " . $exception->getMessage());
            throw $exception;
        }
    }
    
    public function store(string $state, string $returnUrl, int $expiresInSeconds = 300): void
    {
        $expiresAt = date('Y-m-d H:i:s', time() + $expiresInSeconds);
        
        $sql = "INSERT INTO auth_state_tokens (state, return_url, expires_at) 
                VALUES (:state, :return_url, :expires_at)
                ON DUPLICATE KEY UPDATE 
                return_url = VALUES(return_url),
                expires_at = VALUES(expires_at),
                created_at = CURRENT_TIMESTAMP";
        
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([
            ':state' => $state,
            ':return_url' => $returnUrl,
            ':expires_at' => $expiresAt
        ]);
    }
    
    public function retrieve(string $state): ?array
    {
        $sql = "SELECT return_url, expires_at FROM auth_state_tokens 
                WHERE state = :state AND expires_at > NOW()";
        
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([':state' => $state]);
        $result = $stmt->fetch(PDO::FETCH_ASSOC);
        
        return $result ?: null;
    }
    
    public function delete(string $state): void
    {
        $sql = "DELETE FROM auth_state_tokens WHERE state = :state";
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([':state' => $state]);
    }
    
    /**
     * Atomic fetch and delete operation
     */
    public function retrieveAndDelete(string $state): ?array
    {
        $this->pdo->beginTransaction();
        
        try {
            $result = $this->retrieve($state);
            
            if ($result) {
                $this->delete($state);
            }
            
            $this->pdo->commit();
            return $result;
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }
    
    /**
     * Clean up expired tokens
     */
    public function cleanupExpired(): int
    {
        $sql = "DELETE FROM auth_state_tokens WHERE expires_at < NOW()";
        return $this->pdo->exec($sql);
    }
}
