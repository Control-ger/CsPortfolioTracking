<?php
declare(strict_types=1);

namespace App\Application\Service;

final class CsFloatTradeNormalizer
{
    private const DEFAULT_TRADE_CURRENCY = 'usd';

    private array $livePriceHintCache = [];
    private int $activeUserId = 1;

    public function __construct(
        private readonly PricingService $pricingService,
    ) {
    }

    public function setActiveUserId(int $userId): void
    {
        $this->activeUserId = max(1, $userId);
    }

    public function resetLivePriceCache(): void
    {
        $this->livePriceHintCache = [];
    }

    public function normalizeType(?string $type): ?string
    {
        $normalized = strtolower(trim((string) $type));
        if ($normalized === '' || $normalized === 'all') {
            return null;
        }

        return in_array($normalized, ['buy', 'sell'], true) ? $normalized : 'buy';
    }

    public function resolveTradeIdentifier(array $trade): string
    {
        foreach (
            [
                ['id'],
                ['_id'],
                ['trade_id'],
                ['tradeId'],
                ['external_id'],
                ['externalId'],
                ['trade_uuid'],
                ['tradeUuid'],
                ['uuid'],
                ['trade', 'id'],
                ['trade', '_id'],
                ['trade', 'trade_id'],
                ['trade', 'tradeId'],
                ['trade', 'uuid'],
                ['listing', 'id'],
                ['listing', '_id'],
                ['order', 'id'],
                ['transaction', 'id'],
                ['sale', 'id'],
                ['purchase', 'id'],
            ] as $path
        ) {
            $value = $this->readPath($trade, $path);
            if ($value !== null && trim((string) $value) !== '') {
                return trim((string) $value);
            }
        }

        $fingerprintSource = json_encode($trade, JSON_UNESCAPED_UNICODE);
        if ($fingerprintSource === false || $fingerprintSource === '') {
            $fingerprintSource = serialize($trade);
        }

        return 'fp_' . sha1($fingerprintSource);
    }

    public function resolveMarketHashName(array $trade): string
    {
        foreach (
            [
                ['item', 'market_hash_name'],
                ['item', 'name'],
                ['item', 'marketHashName'],
                ['contract', 'item', 'market_hash_name'],
                ['contract', 'item', 'name'],
                ['contract', 'name'],
                ['listing', 'item', 'market_hash_name'],
                ['listing', 'item', 'name'],
                ['listing', 'name'],
                ['item_name'],
                ['market_hash_name'],
                ['marketHashName'],
                ['name'],
            ] as $path
        ) {
            $value = $this->resolveString($trade, $path);
            if ($value !== null && $value !== '') {
                return $value;
            }
        }

        return 'Unknown Item';
    }

    public function resolveDisplayName(array $trade, string $fallback): string
    {
        foreach (
            [
                ['item', 'display_name'],
                ['item', 'name'],
                ['item', 'market_hash_name'],
                ['contract', 'item', 'display_name'],
                ['contract', 'item', 'name'],
                ['contract', 'name'],
                ['listing', 'item', 'display_name'],
                ['listing', 'item', 'name'],
                ['listing', 'name'],
                ['display_name'],
                ['name'],
            ] as $path
        ) {
            $value = $this->resolveString($trade, $path);
            if ($value !== null && $value !== '') {
                return $value;
            }
        }

        return $fallback;
    }

    public function resolveQuantity(array $trade): int
    {
        foreach (['quantity', 'amount', 'count', 'size'] as $key) {
            $value = $trade[$key] ?? null;
            if (is_numeric($value) && (int) $value > 0) {
                return (int) $value;
            }
        }

        foreach ([['contract', 'quantity'], ['contract', 'amount'], ['listing', 'quantity'], ['listing', 'amount']] as $path) {
            $value = $this->readPath($trade, $path);
            if (is_numeric($value) && (int) $value > 0) {
                return (int) $value;
            }
        }

        return 1;
    }

    public function resolveCurrency(array $trade): ?string
    {
        foreach (['currency', 'price_currency', 'priceCurrency', 'quote_currency'] as $key) {
            $value = $trade[$key] ?? null;
            if (is_string($value) && trim($value) !== '') {
                return strtoupper(trim($value));
            }
        }

        foreach ([['price', 'currency'], ['contract', 'currency'], ['contract', 'price', 'currency'], ['listing', 'currency'], ['listing', 'price', 'currency']] as $path) {
            $value = $this->readPath($trade, $path);
            if (is_string($value) && trim($value) !== '') {
                return strtoupper(trim($value));
            }
        }

        return null;
    }

    public function resolvePriceEur(array $trade, ?string $marketHashName = null): float
    {
        $currency = strtolower((string) ($this->resolveCurrency($trade) ?? self::DEFAULT_TRADE_CURRENCY));
        $livePriceHintEur = $marketHashName !== null && trim($marketHashName) !== ''
            ? $this->resolveLivePriceHintEur($marketHashName)
            : null;
        $priceCandidates = [
            ['price_eur'],
            ['priceEur'],
            ['total_eur'],
            ['totalEur'],
            ['amount_eur'],
            ['amountEur'],
            ['price', 'eur'],
            ['price', 'euro'],
            ['price', 'amount_eur'],
            ['price', 'value_eur'],
            ['trade', 'price', 'eur'],
            ['trade', 'price', 'euro'],
            ['trade', 'price', 'amount_eur'],
            ['trade', 'price', 'value_eur'],
            ['price'],
            ['total_price'],
            ['totalPrice'],
            ['paid_price'],
            ['paidPrice'],
            ['amount'],
            ['price', 'amount'],
            ['price', 'value'],
            ['trade', 'price', 'amount'],
            ['trade', 'price', 'value'],
            ['trade', 'price'],
            ['contract', 'price_eur'],
            ['contract', 'priceEur'],
            ['contract', 'price'],
            ['contract', 'price', 'amount'],
            ['contract', 'price', 'value'],
            ['contract', 'total'],
            ['contract', 'amount'],
            ['contract', 'price_cents'],
            ['contract', 'price', 'cents'],
            ['listing', 'price_eur'],
            ['listing', 'priceEur'],
            ['listing', 'price'],
            ['listing', 'price', 'amount'],
            ['listing', 'price', 'value'],
            ['listing', 'total'],
            ['listing', 'amount'],
            ['listing', 'price_cents'],
            ['listing', 'price', 'cents'],
            ['price_cents'],
            ['priceCents'],
            ['price', 'cents'],
            ['trade', 'price_cents'],
            ['trade', 'price', 'cents'],
        ];

        foreach ($priceCandidates as $path) {
            $value = $this->readPath($trade, $path);
            if ($value === null) {
                continue;
            }

            $pathCurrencyHint = $this->resolveCurrencyHintFromPath($path);

            if (is_array($value)) {
                $resolved = $this->resolvePriceFromNode($value);
                if ($resolved !== null) {
                    return $this->normalizePriceToEur(
                        $resolved['amount'],
                        $resolved['currency'] ?? $pathCurrencyHint ?? $currency,
                        $resolved['isCents'],
                        $livePriceHintEur
                    );
                }
                continue;
            }

            if (!is_numeric($value)) {
                continue;
            }

            return $this->normalizePriceToEur(
                (float) $value,
                $pathCurrencyHint ?? $currency,
                false,
                $livePriceHintEur
            );
        }

        $directNode = $this->resolvePriceFromNode($trade['price'] ?? null);
        if ($directNode !== null) {
            return $this->normalizePriceToEur(
                $directNode['amount'],
                $directNode['currency'] ?? $currency,
                $directNode['isCents'],
                $livePriceHintEur
            );
        }

        $contractNode = $this->resolvePriceFromNode($this->readPath($trade, ['contract', 'price']));
        if ($contractNode !== null) {
            return $this->normalizePriceToEur(
                $contractNode['amount'],
                $contractNode['currency'] ?? $currency,
                $contractNode['isCents'],
                $livePriceHintEur
            );
        }

        $listingNode = $this->resolvePriceFromNode($this->readPath($trade, ['listing', 'price']));
        if ($listingNode !== null) {
            return $this->normalizePriceToEur(
                $listingNode['amount'],
                $listingNode['currency'] ?? $currency,
                $listingNode['isCents'],
                $livePriceHintEur
            );
        }

        return 0.0;
    }

    public function resolvePriceUsd(array $trade): ?float
    {
        // Extract original USD price before any conversion
        // CSFloat trades are typically in USD
        $usdCandidates = [
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
        ];

        foreach ($usdCandidates as $path) {
            $value = $this->readPath($trade, $path);
            if ($value !== null && is_numeric($value) && (float) $value > 0) {
                return (float) $value;
            }
        }

        // If currency is USD and we have a price, return it
        $currency = $this->resolveCurrency($trade);
        if (strtoupper($currency) === 'USD') {
            $directPrice = $this->readPath($trade, ['price'])
                ?? $this->readPath($trade, ['total_price'])
                ?? $this->readPath($trade, ['amount']);
            if (is_numeric($directPrice) && (float) $directPrice > 0) {
                return (float) $directPrice;
            }
        }

        return null;
    }

    public function resolvePriceFromNode(mixed $node): ?array
    {
        if (is_numeric($node)) {
            $amount = (float) $node;
            return [
                'amount' => $amount,
                'currency' => null,
                'isCents' => false,
            ];
        }

        if (!is_array($node)) {
            return null;
        }

        $currency = $this->resolveCurrencyFromNode($node);

        foreach (['amount', 'value', 'total', 'price'] as $key) {
            if (isset($node[$key]) && is_numeric($node[$key])) {
                $amount = (float) $node[$key];
                return [
                    'amount' => $amount,
                    'currency' => $currency,
                    'isCents' => false,
                ];
            }
        }

        foreach (['amount_cents', 'value_cents', 'total_cents', 'price_cents', 'cents'] as $key) {
            if (isset($node[$key]) && is_numeric($node[$key])) {
                return [
                    'amount' => (float) $node[$key],
                    'currency' => $currency,
                    'isCents' => true,
                ];
            }
        }

        return null;
    }

    public function resolveCurrencyFromNode(array $node): ?string
    {
        foreach (['currency', 'currency_code', 'currencyCode', 'quote_currency', 'quoteCurrency'] as $key) {
            $value = $node[$key] ?? null;
            if (is_string($value) && trim($value) !== '') {
                return strtoupper(trim($value));
            }
        }

        return null;
    }

    public function resolveCurrencyHintFromPath(array $path): ?string
    {
        $joined = strtolower(implode('_', array_map(static fn ($segment): string => (string) $segment, $path)));

        if (str_contains($joined, 'eur') || str_contains($joined, 'euro')) {
            return 'eur';
        }

        if (str_contains($joined, 'usd') || str_contains($joined, 'dollar')) {
            return 'usd';
        }

        return null;
    }

    public function normalizePriceToEur(float $amount, ?string $currency, bool $isCents, ?float $livePriceHintEur = null): float
    {
        $normalizedCurrency = strtolower(trim((string) $currency));
        if ($normalizedCurrency === '') {
            $normalizedCurrency = self::DEFAULT_TRADE_CURRENCY;
        }

        $scale = $isCents ? 100 : $this->resolvePriceScale($amount, $normalizedCurrency, $livePriceHintEur);
        if ($scale <= 0) {
            $scale = 100;
        }

        $amount = $amount / $scale;

        if (in_array($normalizedCurrency, ['eur', '€'], true)) {
            return round($amount, 4);
        }

        if ($normalizedCurrency === 'usd' || $normalizedCurrency === '$') {
            return round($amount * $this->pricingService->getUsdToEurRate(), 4);
        }

        return round($amount, 4);
    }

    public function resolvePriceScale(float $amount, ?string $currency, ?float $livePriceHintEur = null): int
    {
        $normalizedCurrency = strtolower(trim((string) $currency));
        if ($normalizedCurrency === '') {
            $normalizedCurrency = self::DEFAULT_TRADE_CURRENCY;
        }
        $baseCandidates = [100, 1];

        if ($amount >= 1000) {
            $baseCandidates[] = 1000;
        }

        if ($amount >= 10000) {
            $baseCandidates[] = 10000;
        }

        if ($amount >= 1000000) {
            $baseCandidates[] = 100000;
        }

        $candidates = array_values(array_unique($baseCandidates));

        if ($livePriceHintEur !== null && $livePriceHintEur > 0) {
            $bestScale = 100;
            $bestDelta = null;

            foreach ($candidates as $candidateScale) {
                $candidatePrice = $this->convertRawAmountToEur($amount, $normalizedCurrency, $candidateScale);
                if ($candidatePrice <= 0) {
                    continue;
                }

                $delta = abs(log(max($candidatePrice, 0.0001) / max($livePriceHintEur, 0.0001)));
                if ($bestDelta === null || $delta < $bestDelta) {
                    $bestDelta = $delta;
                    $bestScale = $candidateScale;
                }
            }

            return $bestScale;
        }

        return 100;
    }

    public function convertRawAmountToEur(float $amount, ?string $currency, int $scale): float
    {
        if ($scale > 0) {
            $amount = $amount / $scale;
        }

        $normalizedCurrency = strtolower(trim((string) $currency));
        if ($normalizedCurrency === '') {
            $normalizedCurrency = self::DEFAULT_TRADE_CURRENCY;
        }
        if (in_array($normalizedCurrency, ['usd', '$'], true)) {
            return round($amount * $this->pricingService->getUsdToEurRate(), 4);
        }

        return round($amount, 4);
    }

    public function resolveLivePriceHintEur(string $marketHashName): ?float
    {
        if (array_key_exists($marketHashName, $this->livePriceHintCache)) {
            return $this->livePriceHintCache[$marketHashName];
        }

        $livePrice = $this->pricingService->getLivePriceEur($marketHashName, $this->activeUserId);
        $this->livePriceHintCache[$marketHashName] = $livePrice !== null ? (float) $livePrice : null;

        return $this->livePriceHintCache[$marketHashName];
    }

    public function resolvePurchasedAt(array $trade): ?string
    {
        foreach (
            [
                ['purchased_at'],
                ['purchasedAt'],
                ['created_at'],
                ['createdAt'],
                ['completed_at'],
                ['completedAt'],
                ['timestamp'],
                ['date'],
                ['trade', 'created_at'],
                ['trade', 'createdAt'],
                ['trade', 'completed_at'],
                ['trade', 'completedAt'],
                ['trade', 'timestamp'],
                ['trade', 'date'],
            ] as $path
        ) {
            $value = $this->readPath($trade, $path);
            if ($value === null || trim((string) $value) === '') {
                continue;
            }

            $timestamp = is_numeric($value) ? (int) $value : strtotime((string) $value);
            if ($timestamp !== false && $timestamp > 0) {
                return date('Y-m-d H:i:s', $timestamp > 2000000000 ? (int) floor($timestamp / 1000) : $timestamp);
            }
        }

        return null;
    }

    public function resolveFloatValue(array $trade): ?float
    {
        foreach (
            [
                ['float_value'],
                ['floatValue'],
                ['float'],
                ['item', 'float_value'],
                ['item', 'floatValue'],
                ['item', 'float'],
                ['listing', 'float_value'],
                ['listing', 'floatValue'],
                ['listing', 'float'],
            ] as $path
        ) {
            $value = $this->readPath($trade, $path);
            if (!is_numeric($value)) {
                continue;
            }

            $floatValue = (float) $value;
            if ($floatValue >= 0 && $floatValue <= 1) {
                return $floatValue;
            }
        }

        return null;
    }

    public function resolvePaintSeed(array $trade): ?int
    {
        foreach (
            [
                ['paint_seed'],
                ['paintSeed'],
                ['pattern_seed'],
                ['patternSeed'],
                ['item', 'paint_seed'],
                ['item', 'paintSeed'],
                ['item', 'pattern_seed'],
                ['item', 'patternSeed'],
                ['listing', 'paint_seed'],
                ['listing', 'paintSeed'],
                ['listing', 'pattern_seed'],
                ['listing', 'patternSeed'],
            ] as $path
        ) {
            $value = $this->readPath($trade, $path);
            if (!is_numeric($value)) {
                continue;
            }

            $seed = (int) $value;
            if ($seed >= 0) {
                return $seed;
            }
        }

        return null;
    }

    public function isRefundedTrade(array $trade): bool
    {
        $state = strtolower(trim((string) $this->resolveString(
            $trade,
            ['state'],
            ['trade', 'state'],
            ['contract', 'state'],
            ['status'],
            ['trade', 'status'],
            ['contract', 'status']
        )));

        return $state === 'refunded';
    }

    public function resolveString(array $trade, array ...$paths): ?string
    {
        foreach ($paths as $path) {
            $value = $this->readPath($trade, $path);
            if ($value !== null && trim((string) $value) !== '') {
                return trim((string) $value);
            }
        }

        return null;
    }

    public function readPath(array $data, array $path): mixed
    {
        $cursor = $data;
        foreach ($path as $segment) {
            if (!is_array($cursor) || !array_key_exists($segment, $cursor)) {
                return null;
            }
            $cursor = $cursor[$segment];
        }

        return $cursor;
    }

    public function resolveUnitPriceEur(float $buyPriceTotal, int $quantity): float
    {
        if ($quantity <= 1) {
            return round($buyPriceTotal, 4);
        }

        return round($buyPriceTotal / $quantity, 4);
    }
}
