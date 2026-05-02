<?php
require_once __DIR__ . '/vendor/autoload.php';

use App\Infrastructure\Persistence\Repository\InvestmentRepository;
use App\Infrastructure\Persistence\DatabaseConnectionFactory;

try {
    $factory = new DatabaseConnectionFactory();
    $pdo = $factory->create();
    
    $repository = new InvestmentRepository($pdo);
    
    // This will trigger ensureImportColumns() which should add the buy_price_usd column
    $repository->ensureImportColumns();
    
    echo "Column 'buy_price_usd' check completed.\n";
    
    // Verify column exists
    $stmt = $pdo->query("SHOW COLUMNS FROM investments LIKE 'buy_price_usd'");
    $result = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    if (count($result) > 0) {
        echo "SUCCESS: Column 'buy_price_usd' exists in investments table.\n";
        echo "Column details: " . json_encode($result[0], JSON_PRETTY_PRINT) . "\n";
    } else {
        echo "ERROR: Column 'buy_price_usd' was not created.\n";
    }
    
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
    echo "Stack trace: " . $e->getTraceAsString() . "\n";
}
