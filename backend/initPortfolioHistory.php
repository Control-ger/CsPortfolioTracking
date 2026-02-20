<?php
/**
 * Prüft, ob die Tabelle ***REMOVED***_history existiert und erstellt sie falls nötig
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

    // Prüfen, ob die Tabelle existiert
    $stmt = $pdo->query("SHOW TABLES LIKE '***REMOVED***_history'");
    $tableExists = $stmt->rowCount() > 0;

    if (!$tableExists) {
        // Tabelle erstellen
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
        
        echo json_encode([
            "success" => true,
            "message" => "Tabelle ***REMOVED***_history wurde erfolgreich erstellt.",
            "table_created" => true
        ]);
    } else {
        echo json_encode([
            "success" => true,
            "message" => "Tabelle ***REMOVED***_history existiert bereits.",
            "table_created" => false
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
