<?php
declare(strict_types=1);

namespace App\Application\Service;

use App\Infrastructure\Persistence\Repository\AppSecretsRepository;

final class AppSecretsService
{
    private const ENCRYPTION_KEY_NAME = 'encryption_key';
    private const KEY_LENGTH = 32;

    public function __construct(
        private readonly AppSecretsRepository $repository
    ) {
    }

    public function getEncryptionKey(): string
    {
        $key = $this->repository->getSecret(self::ENCRYPTION_KEY_NAME);

        if ($key && strlen($key) >= self::KEY_LENGTH) {
            return $key;
        }

        $newKey = $this->generateEncryptionKey();
        $this->repository->setSecret(self::ENCRYPTION_KEY_NAME, $newKey);

        return $newKey;
    }

    public function ensureEncryptionKeyExists(): void
    {
        if (!$this->repository->hasSecret(self::ENCRYPTION_KEY_NAME)) {
            $newKey = $this->generateEncryptionKey();
            $this->repository->setSecret(self::ENCRYPTION_KEY_NAME, $newKey);
        }
    }

    private function generateEncryptionKey(): string
    {
        return base64_encode(random_bytes(self::KEY_LENGTH));
    }
}
