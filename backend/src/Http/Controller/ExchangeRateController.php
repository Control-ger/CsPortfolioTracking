<?php
declare(strict_types=1);

namespace App\Http\Controller;

use App\Infrastructure\External\ExchangeRateClient;
use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Request;
use Throwable;

final class ExchangeRateController
{
    public function __construct(private readonly ExchangeRateClient $exchangeRateClient)
    {
    }

    public function getRates(Request $request): void
    {
        try {
            // Get USD to EUR rate (returns how many EUR you get for 1 USD)
            $usdToEur = $this->exchangeRateClient->usdToEur();
            
            // Calculate rates relative to EUR (how many X you get for 1 EUR)
            // If 1 USD = 0.92 EUR, then 1 EUR = 1/0.92 USD ≈ 1.087 USD
            $eurToUsd = $usdToEur > 0 ? round(1 / $usdToEur, 4) : 1.08;
            
            // For now, use approximate rates for GBP
            // In production, you might want to fetch these from an API as well
            $eurToGbp = 0.85; // Approximate: 1 EUR = 0.85 GBP
            
            JsonResponseFactory::success([
                'base' => 'EUR',
                'rates' => [
                    'EUR' => 1.0,
                    'USD' => $eurToUsd,
                    'GBP' => $eurToGbp,
                ],
                'USD' => $eurToUsd,
                'GBP' => $eurToGbp,
                'timestamp' => time(),
            ]);
        } catch (Throwable $exception) {
            // Return fallback rates on error
            JsonResponseFactory::success([
                'base' => 'EUR',
                'rates' => [
                    'EUR' => 1.0,
                    'USD' => 1.08,
                    'GBP' => 0.85,
                ],
                'USD' => 1.08,
                'GBP' => 0.85,
                'timestamp' => time(),
                'fallback' => true,
            ]);
        }
    }
}
