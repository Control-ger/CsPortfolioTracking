<?php
declare(strict_types=1);

namespace App\Application\Service;

use App\Infrastructure\Persistence\Repository\UserFeeSettingsRepository;
use InvalidArgumentException;

final class FeeSettingsService
{
    public function __construct(private readonly UserFeeSettingsRepository $repository)
    {
    }

    public function getSettings(): array
    {
        return $this->repository->findOrDefault();
    }

    public function updateSettings(array $input): array
    {
        $current = $this->repository->findOrDefault();

        $settings = [
            'fxFeePercent' => $this->validatePercentage(
                $input['fxFeePercent'] ?? $input['fx_fee_percent'] ?? $current['fxFeePercent'],
                'fxFeePercent'
            ),
            'sellerFeePercent' => $this->validatePercentage(
                $input['sellerFeePercent'] ?? $input['seller_fee_percent'] ?? $current['sellerFeePercent'],
                'sellerFeePercent'
            ),
            'withdrawalFeePercent' => $this->validatePercentage(
                $input['withdrawalFeePercent'] ?? $input['withdrawal_fee_percent'] ?? $current['withdrawalFeePercent'],
                'withdrawalFeePercent'
            ),
            'depositFeePercent' => $this->validatePercentage(
                $input['depositFeePercent'] ?? $input['deposit_fee_percent'] ?? $current['depositFeePercent'],
                'depositFeePercent'
            ),
            'depositFeeFixedEur' => $this->validateNonNegativeAmount(
                $input['depositFeeFixedEur'] ?? $input['deposit_fee_fixed_eur'] ?? $current['depositFeeFixedEur'],
                'depositFeeFixedEur'
            ),
        ];

        return $this->repository->upsert($settings);
    }

    private function validatePercentage(mixed $value, string $field): float
    {
        if (!is_numeric($value)) {
            throw new InvalidArgumentException(sprintf('%s muss numerisch sein.', $field));
        }

        $number = (float) $value;
        if ($number < 0 || $number > 100) {
            throw new InvalidArgumentException(sprintf('%s muss zwischen 0 und 100 liegen.', $field));
        }

        return round($number, 4);
    }

    private function validateNonNegativeAmount(mixed $value, string $field): float
    {
        if (!is_numeric($value)) {
            throw new InvalidArgumentException(sprintf('%s muss numerisch sein.', $field));
        }

        $number = (float) $value;
        if ($number < 0) {
            throw new InvalidArgumentException(sprintf('%s darf nicht negativ sein.', $field));
        }

        return round($number, 4);
    }
}

