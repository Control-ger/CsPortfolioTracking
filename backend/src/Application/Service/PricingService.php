<?php
declare(strict_types=1);

namespace App\Application\Service;

use App\Infrastructure\External\CsFloatClient;
use App\Infrastructure\External\ExchangeRateClient;

final class PricingService
{
    public function __construct(
        private readonly CsFloatClient $csFloatClient,
        private readonly ExchangeRateClient $exchangeRateClient
    ) {
    }

    public function getLivePriceEur(string $itemName): ?float
    {
        $usd = $this->csFloatClient->fetchLowestPriceUsd($itemName);
        if ($usd === null) {
            return null;
        }

        $rate = $this->exchangeRateClient->usdToEur();
        return $usd * $rate;
    }

    public function getUsdToEurRate(): float
    {
        return $this->exchangeRateClient->usdToEur();
    }
}
