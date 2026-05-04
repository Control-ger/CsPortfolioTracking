<?php
declare(strict_types=1);

namespace App\Http\Controller;

use App\Infrastructure\Persistence\Repository\UserRepository;
use PDO;

/**
 * Steam OpenID Authentication Controller
 * 
 * Implements Steam OpenID 2.0 flow for desktop and web clients.
 * Security features: CSRF state tokens, session encryption, HTTPS enforcement.
 */
final class SteamAuthController
{
    private const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';
    private const STEAM_API_KEY_ENV = 'STEAM_API_KEY';
    
    private PDO $pdo;
    private UserRepository $userRepository;
    
    public function __construct(PDO $pdo, UserRepository $userRepository)
    {
        $this->pdo = $pdo;
        $this->userRepository = $userRepository;
    }
    
    /**
     * Initiates Steam OpenID login flow
     * 
     * @param array $query Expected: returnUrl (desktop app protocol or web URL)
     * @return array JSON response with redirect URL and state token
     */
    public function login(array $query, array $server): array
    {
        // Enforce HTTPS in production
        if (!$this->isSecureConnection($server) && $this->isProduction()) {
            return [
                'success' => false,
                'error' => 'HTTPS required for authentication',
                'code' => 'INSECURE_CONNECTION'
            ];
        }
        
        $returnUrl = $query['returnUrl'] ?? '';
        // Accept custom protocol URLs (e.g., cs-portfolio://) for desktop clients
        $isValidUrl = filter_var($returnUrl, FILTER_VALIDATE_URL) !== false
            || preg_match('/^[a-z][a-z0-9+.-]*:\/\//i', $returnUrl) === 1;
        if (!$isValidUrl) {
            return [
                'success' => false,
                'error' => 'Invalid return URL',
                'code' => 'INVALID_RETURN_URL'
            ];
        }
        
        // Generate CSRF state token (stored in temporary session/cache)
        $state = $this->generateStateToken();
        $this->storeStateToken($state, $returnUrl);
        
        // Build OpenID request
        $openidParams = [
            'openid.ns' => 'http://specs.openid.net/auth/2.0',
            'openid.mode' => 'checkid_setup',
            'openid.return_to' => $this->getCallbackUrl($server, $state),
            'openid.realm' => $this->getRealm($server),
            'openid.identity' => 'http://specs.openid.net/auth/2.0/identifier_select',
            'openid.claimed_id' => 'http://specs.openid.net/auth/2.0/identifier_select',
        ];
        
        $redirectUrl = self::STEAM_OPENID_URL . '?' . http_build_query($openidParams);
        
        return [
            'success' => true,
            'redirectUrl' => $redirectUrl,
            'state' => $state,
            'expiresIn' => 300 // 5 minutes
        ];
    }
    
    /**
     * Handles Steam OpenID callback
     * 
     * @param array $query OpenID response parameters
     * @return array User data and session token
     */
    public function callback(array $query, array $server): array
    {
        // Validate OpenID response
        if (!isset($query['openid_mode']) || $query['openid_mode'] !== 'id_res') {
            return [
                'success' => false,
                'error' => 'Invalid OpenID response',
                'code' => 'INVALID_OPENID_MODE'
            ];
        }
        
        // Extract and validate state token
        $state = $query['state'] ?? '';
        $storedData = $this->retrieveAndClearStateToken($state);
        
        if (!$storedData) {
            return [
                'success' => false,
                'error' => 'Invalid or expired session',
                'code' => 'INVALID_STATE'
            ];
        }
        
        // Verify OpenID signature with Steam
        $steamId = $this->verifyOpenIDResponse($query);
        
        if (!$steamId) {
            return [
                'success' => false,
                'error' => 'OpenID verification failed',
                'code' => 'OPENID_VERIFICATION_FAILED'
            ];
        }
        
        // Fetch Steam profile data
        $profile = $this->fetchSteamProfile($steamId);
        
        // Create or update user
        $userId = $this->userRepository->findOrCreateBySteamId(
            $steamId,
            $profile['name'] ?? null,
            $profile['avatar'] ?? null
        );

        $user = $this->userRepository->findById($userId);
        if ($user === null) {
            return [
                'success' => false,
                'error' => 'Failed to load authenticated user',
                'code' => 'USER_LOAD_FAILED'
            ];
        }

        $this->userRepository->touchLastLoginBySteamId($steamId);
        
        // Generate encrypted session token
        $sessionToken = $this->generateSessionToken($user);
        
        return [
            'success' => true,
            'user' => [
                'id' => $user['id'],
                'steamId' => $steamId,
                'name' => $profile['name'] ?? $user['steam_name'],
                'avatar' => $profile['avatar'] ?? $user['steam_avatar'],
            ],
            'sessionToken' => $sessionToken,
            'redirectUrl' => $storedData['returnUrl']
        ];
    }
    
    /**
     * Validates session token and returns user
     */
    public function validateSession(string $token): ?array
    {
        return $this->decryptSessionToken($token);
    }
    
    /**
     * Fetches CS2 inventory for a Steam user
     */
    public function getCS2Inventory(string $steamId64): array
    {
        $apiKey = $_ENV[self::STEAM_API_KEY_ENV] ?? null;
        
        if (!$apiKey) {
            // Fallback to public inventory endpoint (no API key needed)
            return $this->fetchPublicInventory($steamId64);
        }
        
        // Use Steam Web API with key for better reliability
        return $this->fetchInventoryWithApiKey($steamId64, $apiKey);
    }
    
    // ==================== PRIVATE METHODS ====================
    
    private function isSecureConnection(array $server): bool
    {
        return ($server['HTTPS'] ?? 'off') === 'on' || 
               ($server['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    }
    
    private function isProduction(): bool
    {
        return ($_ENV['APP_ENV'] ?? 'development') === 'production';
    }
    
    private function generateStateToken(): string
    {
        return bin2hex(random_bytes(32)); // 64 character hex string
    }
    
    private function storeStateToken(string $state, string $returnUrl): void
    {
        $expiresAt = date('Y-m-d H:i:s', strtotime('+5 minutes'));
        
        $sql = "INSERT INTO auth_state_tokens (state, return_url, expires_at, created_at)
                VALUES (:state, :return_url, :expires_at, NOW())
                ON DUPLICATE KEY UPDATE
                return_url = VALUES(return_url),
                expires_at = VALUES(expires_at),
                created_at = VALUES(created_at)";
        
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([
            ':state' => $state,
            ':return_url' => $returnUrl,
            ':expires_at' => $expiresAt
        ]);
    }
    
    private function retrieveAndClearStateToken(string $state): ?array
    {
        // Use atomic fetch-and-delete from repository to prevent replay attacks
        $authStateRepo = new \App\Infrastructure\Persistence\Repository\AuthStateRepository($this->pdo);
        return $authStateRepo->retrieveAndDelete($state);
    }
    
    private function getCallbackUrl(array $server, string $state): string
    {
        $scheme = $this->isSecureConnection($server) ? 'https' : 'http';
        $host = $server['HTTP_HOST'] ?? 'localhost';
        
        return "{$scheme}://{$host}/api/v1/auth/steam/callback?state={$state}";
    }
    
    private function getRealm(array $server): string
    {
        $scheme = $this->isSecureConnection($server) ? 'https' : 'http';
        $host = $server['HTTP_HOST'] ?? 'localhost';
        
        return "{$scheme}://{$host}";
    }
    
    private function verifyOpenIDResponse(array $query): ?string
    {
        // Validate OpenID signature by making verification request to Steam
        $params = $query;
        $params['openid.mode'] = 'check_authentication';
        
        $ch = curl_init(self::STEAM_OPENID_URL);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($params));
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);
        
        $response = curl_exec($ch);
        curl_close($ch);
        
        if (strpos($response, 'is_valid:true') === false) {
            return null;
        }
        
        // Extract SteamID from claimed_id
        // Format: https://steamcommunity.com/openid/id/{steamId64}
        if (isset($query['openid_claimed_id']) && 
            preg_match('/https:\/\/steamcommunity\.com\/openid\/id\/(\d+)/', 
                      $query['openid_claimed_id'], $matches)) {
            return $matches[1];
        }
        
        return null;
    }
    
    private function fetchSteamProfile(string $steamId64): array
    {
        $apiKey = $_ENV[self::STEAM_API_KEY_ENV] ?? null;
        
        if (!$apiKey) {
            return [];
        }
        
        $url = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/"
             . "?key={$apiKey}&steamids={$steamId64}";
        
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);
        
        $response = curl_exec($ch);
        curl_close($ch);
        
        $data = json_decode($response, true);
        $player = $data['response']['players'][0] ?? null;
        
        if (!$player) {
            return [];
        }
        
        return [
            'name' => $player['personaname'] ?? null,
            'avatar' => $player['avatarfull'] ?? null,
        ];
    }
    
    private function fetchPublicInventory(string $steamId64): array
    {
        // Public inventory endpoint (no API key required)
        $url = "https://steamcommunity.com/inventory/{$steamId64}/730/2?count=5000&l=english";
        
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_USERAGENT, 'CS-Portfolio-Tracker/1.0');
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        
        if ($httpCode !== 200) {
            return [
                'success' => false,
                'error' => 'Inventory not accessible (profile might be private)',
                'code' => 'INVENTORY_ACCESS_DENIED'
            ];
        }
        
        $data = json_decode($response, true);
        
        return [
            'success' => true,
            'items' => $this->parseCS2Items($data['assets'] ?? [], $data['descriptions'] ?? [])
        ];
    }
    
    private function fetchInventoryWithApiKey(string $steamId64, string $apiKey): array
    {
        // Steam Web API inventory endpoint
        $url = "https://api.steampowered.com/IEconItems_730/GetPlayerItems/v1/"
             . "?key={$apiKey}&steamid={$steamId64}";
        
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);
        
        $response = curl_exec($ch);
        curl_close($ch);
        
        $data = json_decode($response, true);
        
        return [
            'success' => true,
            'items' => $data['result']['items'] ?? []
        ];
    }
    
    private function parseCS2Items(array $assets, array $descriptions): array
    {
        $items = [];
        
        foreach ($assets as $asset) {
            $classId = $asset['classid'] ?? null;
            $instanceId = $asset['instanceid'] ?? null;
            
            // Find matching description
            $description = null;
            foreach ($descriptions as $desc) {
                if (($desc['classid'] ?? null) === $classId && 
                    ($desc['instanceid'] ?? null) === $instanceId) {
                    $description = $desc;
                    break;
                }
            }
            
            if (!$description) {
                continue;
            }
            
            $items[] = [
                'assetId' => $asset['assetid'] ?? null,
                'classId' => $classId,
                'instanceId' => $instanceId,
                'name' => $description['market_hash_name'] ?? $description['name'] ?? 'Unknown',
                'marketHashName' => $description['market_hash_name'] ?? null,
                'iconUrl' => $description['icon_url'] ?? null,
                'tradable' => ($description['tradable'] ?? 0) === 1,
                'marketable' => ($description['marketable'] ?? 0) === 1,
                'type' => $this->determineItemType($description['market_hash_name'] ?? ''),
            ];
        }
        
        return $items;
    }
    
    private function determineItemType(string $marketHashName): string
    {
        $name = strtolower($marketHashName);
        
        if (strpos($name, 'case') !== false) return 'case';
        if (strpos($name, 'sticker') !== false) return 'sticker';
        if (strpos($name, 'patch') !== false) return 'patch';
        if (strpos($name, 'agent') !== false) return 'agent';
        if (strpos($name, 'graffiti') !== false) return 'graffiti';
        if (strpos($name, 'music') !== false || strpos($name, 'kit') !== false) return 'music_kit';
        
        return 'skin';
    }
    
    private function getEncryptionKey(): string
    {
        $key = $_ENV['ENCRYPTION_KEY'] ?? null;
        if ($key === null || $key === '' || $key === 'default-key-change-in-production') {
            throw new \RuntimeException('ENCRYPTION_KEY environment variable is required and must not be the default value');
        }
        return $key;
    }
    
    private function generateSessionToken(array $user): string
    {
        $payload = [
            'userId' => $user['id'],
            'steamId' => $user['steam_id'],
            'name' => $user['steam_name'] ?? null,
            'avatar' => $user['steam_avatar'] ?? null,
            'exp' => time() + (30 * 24 * 60 * 60), // 30 days
            'iat' => time(),
            'type' => 'session'
        ];
        
        return $this->encryptToken($payload);
    }
    
    private function encryptToken(array $payload): string
    {
        $key = $this->getEncryptionKey();
        $json = json_encode($payload);
        
        // Simple encryption using AES-256-GCM
        $iv = random_bytes(16);
        $encrypted = openssl_encrypt($json, 'AES-256-GCM', $key, 0, $iv, $tag);
        
        return base64_encode($iv . $tag . $encrypted);
    }
    
    private function decryptSessionToken(string $token): ?array
    {
        try {
            $key = $this->getEncryptionKey();
            $data = base64_decode($token);
            
            if (strlen($data) < 32) {
                return null;
            }
            
            $iv = substr($data, 0, 16);
            $tag = substr($data, 16, 16);
            $encrypted = substr($data, 32);
            
            $json = openssl_decrypt($encrypted, 'AES-256-GCM', $key, 0, $iv, $tag);
            
            if (!$json) {
                return null;
            }
            
            $payload = json_decode($json, true);
            
            // Check expiration
            if (($payload['exp'] ?? 0) < time()) {
                return null;
            }
            
            return $payload;
        } catch (\RuntimeException $e) {
            // Missing or invalid encryption key - log and return null
            error_log('[auth] Session decryption failed: ' . $e->getMessage());
            return null;
        } catch (\Throwable $e) {
            // Unexpected error - log for debugging
            error_log('[auth] Unexpected session decryption error: ' . $e->getMessage());
            return null;
        }
    }
}
