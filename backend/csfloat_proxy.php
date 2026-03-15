<?php
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json");

/**
 * Hilfsfunktion zum Laden der .env Datei
 */
function getEnvKey($key, $default = null) {
    // Pfad zur .env Datei (Anpassen, falls die .env woanders liegt)
    // Wir schauen im aktuellen Ordner und im Ordner darüber nach
    $paths = ['./.env', '../.env', '../../.env'];
    foreach ($paths as $path) {
        if (file_exists($path)) {
            $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            foreach ($lines as $line) {
                if (strpos(trim($line), '#') === 0) continue;
                list($name, $value) = explode('=', $line, 2);
                $name = trim($name);
                $value = trim($value, " \t\n\r\0\x0B\"'"); // Entfernt auch Anführungszeichen
                if ($name === $key) return $value;
            }
        }
    }
    return $default;
}

$api_key = getEnvKey('CSFLOAT_API_KEY');

if (!$api_key) {
    http_response_code(500);
    echo json_encode(["error" => "API Key nicht in .env gefunden"]);
    exit;
}

$market_hash_name = $_GET['market_hash_name'] ?? '';
if (empty($market_hash_name)) {
    echo json_encode(["error" => "No item name provided"]);
    exit;
}

$encodedName = urlencode($market_hash_name);
$url = "https://csfloat.com/api/v1/listings?market_hash_name=$encodedName&type=buy_now&sort_by=lowest_price&limit=1";

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Authorization: $api_key",
    "Accept: application/json",
    "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0"
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

http_response_code($httpCode);
echo $response;
?>