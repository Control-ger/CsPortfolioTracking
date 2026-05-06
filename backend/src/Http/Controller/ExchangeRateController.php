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
            // Provider gives USD-based rates (1 USD = X).
            $usdRates = $this->exchangeRateClient->usdRates();
            $usdToEur = (float) ($usdRates['EUR'] ?? 0.92);
            $usdToGbp = (float) ($usdRates['GBP'] ?? (0.85 * $usdToEur));

            // Convert to EUR-based rates (1 EUR = X).
            $eurToUsd = $usdToEur > 0 ? round(1 / $usdToEur, 4) : 1.08;
            $eurToGbp = $usdToEur > 0 ? round($usdToGbp / $usdToEur, 4) : 0.85;

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
            // Return fallback rates on error.
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
