<?php
declare(strict_types=1);

namespace App\Application\Service;

final class FeeCalculationService
{
    /**
     * Calculate acquisition fees for cash-in funded investments.
     * Returns 0.0 for wallet-funded investments.
     */
    public function resolveAcquisitionFees(float $totalInvested, string $fundingMode, array $settings): float
    {
        if ($fundingMode !== 'cash_in' || $totalInvested <= 0) {
            return 0.0;
        }

        $depositPercent = max(0.0, ((float) ($settings['depositFeePercent'] ?? 0.0)) / 100.0);
        $fxPercent = max(0.0, ((float) ($settings['fxFeePercent'] ?? 0.0)) / 100.0);
        $depositFixed = max(0.0, (float) ($settings['depositFeeFixedEur'] ?? 0.0));

        return ($totalInvested * $depositPercent) + ($totalInvested * $fxPercent) + $depositFixed;
    }

    /**
     * Calculate net proceeds after seller and withdrawal fees.
     */
    public function calculateNetProceeds(float $grossSell, array $settings): float
    {
        $sellerFeeRate = max(0.0, ((float) ($settings['sellerFeePercent'] ?? 0.0)) / 100.0);
        $withdrawalFeeRate = max(0.0, ((float) ($settings['withdrawalFeePercent'] ?? 0.0)) / 100.0);

        $afterSeller = $grossSell * (1 - $sellerFeeRate);
        return $afterSeller * (1 - $withdrawalFeeRate);
    }

    /**
     * Calculate the break-even price per unit, accounting for seller and withdrawal fees.
     */
    public function calculateBreakEvenNetUnitPrice(float $costBasisUnit, array $settings): ?float
    {
        if ($costBasisUnit <= 0) {
            return null;
        }

        $sellerFeeRate = max(0.0, ((float) ($settings['sellerFeePercent'] ?? 0.0)) / 100.0);
        $withdrawalFeeRate = max(0.0, ((float) ($settings['withdrawalFeePercent'] ?? 0.0)) / 100.0);
        $multiplier = (1 - $sellerFeeRate) * (1 - $withdrawalFeeRate);

        if ($multiplier <= 0) {
            return null;
        }

        return $costBasisUnit / $multiplier;
    }
}
