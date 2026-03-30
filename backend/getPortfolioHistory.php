<?php
/**
 * Gibt die Portfolio-Historie zurück
 */

header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json");

$host = '***REMOVED***'; $***REMOVED***   = '***REMOVED***';
 $user = '***REMOVED***'; $pass = '***REMOVED***123';


try {
    $pdo = new PDO("mysql:host=$host;***REMOVED***name=$***REMOVED***;charset=utf8", $user, $pass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    // Prüfen, ob die Tabelle existiert
    $stmt = $pdo->query("SHOW TABLES LIKE '***REMOVED***_history'");
    $tableExists = $stmt->rowCount() > 0;

    if (!$tableExists) {
        // Tabelle existiert nicht - leeres Array zurückgeben
        echo json_encode([]);
        exit;
    }

    // Daten abrufen, sortiert nach Datum (älteste zuerst)
    $stmt = $pdo->query("SELECT id, date, total_value FROM ***REMOVED***_history ORDER BY date ASC");
    $history = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Daten formatieren für Frontend
    $formattedHistory = array_map(function($item) {
        return [
            'id' => intval($item['id']),
            'date' => $item['date'],
            'wert' => floatval($item['total_value']) // 'wert' für Kompatibilität mit bestehender Chart-Komponente
        ];
    }, $history);

    echo json_encode($formattedHistory);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode([
        "error" => $e->getMessage()
    ]);
}
?>
