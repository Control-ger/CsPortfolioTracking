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

    public function getSettings(int $userId = 1): array
    {
        $settings = $this->repository->findCurrentByUserId($userId);

        if (!isset($settings['id'])) {
            $settings = $this->repository->createNewVersion($userId, $this->normalizeForRepository($settings));
        }

        return $this->normalizeForService($settings);
    }

    public function updateSettings(int $userId = 1, array $input = []): array
    {
        $current = $this->getSettings($userId);

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

        return $this->normalizeForService(
            $this->repository->createNewVersion($userId, $this->normalizeForRepository($settings))
        );
    }

    private function normalizeForRepository(array $settings): array
    {
        return [
            'fxFeePercent' => (float) ($settings['fxFeePercent'] ?? 0.0),
            'sellerFeePercent' => (float) ($settings['sellerFeePercent'] ?? 0.0),
            'withdrawalFee' => (float) ($settings['withdrawalFeePercent'] ?? $settings['withdrawalFee'] ?? 0.0),
            'depositFee' => (float) ($settings['depositFeePercent'] ?? $settings['depositFee'] ?? 0.0),
            'depositFeeFixed' => (float) ($settings['depositFeeFixedEur'] ?? $settings['depositFeeFixed'] ?? 0.0),
        ];
    }

    private function normalizeForService(array $settings): array
    {
        return [
            'id' => isset($settings['id']) ? (int) $settings['id'] : null,
            'fxFeePercent' => (float) ($settings['fxFeePercent'] ?? $settings['fx_fee_percent'] ?? 0.0),
            'sellerFeePercent' => (float) ($settings['sellerFeePercent'] ?? $settings['seller_fee_percent'] ?? 0.0),
            'withdrawalFeePercent' => (float) ($settings['withdrawalFee'] ?? $settings['withdrawal_fee'] ?? 0.0),
            'depositFeePercent' => (float) ($settings['depositFee'] ?? $settings['deposit_fee'] ?? 0.0),
            'depositFeeFixedEur' => (float) ($settings['depositFeeFixed'] ?? $settings['deposit_fee_fixed'] ?? 0.0),
            'source' => (string) ($settings['source'] ?? 'defaults'),
        ];
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

