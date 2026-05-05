<?php
declare(strict_types=1);

namespace App\Http\Controller;

final class DesktopSteamAuthController
{
    private const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';
    private const STEAM_API_KEY_ENV = 'STEAM_API_KEY';

    public function login(array $query, array $server): array
    {
        $returnUrl = (string) ($query['returnUrl'] ?? '');
        $isValidUrl = filter_var($returnUrl, FILTER_VALIDATE_URL) !== false
            || preg_match('/^[a-z][a-z0-9+.-]*:\/\//i', $returnUrl) === 1;

        if (!$isValidUrl) {
            return [
                'success' => false,
                'error' => 'Invalid return URL',
                'code' => 'INVALID_RETURN_URL',
            ];
        }

        $state = bin2hex(random_bytes(32));
        $this->storeState($state, $returnUrl);

        $openidParams = [
            'openid.ns' => 'http://specs.openid.net/auth/2.0',
            'openid.mode' => 'checkid_setup',
            'openid.return_to' => $this->getCallbackUrl($server, $state),
            'openid.realm' => $this->getRealm($server),
            'openid.identity' => 'http://specs.openid.net/auth/2.0/identifier_select',
            'openid.claimed_id' => 'http://specs.openid.net/auth/2.0/identifier_select',
        ];

        return [
            'success' => true,
            'redirectUrl' => self::STEAM_OPENID_URL . '?' . http_build_query($openidParams),
            'state' => $state,
            'expiresIn' => 300,
        ];
    }

    public function callback(array $query, array $server): array
    {
        if (($query['openid_mode'] ?? '') !== 'id_res') {
            return [
                'success' => false,
                'error' => 'Invalid OpenID response',
                'code' => 'INVALID_OPENID_MODE',
            ];
        }

        $state = (string) ($query['state'] ?? '');
        $storedState = $this->retrieveAndClearState($state);
        if ($storedState === null) {
            return [
                'success' => false,
                'error' => 'Invalid or expired session',
                'code' => 'INVALID_STATE',
            ];
        }

        $steamId = $this->verifyOpenIdResponse($query);
        if ($steamId === null) {
            return [
                'success' => false,
                'error' => 'OpenID verification failed',
                'code' => 'OPENID_VERIFICATION_FAILED',
            ];
        }

        $profile = $this->fetchSteamProfile($steamId);
        $user = [
            'id' => 'steam-' . $steamId,
            'steamId' => $steamId,
            'name' => $profile['name'] ?? 'Steam User',
            'avatar' => $profile['avatar'] ?? null,
        ];
        $sessionToken = $this->generateSessionToken($user);

        $this->storeAuthResult($state, [
            'success' => true,
            'user' => $user,
            'sessionToken' => $sessionToken,
            'createdAt' => time(),
            'expiresAt' => time() + 300,
        ]);

        return [
            'success' => true,
            'user' => $user,
            'sessionToken' => $sessionToken,
            'redirectUrl' => $storedState['returnUrl'],
        ];
    }

    public function getAuthResult(string $state): array
    {
        $result = $this->retrieveAuthResult($state);
        if ($result === null) {
            return [
                'success' => false,
                'pending' => true,
            ];
        }

        return $result;
    }

    public function validateSession(string $token): ?array
    {
        $payload = $this->decryptSessionToken($token);
        if (!is_array($payload)) {
            return null;
        }

        $steamId = (string) ($payload['steamId'] ?? '');
        $hasName = is_string($payload['name'] ?? null) && trim((string) $payload['name']) !== '';
        $hasAvatar = is_string($payload['avatar'] ?? null) && trim((string) $payload['avatar']) !== '';

        if ($steamId !== '' && (!$hasName || !$hasAvatar)) {
            $profile = $this->fetchSteamProfile($steamId);
            if (!$hasName && is_string($profile['name'] ?? null) && trim((string) $profile['name']) !== '') {
                $payload['name'] = (string) $profile['name'];
            }
            if (!$hasAvatar && is_string($profile['avatar'] ?? null) && trim((string) $profile['avatar']) !== '') {
                $payload['avatar'] = (string) $profile['avatar'];
            }
        }

        return $payload;
    }

    public function getCS2Inventory(string $steamId64): array
    {
        return $this->fetchPublicInventory($steamId64);
    }

    private function getCallbackUrl(array $server, string $state): string
    {
        $host = (string) ($server['HTTP_HOST'] ?? '127.0.0.1');
        return "http://{$host}/api/v1/auth/steam/callback?state={$state}";
    }

    private function getRealm(array $server): string
    {
        $host = (string) ($server['HTTP_HOST'] ?? '127.0.0.1');
        return "http://{$host}";
    }

    private function stateFilePath(): string
    {
        $baseDir = getenv('DESKTOP_STATE_DIR') ?: sys_get_temp_dir();
        return rtrim($baseDir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'csportfolio_desktop_auth_state.json';
    }

    private function authResultFilePath(): string
    {
        $baseDir = getenv('DESKTOP_STATE_DIR') ?: sys_get_temp_dir();
        return rtrim($baseDir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'csportfolio_desktop_auth_result.json';
    }

    private function readStates(): array
    {
        $path = $this->stateFilePath();
        if (!is_file($path)) {
            return [];
        }

        $decoded = json_decode((string) file_get_contents($path), true);
        return is_array($decoded) ? $decoded : [];
    }

    private function writeStates(array $states): void
    {
        $path = $this->stateFilePath();
        @mkdir(dirname($path), 0755, true);
        file_put_contents($path, json_encode($states, JSON_UNESCAPED_SLASHES));
    }

    private function readAuthResults(): array
    {
        $path = $this->authResultFilePath();
        if (!is_file($path)) {
            return [];
        }

        $decoded = json_decode((string) file_get_contents($path), true);
        return is_array($decoded) ? $decoded : [];
    }

    private function writeAuthResults(array $results): void
    {
        $path = $this->authResultFilePath();
        @mkdir(dirname($path), 0755, true);
        file_put_contents($path, json_encode($results, JSON_UNESCAPED_SLASHES));
    }

    private function storeState(string $state, string $returnUrl): void
    {
        $states = array_filter(
            $this->readStates(),
            static fn (array $entry): bool => (int) ($entry['expiresAt'] ?? 0) > time()
        );
        $states[$state] = [
            'returnUrl' => $returnUrl,
            'expiresAt' => time() + 300,
        ];
        $this->writeStates($states);
    }

    private function retrieveAndClearState(string $state): ?array
    {
        $states = $this->readStates();
        $entry = $states[$state] ?? null;
        unset($states[$state]);
        $this->writeStates($states);

        if (!is_array($entry) || (int) ($entry['expiresAt'] ?? 0) <= time()) {
            return null;
        }

        return $entry;
    }

    private function storeAuthResult(string $state, array $result): void
    {
        $results = array_filter(
            $this->readAuthResults(),
            static fn (array $entry): bool => (int) ($entry['expiresAt'] ?? 0) > time()
        );
        $results[$state] = $result;
        $this->writeAuthResults($results);
    }

    private function retrieveAuthResult(string $state): ?array
    {
        $results = $this->readAuthResults();
        $result = $results[$state] ?? null;

        if (!is_array($result) || (int) ($result['expiresAt'] ?? 0) <= time()) {
            return null;
        }

        return $result;
    }

    private function verifyOpenIdResponse(array $query): ?string
    {
        $params = $this->normalizeOpenIdParams($query);
        $params['openid.mode'] = 'check_authentication';

        $ch = curl_init(self::STEAM_OPENID_URL);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($params));
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        $this->applyDesktopCurlTlsOptions($ch);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);

        $response = curl_exec($ch);
        $curlError = curl_error($ch);
        curl_close($ch);

        if (!is_string($response) || !str_contains($response, 'is_valid:true')) {
            error_log('[desktop-auth] Steam OpenID verification failed: ' . ($curlError !== '' ? $curlError : (string) $response));
            return null;
        }

        $claimedId = (string) ($params['openid.claimed_id'] ?? '');
        if (preg_match('/https:\/\/steamcommunity\.com\/openid\/id\/(\d+)/', $claimedId, $matches) === 1) {
            return $matches[1];
        }

        return null;
    }

    private function normalizeOpenIdParams(array $query): array
    {
        $params = [];

        foreach ($query as $key => $value) {
            $normalizedKey = (string) $key;
            if (str_starts_with($normalizedKey, 'openid_')) {
                $normalizedKey = 'openid.' . substr($normalizedKey, strlen('openid_'));
            }

            $params[$normalizedKey] = $value;
        }

        return $params;
    }

    private function fetchSteamProfile(string $steamId64): array
    {
        $apiKey = getenv(self::STEAM_API_KEY_ENV) ?: ($_ENV[self::STEAM_API_KEY_ENV] ?? null);
        if (is_string($apiKey) && $apiKey !== '') {
            $url = 'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?'
                . http_build_query(['key' => $apiKey, 'steamids' => $steamId64]);

            $data = $this->fetchJson($url, 10);
            $player = $data['response']['players'][0] ?? null;
            if (is_array($player)) {
                return [
                    'name' => $player['personaname'] ?? null,
                    'avatar' => $player['avatarfull'] ?? null,
                ];
            }
        }

        return $this->fetchSteamProfilePublic($steamId64);
    }

    private function fetchSteamProfilePublic(string $steamId64): array
    {
        $url = "https://steamcommunity.com/profiles/{$steamId64}/?xml=1";

        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        $this->applyDesktopCurlTlsOptions($ch);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_USERAGENT, 'CS-Portfolio-Desktop/1.0');

        $response = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if (!is_string($response) || $response === '' || $httpCode !== 200) {
            return [];
        }

        $xml = @simplexml_load_string($response);
        if (!$xml instanceof \SimpleXMLElement) {
            return [];
        }

        $name = trim((string) ($xml->steamID ?? ''));
        $avatarFull = trim((string) ($xml->avatarFull ?? ''));
        $avatarMedium = trim((string) ($xml->avatarMedium ?? ''));
        $avatarIcon = trim((string) ($xml->avatarIcon ?? ''));

        return [
            'name' => $name !== '' ? $name : null,
            'avatar' => $avatarFull !== '' ? $avatarFull : ($avatarMedium !== '' ? $avatarMedium : ($avatarIcon !== '' ? $avatarIcon : null)),
        ];
    }

    private function fetchPublicInventory(string $steamId64): array
    {
        $url = "https://steamcommunity.com/inventory/{$steamId64}/730/2?count=2000&l=english";
        $result = $this->fetchJsonWithStatus($url, 30);
        $data = $result['data'] ?? null;
        $httpCode = (int) ($result['httpCode'] ?? 0);

        if (!is_array($data)) {
            return [
                'success' => false,
                'error' => 'Inventory not accessible (private profile, rate-limited, or Steam returned invalid response)',
                'code' => 'INVENTORY_ACCESS_DENIED',
                'details' => ['httpCode' => $httpCode],
            ];
        }

        $assets = is_array($data['assets'] ?? null) ? $data['assets'] : [];
        $descriptions = is_array($data['descriptions'] ?? null) ? $data['descriptions'] : [];
        if ($assets === [] && $descriptions === []) {
            return [
                'success' => false,
                'error' => 'Inventory appears empty or inaccessible. Items in Storage Units may not be visible via this endpoint.',
                'code' => 'INVENTORY_EMPTY_OR_INACCESSIBLE',
                'details' => ['httpCode' => $httpCode],
            ];
        }

        return [
            'success' => true,
            'items' => $this->parseCS2Items($assets, $descriptions),
        ];
    }

    private function fetchJson(string $url, int $timeout): ?array
    {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        $this->applyDesktopCurlTlsOptions($ch);
        curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_USERAGENT, 'CS-Portfolio-Desktop/1.0');

        $response = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($response === false || $httpCode !== 200) {
            return null;
        }

        $decoded = json_decode((string) $response, true);
        return is_array($decoded) ? $decoded : null;
    }

    private function fetchJsonWithStatus(string $url, int $timeout): array
    {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        $this->applyDesktopCurlTlsOptions($ch);
        curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_USERAGENT, 'CS-Portfolio-Desktop/1.0');

        $response = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($response === false || $httpCode !== 200) {
            return [
                'data' => null,
                'httpCode' => $httpCode,
            ];
        }

        $decoded = json_decode((string) $response, true);
        return [
            'data' => is_array($decoded) ? $decoded : null,
            'httpCode' => $httpCode,
        ];
    }

    private function applyDesktopCurlTlsOptions(\CurlHandle $ch): void
    {
        // The desktop sidecar runs on the user's local PHP installation. On
        // Windows, portable PHP often ships without a configured CA bundle.
        // Keep this exception scoped to the desktop controller; server routes
        // still use normal TLS verification.
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
    }

    private function parseCS2Items(array $assets, array $descriptions): array
    {
        $descriptionsByKey = [];
        foreach ($descriptions as $description) {
            if (!is_array($description)) {
                continue;
            }
            $key = ($description['classid'] ?? '') . ':' . ($description['instanceid'] ?? '');
            $descriptionsByKey[$key] = $description;
        }

        $items = [];
        foreach ($assets as $asset) {
            if (!is_array($asset)) {
                continue;
            }

            $key = ($asset['classid'] ?? '') . ':' . ($asset['instanceid'] ?? '');
            $description = $descriptionsByKey[$key] ?? null;
            if (!is_array($description)) {
                continue;
            }

            $marketHashName = (string) ($description['market_hash_name'] ?? $description['name'] ?? 'Unknown');
            $inspectLink = null;
            $actions = $description['actions'] ?? [];
            if (is_array($actions)) {
                foreach ($actions as $action) {
                    if (!is_array($action)) {
                        continue;
                    }
                    $link = (string) ($action['link'] ?? '');
                    if ($link !== '' && str_contains(strtolower((string) ($action['name'] ?? '')), 'inspect')) {
                        $inspectLink = $link;
                        break;
                    }
                }
            }
            $items[] = [
                'assetId' => $asset['assetid'] ?? null,
                'classId' => $asset['classid'] ?? null,
                'instanceId' => $asset['instanceid'] ?? null,
                'name' => $marketHashName,
                'marketHashName' => $marketHashName,
                'iconUrl' => $description['icon_url'] ?? null,
                'inspectLink' => $inspectLink,
                'tradable' => ((int) ($description['tradable'] ?? 0)) === 1,
                'marketable' => ((int) ($description['marketable'] ?? 0)) === 1,
                'type' => $this->determineItemType($marketHashName),
            ];
        }

        return $items;
    }

    private function determineItemType(string $marketHashName): string
    {
        $name = strtolower($marketHashName);

        if (str_contains($name, 'case')) {
            return 'case';
        }
        if (str_contains($name, 'sticker')) {
            return 'sticker';
        }
        if (str_contains($name, 'patch')) {
            return 'patch';
        }
        if (str_contains($name, 'agent')) {
            return 'agent';
        }
        if (str_contains($name, 'graffiti')) {
            return 'graffiti';
        }
        if (str_contains($name, 'music') || str_contains($name, 'kit')) {
            return 'music_kit';
        }

        return 'skin';
    }

    private function getEncryptionKey(): string
    {
        $key = getenv('ENCRYPTION_KEY') ?: ($_ENV['ENCRYPTION_KEY'] ?? null);
        if (!is_string($key) || $key === '') {
            throw new \RuntimeException('ENCRYPTION_KEY environment variable is required');
        }

        return hash('sha256', $key, true);
    }

    private function generateSessionToken(array $user): string
    {
        return $this->encryptToken([
            'userId' => $user['id'],
            'steamId' => $user['steamId'],
            'name' => $user['name'] ?? null,
            'avatar' => $user['avatar'] ?? null,
            'exp' => time() + (30 * 24 * 60 * 60),
            'iat' => time(),
            'type' => 'desktop-session',
        ]);
    }

    private function encryptToken(array $payload): string
    {
        $iv = random_bytes(12);
        $json = json_encode($payload, JSON_UNESCAPED_SLASHES);
        $encrypted = openssl_encrypt((string) $json, 'AES-256-GCM', $this->getEncryptionKey(), OPENSSL_RAW_DATA, $iv, $tag);

        if ($encrypted === false) {
            throw new \RuntimeException('Failed to encrypt session token');
        }

        return base64_encode($iv . $tag . $encrypted);
    }

    private function decryptSessionToken(string $token): ?array
    {
        $raw = base64_decode($token, true);
        if (!is_string($raw) || strlen($raw) < 29) {
            return null;
        }

        $iv = substr($raw, 0, 12);
        $tag = substr($raw, 12, 16);
        $encrypted = substr($raw, 28);
        $json = openssl_decrypt($encrypted, 'AES-256-GCM', $this->getEncryptionKey(), OPENSSL_RAW_DATA, $iv, $tag);
        if (!is_string($json)) {
            return null;
        }

        $payload = json_decode($json, true);
        if (!is_array($payload) || (int) ($payload['exp'] ?? 0) < time()) {
            return null;
        }

        return $payload;
    }
}
