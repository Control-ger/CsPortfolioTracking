<?php
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json");

$host = '***REMOVED***'; $***REMOVED***   = '***REMOVED***'; $table_name = 'investments'; $user = '***REMOVED***'; $pass = '***REMOVED***123';


try {
    $pdo = new PDO("mysql:host=$host;***REMOVED***name=$***REMOVED***;charset=utf8", $user, $pass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    // Daten aus der Tabelle  abrufen
    $stmt = $pdo->query("SELECT * FROM $table_name");
    $investments = $stmt->fetchAll(PDO::FETCH_ASSOC);
    // Die echten Daten als JSON zurückgeben
    echo json_encode($investments);

} catch (PDOException $e) {
    // Falls etwas schiefgeht, Fehlermeldung senden
    http_response_code(500);
    echo json_encode(["error" => $e->getMessage()]);
}
?>