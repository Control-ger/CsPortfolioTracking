<?php
require_once 'vendor/autoload.php';
require_once 'config/database.php';

$pdo = $GLOBALS['pdo'];
$sql = "ALTER TABLE investments ADD COLUMN buy_price_usd DECIMAL(12,4) NULL DEFAULT NULL AFTER raw_payload_json";
try {
    $pdo->exec($sql);
    echo "Column 'buy_price_usd' added successfully to investments table.\n";
} catch (Exception $e) {
    echo "Error adding column: " . $e->getMessage() . "\n";
}
