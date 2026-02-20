<?php
/**
 * Verwaltet die Watchlist: Items hinzufügen, abrufen, löschen
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
    }

    $method = $_SERVER['REQUEST_METHOD'];
    $action = $_GET['action'] ?? '';

    switch ($method) {
        case 'GET':
            // Alle Watchlist-Items abrufen
            $stmt = $pdo->query("SELECT id, name, type, added_at FROM watchlist ORDER BY added_at DESC");
            $items = $stmt->fetchAll(PDO::FETCH_ASSOC);
            
            echo json_encode([
                "success" => true,
                "data" => $items
            ]);
            break;

        case 'POST':
            // Item hinzufügen
            $data = json_decode(file_get_contents('php://input'), true);
            $name = $data['name'] ?? '';
            $type = $data['type'] ?? 'skin';

            if (empty($name)) {
                http_response_code(400);
                echo json_encode([
                    "success" => false,
                    "error" => "Name ist erforderlich."
                ]);
                exit;
            }

            // Prüfen, ob Item bereits vorhanden
            $checkStmt = $pdo->prepare("SELECT id FROM watchlist WHERE name = ?");
            $checkStmt->execute([$name]);
            $existing = $checkStmt->fetch(PDO::FETCH_ASSOC);

            if ($existing) {
                http_response_code(409);
                echo json_encode([
                    "success" => false,
                    "error" => "Item ist bereits in der Watchlist vorhanden."
                ]);
                exit;
            }

            // Item hinzufügen
            $insertStmt = $pdo->prepare("INSERT INTO watchlist (name, type) VALUES (?, ?)");
            $insertStmt->execute([$name, $type]);
            
            echo json_encode([
                "success" => true,
                "message" => "Item wurde zur Watchlist hinzugefügt.",
                "id" => $pdo->lastInsertId()
            ]);
            break;

        case 'DELETE':
            // Item löschen
            $data = json_decode(file_get_contents('php://input'), true);
            $id = $data['id'] ?? null;

            if ($id === null) {
                http_response_code(400);
                echo json_encode([
                    "success" => false,
                    "error" => "ID ist erforderlich."
                ]);
                exit;
            }

            $deleteStmt = $pdo->prepare("DELETE FROM watchlist WHERE id = ?");
            $deleteStmt->execute([$id]);

            if ($deleteStmt->rowCount() > 0) {
                echo json_encode([
                    "success" => true,
                    "message" => "Item wurde aus der Watchlist entfernt."
                ]);
            } else {
                http_response_code(404);
                echo json_encode([
                    "success" => false,
                    "error" => "Item nicht gefunden."
                ]);
            }
            break;

        default:
            http_response_code(405);
            echo json_encode([
                "success" => false,
                "error" => "Methode nicht erlaubt."
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
