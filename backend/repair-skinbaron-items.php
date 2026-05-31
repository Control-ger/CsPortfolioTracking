<?php
declare(strict_types=1);

/**
 * Repairs historically wrong SkinBaron item mappings without touching the global catalog.
 *
 * What this script does (apply mode):
 * - Iterates SkinBaron investments only.
 * - Tries to resolve a canonical catalog item by:
 *   1) canonical marketHashName from payload
 *   2) Steam image token match (/economy/image/<token>) across items
 * - Re-maps the investment.item_id to that canonical item where safe.
 * - Normalizes the investment raw payload name/marketHashName to canonical value.
 * - Optionally deletes only touched old item rows that became unreferenced.
 *
 * What this script explicitly does NOT do:
 * - It does not mass-delete unused items from the global catalog.
 * - It does not modify non-SkinBaron investments.
 *
 * Usage:
 *   php backend/repair-skinbaron-items.php --dry-run
 *   php backend/repair-skinbaron-items.php --apply
 *   php backend/repair-skinbaron-items.php --apply --delete-touched-orphans
 */

set_time_limit(300);

$backendRoot = dirname(__DIR__);
$bootstrapPath = $backendRoot . '/backend/src/bootstrap.php';
if (!is_file($bootstrapPath)) {
    $dockerBootstrapPath = __DIR__ . '/src/bootstrap.php';
    if (is_file($dockerBootstrapPath)) {
        $bootstrapPath = $dockerBootstrapPath;
    } else {
        fwrite(STDERR, "ERROR: Bootstrap file not found at {$bootstrapPath} or {$dockerBootstrapPath}\n");
        exit(1);
    }
}

require_once $bootstrapPath;

use App\Config\DatabaseConfig;
use App\Infrastructure\Persistence\DatabaseConnectionFactory;

$args = array_slice($argv, 1);
$apply = in_array('--apply', $args, true);
$dryRun = in_array('--dry-run', $args, true) || !$apply;
$deleteTouchedOrphans = in_array('--delete-touched-orphans', $args, true);
$limitArg = null;
foreach ($args as $arg) {
    if (str_starts_with($arg, '--limit=')) {
        $limitArg = (int) substr($arg, strlen('--limit='));
        break;
    }
}
$limit = max(1, min((int) ($limitArg ?? 5000), 50000));

function normalizeWhitespace(string $value): string
{
    return trim((string) preg_replace('/\s+/', ' ', $value));
}

function isCanonicalMarketHashName(string $value): bool
{
    $name = normalizeWhitespace($value);
    if ($name === '') {
        return false;
    }

    // Canonical CS2 market names are typically "Weapon | Skin (...)" and optional "Souvenir ".
    if (preg_match('/^(Souvenir\s+)?[^|]+ \| .+$/u', $name) === 1) {
        return true;
    }

    // Some catalog items do not use "|" (e.g., cases/tools). Keep this broad but safe.
    return preg_match('/^[A-Za-z0-9 .:+\'"\-()#]+$/u', $name) === 1;
}

function extractSteamImageToken(?string $imageUrl): ?string
{
    if (!is_string($imageUrl)) {
        return null;
    }

    $trimmed = trim($imageUrl);
    if ($trimmed === '') {
        return null;
    }

    if (preg_match('~/economy/image/([^?]+)~i', $trimmed, $matches) !== 1) {
        return null;
    }

    $token = trim((string) ($matches[1] ?? ''));
    return $token !== '' ? $token : null;
}

function decodeJsonPayload(?string $json): array
{
    if (!is_string($json) || trim($json) === '') {
        return [];
    }

    $decoded = json_decode($json, true);
    return is_array($decoded) ? $decoded : [];
}

function pickCanonicalCandidate(array $currentItem, array $payload, array $candidates, callable $hasCsfloatPrice): ?array
{
    $payloadMarketHashName = normalizeWhitespace((string) ($payload['marketHashName'] ?? $payload['name'] ?? ''));

    $scored = [];
    foreach ($candidates as $candidate) {
        if (!is_array($candidate)) {
            continue;
        }

        $candidateId = (int) ($candidate['id'] ?? 0);
        if ($candidateId <= 0) {
            continue;
        }

        $candidateName = normalizeWhitespace((string) ($candidate['market_hash_name'] ?? $candidate['name'] ?? ''));
        if ($candidateName === '') {
            continue;
        }

        $score = 0;
        if (isCanonicalMarketHashName($candidateName)) {
            $score += 80;
        }
        if ($payloadMarketHashName !== '' && strcasecmp($candidateName, $payloadMarketHashName) === 0) {
            $score += 70;
        }
        if (str_contains($candidateName, ' | ')) {
            $score += 20;
        }
        if ($hasCsfloatPrice($candidateId)) {
            $score += 40;
        }
        if ($candidateId === (int) ($currentItem['id'] ?? 0)) {
            $score -= 15;
        }

        $scored[] = [
            'score' => $score,
            'candidate' => $candidate,
        ];
    }

    if ($scored === []) {
        return null;
    }

    usort(
        $scored,
        static function (array $left, array $right): int {
            if ($left['score'] !== $right['score']) {
                return $right['score'] <=> $left['score'];
            }

            return ((int) ($left['candidate']['id'] ?? 0)) <=> ((int) ($right['candidate']['id'] ?? 0));
        }
    );

    $best = $scored[0];
    if ((int) ($best['score'] ?? 0) < 50) {
        return null;
    }

    if (isset($scored[1]) && (int) $scored[1]['score'] === (int) $best['score']) {
        // Ambiguous best match -> skip for safety.
        return null;
    }

    return is_array($best['candidate'] ?? null) ? $best['candidate'] : null;
}

function buildReferenceMap(PDO $pdo): array
{
    $sql = "SELECT TABLE_NAME, COLUMN_NAME
            FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE()
              AND REFERENCED_TABLE_NAME = 'items'
              AND REFERENCED_COLUMN_NAME = 'id'";
    $stmt = $pdo->query($sql);
    $rows = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
    if (!is_array($rows)) {
        return [];
    }

    $map = [];
    foreach ($rows as $row) {
        $table = trim((string) ($row['TABLE_NAME'] ?? ''));
        $column = trim((string) ($row['COLUMN_NAME'] ?? ''));
        if ($table === '' || $column === '') {
            continue;
        }
        $map[] = ['table' => $table, 'column' => $column];
    }

    return $map;
}

function isItemReferenced(PDO $pdo, int $itemId, array $references): bool
{
    foreach ($references as $reference) {
        $table = (string) ($reference['table'] ?? '');
        $column = (string) ($reference['column'] ?? '');
        if ($table === '' || $column === '') {
            continue;
        }

        $sql = sprintf(
            'SELECT 1 FROM `%s` WHERE `%s` = ? LIMIT 1',
            str_replace('`', '``', $table),
            str_replace('`', '``', $column)
        );
        $stmt = $pdo->prepare($sql);
        $stmt->execute([$itemId]);
        if ($stmt->fetchColumn() !== false) {
            return true;
        }
    }

    return false;
}

function resolveCanonicalItemForInvestment(PDO $pdo, array $investment, array $currentItem, array $payload): ?array
{
    $payloadMarketHashName = normalizeWhitespace((string) ($payload['marketHashName'] ?? $payload['name'] ?? ''));
    if ($payloadMarketHashName !== '' && isCanonicalMarketHashName($payloadMarketHashName)) {
        $stmt = $pdo->prepare('SELECT * FROM items WHERE market_hash_name = ? LIMIT 1');
        $stmt->execute([$payloadMarketHashName]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (is_array($row)) {
            return $row;
        }
    }

    $payloadImageUrl = normalizeWhitespace((string) ($payload['imageUrl'] ?? ''));
    $currentImageUrl = normalizeWhitespace((string) ($currentItem['image_url'] ?? ''));
    $token = extractSteamImageToken($payloadImageUrl !== '' ? $payloadImageUrl : $currentImageUrl);
    if ($token === null) {
        return null;
    }

    $stmt = $pdo->prepare(
        "SELECT *
         FROM items
         WHERE image_url IS NOT NULL
           AND image_url LIKE ?
         ORDER BY id ASC"
    );
    $stmt->execute(['%/economy/image/' . $token . '%']);
    $candidates = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if ($candidates === []) {
        return null;
    }

    $hasCsfloatPrice = static function (int $itemId) use ($pdo): bool {
        $stmt = $pdo->prepare(
            "SELECT 1
             FROM item_live_cache
             WHERE item_id = ?
               AND price_source = 'csfloat'
             LIMIT 1"
        );
        $stmt->execute([$itemId]);
        return $stmt->fetchColumn() !== false;
    };

    return pickCanonicalCandidate($currentItem, $payload, $candidates, $hasCsfloatPrice);
}

$dbConfig = new DatabaseConfig();
$pdo = (new DatabaseConnectionFactory($dbConfig))->create();
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

$querySql = 'SELECT i.id, i.user_id, i.item_id, i.raw_payload_json, i.external_trade_id
             FROM investments i
             WHERE i.platform = ?
             ORDER BY i.id ASC
             LIMIT ' . $limit;
$stmt = $pdo->prepare($querySql);
$stmt->execute(['skinbaron']);
$investments = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

$stats = [
    'mode' => $dryRun ? 'dry-run' : 'apply',
    'investmentsScanned' => count($investments),
    'investmentsRemapped' => 0,
    'payloadsNormalized' => 0,
    'unresolved' => 0,
    'itemsDeleted' => 0,
];
$touchedOldItemIds = [];
$samples = [];

if (!$dryRun) {
    $pdo->beginTransaction();
}

try {
    foreach ($investments as $investment) {
        $investmentId = (int) ($investment['id'] ?? 0);
        $currentItemId = (int) ($investment['item_id'] ?? 0);
        if ($investmentId <= 0 || $currentItemId <= 0) {
            $stats['unresolved']++;
            continue;
        }

        $itemStmt = $pdo->prepare('SELECT * FROM items WHERE id = ? LIMIT 1');
        $itemStmt->execute([$currentItemId]);
        $currentItem = $itemStmt->fetch(PDO::FETCH_ASSOC);
        if (!is_array($currentItem)) {
            $stats['unresolved']++;
            continue;
        }

        $payload = decodeJsonPayload((string) ($investment['raw_payload_json'] ?? ''));
        $canonicalItem = resolveCanonicalItemForInvestment($pdo, $investment, $currentItem, $payload);

        if (!is_array($canonicalItem)) {
            $stats['unresolved']++;
            continue;
        }

        $canonicalItemId = (int) ($canonicalItem['id'] ?? 0);
        if ($canonicalItemId <= 0) {
            $stats['unresolved']++;
            continue;
        }

        $canonicalName = normalizeWhitespace((string) ($canonicalItem['market_hash_name'] ?? $canonicalItem['name'] ?? ''));
        if ($canonicalName !== '') {
            $payload['marketHashName'] = $canonicalName;
            $payload['name'] = $canonicalName;
        }

        if ($canonicalItemId !== $currentItemId) {
            $stats['investmentsRemapped']++;
            $touchedOldItemIds[$currentItemId] = true;
            $samples[] = [
                'investmentId' => $investmentId,
                'fromItemId' => $currentItemId,
                'fromName' => (string) ($currentItem['market_hash_name'] ?? ''),
                'toItemId' => $canonicalItemId,
                'toName' => $canonicalName,
            ];

            if (!$dryRun) {
                $updateStmt = $pdo->prepare(
                    'UPDATE investments
                     SET item_id = ?, raw_payload_json = ?
                     WHERE id = ?'
                );
                $updateStmt->execute([
                    $canonicalItemId,
                    json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                    $investmentId,
                ]);
            }
        } else {
            $currentPayloadName = normalizeWhitespace((string) ($payload['marketHashName'] ?? $payload['name'] ?? ''));
            if ($canonicalName !== '' && strcasecmp($currentPayloadName, $canonicalName) !== 0) {
                $stats['payloadsNormalized']++;
                if (!$dryRun) {
                    $normalizeStmt = $pdo->prepare(
                        'UPDATE investments
                         SET raw_payload_json = ?
                         WHERE id = ?'
                    );
                    $normalizeStmt->execute([
                        json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                        $investmentId,
                    ]);
                }
            }
        }
    }

    if ($deleteTouchedOrphans) {
        $references = buildReferenceMap($pdo);
        foreach (array_keys($touchedOldItemIds) as $oldItemIdRaw) {
            $oldItemId = (int) $oldItemIdRaw;
            if ($oldItemId <= 0) {
                continue;
            }

            $itemStmt = $pdo->prepare('SELECT id, market_hash_name FROM items WHERE id = ? LIMIT 1');
            $itemStmt->execute([$oldItemId]);
            $oldItem = $itemStmt->fetch(PDO::FETCH_ASSOC);
            if (!is_array($oldItem)) {
                continue;
            }

            if (isItemReferenced($pdo, $oldItemId, $references)) {
                continue;
            }

            if (!$dryRun) {
                $deleteStmt = $pdo->prepare('DELETE FROM items WHERE id = ?');
                $deleteStmt->execute([$oldItemId]);
            }
            $stats['itemsDeleted']++;
        }
    }

    if (!$dryRun) {
        $pdo->commit();
    }
} catch (Throwable $exception) {
    if (!$dryRun && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fwrite(STDERR, "ERROR: " . $exception->getMessage() . "\n");
    exit(1);
}

fwrite(STDOUT, "SkinBaron repair finished\n");
fwrite(STDOUT, "Mode: {$stats['mode']}\n");
fwrite(STDOUT, "Investments scanned: {$stats['investmentsScanned']}\n");
fwrite(STDOUT, "Investments remapped: {$stats['investmentsRemapped']}\n");
fwrite(STDOUT, "Payloads normalized: {$stats['payloadsNormalized']}\n");
fwrite(STDOUT, "Unresolved: {$stats['unresolved']}\n");
fwrite(STDOUT, "Touched orphan items deleted: {$stats['itemsDeleted']}\n");

if ($samples !== []) {
    $preview = array_slice($samples, 0, 20);
    fwrite(STDOUT, "Sample remaps (max 20):\n");
    foreach ($preview as $entry) {
        fwrite(
            STDOUT,
            sprintf(
                "  investment=%d from #%d (%s) -> #%d (%s)\n",
                (int) $entry['investmentId'],
                (int) $entry['fromItemId'],
                (string) $entry['fromName'],
                (int) $entry['toItemId'],
                (string) $entry['toName']
            )
        );
    }
}

exit(0);

