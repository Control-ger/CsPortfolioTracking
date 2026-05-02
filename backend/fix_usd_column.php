<?php
// Simple script to add the missing column
// This can be executed directly via the web interface

try {
    // Use the same database connection as the main app
    $host = getenv('DB_HOST') ?: $_ENV['DB_HOST'] ?? 'localhost';
    $port = getenv('DB_PORT') ?: $_ENV['DB_PORT'] ?? '3306';
    $dbname = getenv('DB_NAME') ?: $_ENV['DB_NAME'] ?? 'cs_portfolio';
    $username = getenv('DB_USER') ?: $_ENV['DB_USER'] ?? 'root';
    $password = getenv('DB_PASSWORD') ?: $_ENV['DB_PASSWORD'] ?? '';
    
    $pdo = new PDO("mysql:host=$host;port=$port;dbname=$dbname", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    
    // Check if column already exists
    $stmt = $pdo->query("SHOW COLUMNS FROM investments LIKE 'buy_price_usd'");
    $exists = $stmt->rowCount() > 0;
    
    if (!$exists) {
        // Add the column
        $sql = "ALTER TABLE investments ADD COLUMN buy_price_usd DECIMAL(12,4) NULL DEFAULT NULL AFTER raw_payload_json";
        $pdo->exec($sql);
        echo "SUCCESS: Column 'buy_price_usd' added to investments table.\n";
    } else {
        echo "INFO: Column 'buy_price_usd' already exists.\n";
    }
    
    // Verify the column
    $stmt = $pdo->query("SHOW COLUMNS FROM investments LIKE 'buy_price_usd'");
    $result = $stmt->fetch(PDO::FETCH_ASSOC);
    echo "Column details: " . json_encode($result, JSON_PRETTY_PRINT) . "\n";
    
} catch (Exception $e) {
    echo "ERROR: " . $e->getMessage() . "\n";
}
