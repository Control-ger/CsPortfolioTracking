<?php
/**
 * Migration script to populate buy_price_usd for existing CSFloat trades
 * 
 * This script extracts USD prices from raw_payload_json where available
 * and sets buy_price_usd = buy_price / exchange_rate for others
 * 
 * Usage: php migrate_usd_prices.php
 */

declare(strict_types=1);

require_once __DIR__ . '/vendor/autoload.php';

use App\Infrastructure\Persistence\Repository\InvestmentRepository;
use App\Shared\Logger;

// Simple container setup
$pdo = require __DIR__ . '/config/database.php';
$repository = new InvestmentRepository($pdo);

echo "Starting USD price migration...\n";

// Get all investments with external_source = 'csfloat' and missing buy_price_usd
$sql = "SELECT id, buy_price, buy_price_usd, raw_payload_json, external_source 
        FROM investments 
        WHERE external_source = 'csfloat' 
        AND (buy_price_usd IS NULL OR buy_price_usd = 0)";

$stmt = $pdo->query($sql);
$investments = $stmt->fetchAll(PDO::FETCH_ASSOC);

echo "Found " . count($investments) . " investments to migrate\n";

$successCount = 0;
$skipCount = 0;
$errorCount = 0;
$fallbackRate = 0.92; // Approximate EUR/USD rate (1 EUR = 0.92 USD)

foreach ($investments as $investment) {
    $id = (int) $investment['id'];
    $buyPrice = (float) $investment['buy_price'];
    $rawPayloadJson = $investment['raw_payload_json'] ?? null;
    $buyPriceUsd = null;
    
    // Try to extract USD price from raw payload
    if ($rawPayloadJson !== null && $rawPayloadJson !== '') {
        $rawPayload = json_decode($rawPayloadJson, true);
        if (is_array($rawPayload)) {
            // Look for USD price in raw payload
            $usdPrice = extractUsdPrice($rawPayload);
            if ($usdPrice !== null && $usdPrice > 0) {
                $buyPriceUsd = $usdPrice;
            }
        }
    }
    
    // Fallback: calculate from EUR price using approximate rate
    if ($buyPriceUsd === null && $buyPrice > 0) {
        $buyPriceUsd = round($buyPrice / $fallbackRate, 4);
    }
    
    if ($buyPriceUsd !== null && $buyPriceUsd > 0) {
        try {
            $updateSql = "UPDATE investments SET buy_price_usd = ? WHERE id = ?";
            $updateStmt = $pdo->prepare($updateSql);
            $updateStmt->execute([$buyPriceUsd, $id]);
            $successCount++;
            
            if ($successCount % 100 === 0) {
                echo "Processed {$successCount} records...\n";
            }
        } catch (Throwable $e) {
            Logger::event('error', 'migration', 'migration.usd_failed', 'Failed to update USD price', [
                'id' => $id,
                'error' => $e->getMessage(),
            ]);
            $errorCount++;
        }
    } else {
        $skipCount++;
    }
}

echo "\nMigration complete!\n";
echo "Success: {$successCount}\n";
echo "Skipped: {$skipCount}\n";
echo "Errors: {$errorCount}\n";
echo "\nNote: Fallback exchange rate used: {$fallbackRate} (1 EUR = 0.92 USD)\n";
echo "New CSFloat imports will store the actual USD price from the API.\n";

function extractUsdPrice(array $payload): ?float
{
    $usdPaths = [
        ['price_usd'],
        ['priceUsd'],
        ['total_usd'],
        ['totalUsd'],
        ['amount_usd'],
        ['amountUsd'],
        ['price', 'usd'],
        ['price', 'amount_usd'],
        ['trade', 'price', 'usd'],
        ['contract', 'price_usd'],
        ['contract', 'price', 'usd'],
        ['listing', 'price_usd'],
        ['listing', 'price', 'usd'],
        ['item', 'price_usd'],
    ];
    
    foreach ($usdPaths as $path) {
        $value = readPath($payload, $path);
        if ($value !== null && is_numeric($value) && (float) $value > 0) {
            return (float) $value;
        }
    }
    
    // Check if currency is USD and use price directly
    $currency = readPath($payload, ['currency']) 
        ?? readPath($payload, ['price', 'currency'])
        ?? readPath($payload, ['trade', 'price', 'currency']);
    
    if (is_string($currency) && strtoupper($currency) === 'USD') {
        $price = readPath($payload, ['price'])
            ?? readPath($payload, ['total_price'])
            ?? readPath($payload, ['amount'])
            ?? readPath($payload, ['total']);
        
        if (is_numeric($price) && (float) $price > 0) {
            return (float) $price;
        }
    }
    
    return null;
}

function readPath(array $data, array $path): mixed
{
    $current = $data;
    foreach ($path as $key) {
        if (!is_array($current) || !array_key_exists($key, $current)) {
            return null;
        }
        $current = $current[$key];
    }
    return $current;
}
