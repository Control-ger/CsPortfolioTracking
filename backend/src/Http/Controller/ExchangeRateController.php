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
            if ($usdToEur <= 0.0) {
                $usdToEur = 0.92;
            }

            // Convert to EUR-based rates (1 EUR = X).
            $rates = [
                'EUR' => 1.0,
            ];
            foreach ($usdRates as $currencyCode => $usdRate) {
                $code = strtoupper(trim((string) $currencyCode));
                if ($code === 'EUR' || preg_match('/^[A-Z]{3}$/', $code) !== 1 || !is_numeric($usdRate)) {
                    continue;
                }

                $numericUsdRate = (float) $usdRate;
                if ($numericUsdRate <= 0.0) {
                    continue;
                }

                $rates[$code] = round($numericUsdRate / $usdToEur, 6);
            }

            if (!isset($rates['USD']) || !is_numeric($rates['USD']) || (float) $rates['USD'] <= 0.0) {
                $rates['USD'] = round(1 / $usdToEur, 6);
            }
            if (!isset($rates['GBP']) || !is_numeric($rates['GBP']) || (float) $rates['GBP'] <= 0.0) {
                $rates['GBP'] = 0.85;
            }

            uksort($rates, static function (string $left, string $right): int {
                if ($left === 'EUR') {
                    return -1;
                }
                if ($right === 'EUR') {
                    return 1;
                }
                return strcmp($left, $right);
            });

            $eurToUsd = (float) ($rates['USD'] ?? 1.08);
            $eurToGbp = (float) ($rates['GBP'] ?? 0.85);

            JsonResponseFactory::success([
                'base' => 'EUR',
                'rates' => $rates,
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
