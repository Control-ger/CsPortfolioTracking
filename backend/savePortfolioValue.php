<?php
/**
 * Speichert den aktuellen Portfolio-Gesamtwert einmal täglich
 * Prüft, ob für das heutige Datum bereits ein Wert existiert, um Dubletten zu vermeiden
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

    // Zuerst sicherstellen, dass die Tabelle existiert
    $stmt = $pdo->query("SHOW TABLES LIKE '***REMOVED***_history'");
    $tableExists = $stmt->rowCount() > 0;

    if (!$tableExists) {
        // Tabelle erstellen, falls sie nicht existiert
        $createTableSQL = "
            CREATE TABLE ***REMOVED***_history (
                id INT AUTO_INCREMENT PRIMARY KEY,
                date DATE NOT NULL UNIQUE,
                total_value DECIMAL(10, 2) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_date (date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        ";
        $pdo->exec($createTableSQL);
    }

    // Heutiges Datum
    $today = date('Y-m-d');

    // Prüfen, ob für heute bereits ein Eintrag existiert
    $checkStmt = $pdo->prepare("SELECT id FROM ***REMOVED***_history WHERE date = ?");
    $checkStmt->execute([$today]);
    $existingEntry = $checkStmt->fetch(PDO::FETCH_ASSOC);

    if ($existingEntry) {
        // Eintrag existiert bereits - aktualisieren statt neu anlegen
        $totalValue = isset($_POST['total_value']) ? floatval($_POST['total_value']) : null;
        
        if ($totalValue === null) {
            // Wenn kein Wert übergeben wurde, versuche den Wert aus der investments Tabelle zu berechnen
            // (Fallback, falls Frontend keinen Wert sendet)
            $investmentsStmt = $pdo->query("SELECT buy_price, quantity FROM investments");
            $investments = $investmentsStmt->fetchAll(PDO::FETCH_ASSOC);
            $totalValue = 0;
            foreach ($investments as $inv) {
                $totalValue += floatval($inv['buy_price']) * intval($inv['quantity']);
            }
        }

        $updateStmt = $pdo->prepare("UPDATE ***REMOVED***_history SET total_value = ? WHERE date = ?");
        $updateStmt->execute([$totalValue, $today]);
        
        echo json_encode([
            "success" => true,
            "message" => "Portfolio-Wert für heute wurde aktualisiert.",
            "date" => $today,
            "total_value" => $totalValue,
            "action" => "updated"
        ]);
    } else {
        // Neuer Eintrag für heute
        $totalValue = isset($_POST['total_value']) ? floatval($_POST['total_value']) : null;
        
        if ($totalValue === null) {
            // Fallback: Wert aus investments Tabelle berechnen
            $investmentsStmt = $pdo->query("SELECT buy_price, quantity FROM investments");
            $investments = $investmentsStmt->fetchAll(PDO::FETCH_ASSOC);
            $totalValue = 0;
            foreach ($investments as $inv) {
                $totalValue += floatval($inv['buy_price']) * intval($inv['quantity']);
            }
        }

        $insertStmt = $pdo->prepare("INSERT INTO ***REMOVED***_history (date, total_value) VALUES (?, ?)");
        $insertStmt->execute([$today, $totalValue]);
        
        echo json_encode([
            "success" => true,
            "message" => "Portfolio-Wert für heute wurde gespeichert.",
            "date" => $today,
            "total_value" => $totalValue,
            "action" => "inserted"
        ]);
    }

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode([
        "success" => false,
        "error" => $e->getMessage()
    ]);
}
?>
