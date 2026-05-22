<?php
declare(strict_types=1);

namespace App\Application\Service;

final class WebPushService
{
    public function __construct(
        private readonly string $publicKeyBase64Url,
        private readonly string $privateKeyBase64Url,
        private readonly string $subject
    ) {
    }

    public static function fromEnv(): self
    {
        $publicKey = trim((string) (getenv('VAPID_PUBLIC_KEY') ?: ($_ENV['VAPID_PUBLIC_KEY'] ?? '')));
        $privateKey = trim((string) (getenv('VAPID_PRIVATE_KEY') ?: ($_ENV['VAPID_PRIVATE_KEY'] ?? '')));
        $subject = trim((string) (getenv('VAPID_SUBJECT') ?: ($_ENV['VAPID_SUBJECT'] ?? '')));

        return new self($publicKey, $privateKey, $subject);
    }

    public function isConfigured(): bool
    {
        return $this->publicKeyBase64Url !== ''
            && $this->privateKeyBase64Url !== ''
            && $this->subject !== '';
    }

    public function getPublicKey(): string
    {
        return $this->publicKeyBase64Url;
    }

    /**
     * @return array{ok:bool,statusCode:int,error:?string}
     */
    public function sendWakeup(string $endpoint, int $ttlSeconds = 120): array
    {
        if (!$this->isConfigured()) {
            return ['ok' => false, 'statusCode' => 0, 'error' => 'VAPID keys are not configured'];
        }

        $audience = $this->resolveAudience($endpoint);
        if ($audience === null) {
            return ['ok' => false, 'statusCode' => 0, 'error' => 'Invalid push endpoint URL'];
        }

        $jwt = $this->createVapidJwt($audience);
        if ($jwt === null) {
            return ['ok' => false, 'statusCode' => 0, 'error' => 'Failed to sign VAPID token'];
        }

        $headers = [
            'TTL: ' . max(30, min(86400, $ttlSeconds)),
            'Authorization: vapid t=' . $jwt . ', k=' . $this->publicKeyBase64Url,
            'Crypto-Key: p256ecdsa=' . $this->publicKeyBase64Url,
            'Content-Length: 0',
        ];

        $ch = curl_init($endpoint);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, '');
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 12);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_HEADER, false);

        $responseBody = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        $ok = $httpCode >= 200 && $httpCode < 300;
        $error = null;
        if (!$ok) {
            $responseSnippet = is_string($responseBody) ? mb_substr(trim($responseBody), 0, 240) : '';
            $error = trim(($curlError !== '' ? $curlError : '') . ($responseSnippet !== '' ? ' ' . $responseSnippet : ''));
            if ($error === '') {
                $error = 'Push service returned HTTP ' . $httpCode;
            }
        }

        return [
            'ok' => $ok,
            'statusCode' => $httpCode,
            'error' => $error,
        ];
    }

    private function resolveAudience(string $endpoint): ?string
    {
        $parts = parse_url($endpoint);
        if (!is_array($parts)) {
            return null;
        }

        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = strtolower((string) ($parts['host'] ?? ''));
        if ($scheme === '' || $host === '') {
            return null;
        }

        $port = isset($parts['port']) ? (int) $parts['port'] : null;
        $defaultPort = $scheme === 'https' ? 443 : ($scheme === 'http' ? 80 : null);
        $portPart = ($port !== null && $defaultPort !== null && $port !== $defaultPort) ? ':' . $port : '';

        return $scheme . '://' . $host . $portPart;
    }

    private function createVapidJwt(string $audience): ?string
    {
        $header = ['typ' => 'JWT', 'alg' => 'ES256'];
        $payload = [
            'aud' => $audience,
            'exp' => time() + (11 * 60 * 60),
            'sub' => $this->subject,
        ];

        $encodedHeader = $this->base64UrlEncode((string) json_encode($header, JSON_UNESCAPED_SLASHES));
        $encodedPayload = $this->base64UrlEncode((string) json_encode($payload, JSON_UNESCAPED_SLASHES));
        $signingInput = $encodedHeader . '.' . $encodedPayload;

        $privateKeyPem = $this->buildEcPrivateKeyPem($this->privateKeyBase64Url);
        $privateKey = $privateKeyPem !== null ? openssl_pkey_get_private($privateKeyPem) : false;
        if ($privateKey === false) {
            return null;
        }

        $signatureDer = '';
        $ok = openssl_sign($signingInput, $signatureDer, $privateKey, OPENSSL_ALGO_SHA256);
        if (is_object($privateKey)) {
            openssl_free_key($privateKey);
        }
        if (!$ok || $signatureDer === '') {
            return null;
        }

        $signatureJose = $this->ecdsaDerToJose($signatureDer, 64);
        if ($signatureJose === null) {
            return null;
        }

        return $signingInput . '.' . $this->base64UrlEncode($signatureJose);
    }

    private function buildEcPrivateKeyPem(string $privateKeyBase64Url): ?string
    {
        $rawPrivateKey = $this->base64UrlDecode($privateKeyBase64Url);
        if ($rawPrivateKey === null || strlen($rawPrivateKey) !== 32) {
            return null;
        }

        // ECPrivateKey (SEC1) for prime256v1:
        // SEQUENCE {
        //   INTEGER 1
        //   OCTET STRING (32-byte private key)
        //   [0] OBJECT IDENTIFIER prime256v1
        // }
        $version = "\x02\x01\x01";
        $privateOctetString = "\x04\x20" . $rawPrivateKey;
        $curveOidPrime256v1 = "\xA0\x0A\x06\x08\x2A\x86\x48\xCE\x3D\x03\x01\x07";
        $sequenceBody = $version . $privateOctetString . $curveOidPrime256v1;
        $der = "\x30" . chr(strlen($sequenceBody)) . $sequenceBody;

        return "-----BEGIN EC PRIVATE KEY-----\n"
            . chunk_split(base64_encode($der), 64, "\n")
            . "-----END EC PRIVATE KEY-----\n";
    }

    private function ecdsaDerToJose(string $derSignature, int $partLength): ?string
    {
        $offset = 0;
        $sequenceTag = ord($derSignature[$offset] ?? "\x00");
        if ($sequenceTag !== 0x30) {
            return null;
        }
        $offset++;
        $seqLength = $this->readDerLength($derSignature, $offset);
        if ($seqLength === null) {
            return null;
        }

        $intTagR = ord($derSignature[$offset] ?? "\x00");
        if ($intTagR !== 0x02) {
            return null;
        }
        $offset++;
        $rLen = $this->readDerLength($derSignature, $offset);
        if ($rLen === null) {
            return null;
        }
        $r = substr($derSignature, $offset, $rLen);
        $offset += $rLen;

        $intTagS = ord($derSignature[$offset] ?? "\x00");
        if ($intTagS !== 0x02) {
            return null;
        }
        $offset++;
        $sLen = $this->readDerLength($derSignature, $offset);
        if ($sLen === null) {
            return null;
        }
        $s = substr($derSignature, $offset, $sLen);

        $r = ltrim($r, "\x00");
        $s = ltrim($s, "\x00");
        $r = str_pad($r, $partLength / 2, "\x00", STR_PAD_LEFT);
        $s = str_pad($s, $partLength / 2, "\x00", STR_PAD_LEFT);

        if (strlen($r) !== $partLength / 2 || strlen($s) !== $partLength / 2) {
            return null;
        }

        return $r . $s;
    }

    private function readDerLength(string $der, int &$offset): ?int
    {
        $lengthByte = ord($der[$offset] ?? "\x00");
        $offset++;

        if (($lengthByte & 0x80) === 0) {
            return $lengthByte;
        }

        $numBytes = $lengthByte & 0x7F;
        if ($numBytes < 1 || $numBytes > 2) {
            return null;
        }

        $length = 0;
        for ($i = 0; $i < $numBytes; $i++) {
            $length = ($length << 8) | ord($der[$offset] ?? "\x00");
            $offset++;
        }

        return $length;
    }

    private function base64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private function base64UrlDecode(string $data): ?string
    {
        $normalized = strtr($data, '-_', '+/');
        $padding = strlen($normalized) % 4;
        if ($padding > 0) {
            $normalized .= str_repeat('=', 4 - $padding);
        }

        $decoded = base64_decode($normalized, true);
        return $decoded === false ? null : $decoded;
    }
}

