<?php
/**
 * Gibt Watchlist-Items mit Preisänderungen der letzten 7 Tage zurück
 */

header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json");

$host = 'localhost';
$***REMOVED***   = 'cs_***REMOVED***_tracker';
$user = '***REMOVED***';
$pass = '';

try {
    $pdo = new PDO("mysql:host=$host;***REMOVED***name=$***REMOVED***;charset=utf8", $user, $pass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    // Sicherstellen, dass Tabellen existieren
    $initStmt = $pdo->query("SHOW TABLES LIKE 'watchlist'");
    if ($initStmt->rowCount() === 0) {
        echo json_encode([]);
        exit;
    }

    // Watchlist-Items abrufen
    $stmt = $pdo->query("SELECT id, name, type, added_at FROM watchlist ORDER BY added_at DESC");
    $watchlistItems = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Für jedes Item Preisänderungen berechnen
    $result = [];
    $sevenDaysAgo = date('Y-m-d', strtotime('-7 days'));
    $today = date('Y-m-d');

    foreach ($watchlistItems as $item) {
        $itemName = $item['name'];
        
        // Aktuellen Preis aus price_history holen (heute oder neueste verfügbare)
        $currentPriceStmt = $pdo->prepare("
            SELECT price_eur, date 
            FROM price_history 
            WHERE item_name = ? AND date <= ? 
            ORDER BY date DESC 
            LIMIT 1
        ");
        $currentPriceStmt->execute([$itemName, $today]);
        $currentPriceData = $currentPriceStmt->fetch(PDO::FETCH_ASSOC);
        
        // Preis von vor 7 Tagen holen
        $oldPriceStmt = $pdo->prepare("
            SELECT price_eur, date 
            FROM price_history 
            WHERE item_name = ? AND date <= ? 
            ORDER BY date DESC 
            LIMIT 1
        ");
        $oldPriceStmt->execute([$itemName, $sevenDaysAgo]);
        $oldPriceData = $oldPriceStmt->fetch(PDO::FETCH_ASSOC);

        $currentPrice = $currentPriceData ? floatval($currentPriceData['price_eur']) : null;
        $oldPrice = $oldPriceData ? floatval($oldPriceData['price_eur']) : null;
        
        // Preisänderung berechnen
        $priceChange = null;
        $priceChangePercent = null;
        
        if ($currentPrice !== null && $oldPrice !== null && $oldPrice > 0) {
            $priceChange = $currentPrice - $oldPrice;
            $priceChangePercent = ($priceChange / $oldPrice) * 100;
        }

        // Preisverlauf der letzten 7 Tage abrufen
        $historyStmt = $pdo->prepare("
            SELECT date, price_eur 
            FROM price_history 
            WHERE item_name = ? AND date >= ? 
            ORDER BY date ASC
        ");
        $historyStmt->execute([$itemName, $sevenDaysAgo]);
        $priceHistory = $historyStmt->fetchAll(PDO::FETCH_ASSOC);
        
        $formattedHistory = array_map(function($entry) {
            return [
                'date' => $entry['date'],
                'wert' => floatval($entry['price_eur'])
            ];
        }, $priceHistory);

        $result[] = [
            'id' => intval($item['id']),
            'name' => $item['name'],
            'type' => $item['type'],
            'added_at' => $item['added_at'],
            'current_price' => $currentPrice,
            'price_change' => $priceChange,
            'price_change_percent' => $priceChangePercent,
            'price_history' => $formattedHistory
        ];
    }

    echo json_encode($result);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode([
        "error" => $e->getMessage()
    ]);
}
?>
