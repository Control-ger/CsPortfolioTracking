<?php
/**
 * Aktualisiert die Preise für alle Watchlist-Items und speichert sie in price_history
 * Sollte täglich ausgeführt werden (z.B. via Cronjob)
 */

header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json");

$host = '***REMOVED***'; $***REMOVED***   = '***REMOVED***';
 $user = '***REMOVED***'; $pass = '***REMOVED***123';


// Funktion zum Abrufen des Preises von CSFloat
function getCSFloatPrice($marketHashName) {
    $encodedName = urlencode($marketHashName);
    $url = "https://csfloat.com/api/v1/listings?market_hash_name={$encodedName}&type=buy_now&sort_by=lowest_price&limit=1";
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0');
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($httpCode !== 200 || !$response) {
        return null;
    }
    
    $data = json_decode($response, true);
    if (isset($data['data']) && count($data['data']) > 0) {
        return $data['data'][0]['price'] / 100; // Preis in USD
    }
    
    return null;
}

// Funktion zum Abrufen des Wechselkurses
function getExchangeRate() {
    $url = "https://api.exchangerate-api.com/v4/latest/USD";
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    
    $response = curl_exec($ch);
    curl_close($ch);
    
    if (!$response) {
        return 0.92; // Fallback-Wechselkurs
    }
    
    $data = json_decode($response, true);
    return isset($data['rates']['EUR']) ? $data['rates']['EUR'] : 0.92;
}

try {
    $pdo = new PDO("mysql:host=$host;***REMOVED***name=$***REMOVED***;charset=utf8", $user, $pass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    // Sicherstellen, dass Tabellen existieren
    $initStmt = $pdo->query("SHOW TABLES LIKE 'watchlist'");
    if ($initStmt->rowCount() === 0) {
        echo json_encode([
            "success" => false,
            "error" => "Watchlist-Tabelle existiert nicht."
        ]);
        exit;
    }

    $initStmt = $pdo->query("SHOW TABLES LIKE 'price_history'");
    if ($initStmt->rowCount() === 0) {
        $createPriceHistorySQL = "
            CREATE TABLE price_history (
                id INT AUTO_INCREMENT PRIMARY KEY,
                item_name VARCHAR(255) NOT NULL,
                date DATE NOT NULL,
                price_usd DECIMAL(10, 2) NOT NULL,
                price_eur DECIMAL(10, 2) NOT NULL,
                exchange_rate DECIMAL(10, 6) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_item_date (item_name, date),
                INDEX idx_item_name (item_name),
                INDEX idx_date (date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        ";
        $pdo->exec($createPriceHistorySQL);
    }

    // Alle Watchlist-Items abrufen
    $stmt = $pdo->query("SELECT id, name FROM watchlist");
    $watchlistItems = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $today = date('Y-m-d');
    $exchangeRate = getExchangeRate();
    $updated = 0;
    $errors = [];

    foreach ($watchlistItems as $item) {
        $itemName = $item['name'];
        
        // Prüfen, ob für heute bereits ein Eintrag existiert
        $checkStmt = $pdo->prepare("SELECT id FROM price_history WHERE item_name = ? AND date = ?");
        $checkStmt->execute([$itemName, $today]);
        $existing = $checkStmt->fetch(PDO::FETCH_ASSOC);

        if ($existing) {
            continue; // Bereits aktualisiert
        }

        // Preis von CSFloat abrufen
        $priceUsd = getCSFloatPrice($itemName);
        
        if ($priceUsd === null) {
            $errors[] = "Konnte Preis für {$itemName} nicht abrufen.";
            continue;
        }

        $priceEur = $priceUsd * $exchangeRate;

        // In price_history speichern
        $insertStmt = $pdo->prepare("
            INSERT INTO price_history (item_name, date, price_usd, price_eur, exchange_rate) 
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
                price_usd = VALUES(price_usd),
                price_eur = VALUES(price_eur),
                exchange_rate = VALUES(exchange_rate)
        ");
        $insertStmt->execute([$itemName, $today, $priceUsd, $priceEur, $exchangeRate]);
        $updated++;

        // Kurze Pause zwischen API-Aufrufen
        usleep(200000); // 200ms
    }

    echo json_encode([
        "success" => true,
        "updated" => $updated,
        "total_items" => count($watchlistItems),
        "errors" => $errors
    ]);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode([
        "success" => false,
        "error" => $e->getMessage()
    ]);
}
?>
