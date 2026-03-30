<?php
/**
 * Prüft, ob die Tabellen watchlist und price_history existieren und erstellt sie falls nötig
 */

header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json");

$host = '***REMOVED***'; $***REMOVED***   = '***REMOVED***';
$user = '***REMOVED***'; $pass = '***REMOVED***123';


try {
    $pdo = new PDO("mysql:host=$host;***REMOVED***name=$***REMOVED***;charset=utf8", $user, $pass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    $results = [];

    // 1. Prüfen und erstellen der watchlist Tabelle
    $stmt = $pdo->query("SHOW TABLES LIKE 'watchlist'");
    $watchlistExists = $stmt->rowCount() > 0;

    if (!$watchlistExists) {
        $createWatchlistSQL = "
            CREATE TABLE watchlist (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                type VARCHAR(50) DEFAULT 'skin',
                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_name (name),
                INDEX idx_added_at (added_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        ";
        $pdo->exec($createWatchlistSQL);
        $results['watchlist'] = ['created' => true, 'message' => 'Tabelle watchlist wurde erstellt.'];
    } else {
        $results['watchlist'] = ['created' => false, 'message' => 'Tabelle watchlist existiert bereits.'];
    }

    // 2. Prüfen und erstellen der price_history Tabelle
    $stmt = $pdo->query("SHOW TABLES LIKE 'price_history'");
    $priceHistoryExists = $stmt->rowCount() > 0;

    if (!$priceHistoryExists) {
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
        $results['price_history'] = ['created' => true, 'message' => 'Tabelle price_history wurde erstellt.'];
    } else {
        $results['price_history'] = ['created' => false, 'message' => 'Tabelle price_history existiert bereits.'];
    }

    echo json_encode([
        "success" => true,
        "results" => $results
    ]);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode([
        "success" => false,
        "error" => $e->getMessage()
    ]);
}
?>
