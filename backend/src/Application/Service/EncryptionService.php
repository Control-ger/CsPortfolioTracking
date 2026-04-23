<?php
declare(strict_types=1);

namespace App\Application\Service;

final class EncryptionService
{
    private const CIPHER = 'AES-256-CBC';
    private const KEY_LENGTH = 32;

    public function __construct(private readonly string $encryptionKey)
    {
        if (strlen($this->encryptionKey) < self::KEY_LENGTH) {
            throw new \InvalidArgumentException('Encryption key must be at least 32 characters');
        }
    }

    public function encrypt(string $plaintext): string
    {
        $ivLength = openssl_cipher_iv_length(self::CIPHER);
        if ($ivLength === false) {
            throw new \RuntimeException('Failed to get IV length');
        }

        $iv = random_bytes($ivLength);
        $encrypted = openssl_encrypt($plaintext, self::CIPHER, $this->encryptionKey, OPENSSL_RAW_DATA, $iv);

        if ($encrypted === false) {
            throw new \RuntimeException('Encryption failed');
        }

        return base64_encode($iv . $encrypted);
    }

    public function decrypt(string $ciphertext): ?string
    {
        $decoded = base64_decode($ciphertext, true);
        if ($decoded === false) {
            return null;
        }

        $ivLength = openssl_cipher_iv_length(self::CIPHER);
        if ($ivLength === false || strlen($decoded) < $ivLength) {
            return null;
        }

        $iv = substr($decoded, 0, $ivLength);
        $encrypted = substr($decoded, $ivLength);

        $decrypted = openssl_decrypt($encrypted, self::CIPHER, $this->encryptionKey, OPENSSL_RAW_DATA, $iv);

        return $decrypted !== false ? $decrypted : null;
    }
}
