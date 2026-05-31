<?php
declare(strict_types=1);

namespace App\Http\Controller;

use App\Infrastructure\External\SkinBaronClient;
use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Request;

final class DesktopSkinBaronController
{
    private const MIN_REQUEST_INTERVAL_US = 120000; // ~8.3 req/s (below 10 req/s limit)

    public function __construct(private readonly SkinBaronClient $client)
    {
    }

    public function preview(Request $request): void
    {
        $maxItems = $this->readInt($request, 'limit', 100, 1, 1000);
        $maxPages = $this->readInt($request, 'maxPages', 10, 1, 50);
        $searchString = trim((string) ($request->body['searchString'] ?? $request->query['searchString'] ?? ''));

        $groupsByTransferId = [];
        $groupsWithoutTransferId = [];
        $pageStats = [];
        $errors = [];
        $requestCount = 0;
        $preferenceAutomation = $this->preparePurchasesImportContext();

        if (!empty($preferenceAutomation['errors']) && is_array($preferenceAutomation['errors'])) {
            foreach ($preferenceAutomation['errors'] as $automationError) {
                if (is_array($automationError)) {
                    $errors[] = $automationError;
                }
            }
        }

        try {
            for ($page = 1; $page <= $maxPages; $page++) {
                if ($requestCount > 0) {
                    usleep(self::MIN_REQUEST_INTERVAL_US);
                }
                $requestCount += 1;

                $result = $this->client->fetchPurchasesPage($page, $searchString, 200);
                if (!empty($result['error'])) {
                    $errors[] = [
                        ...$result['error'],
                        'page' => $page,
                    ];
                    break;
                }

                $pageGroups = is_array($result['purchaseGroups'] ?? null) ? $result['purchaseGroups'] : [];
                $pagination = is_array($result['pagination'] ?? null) ? $result['pagination'] : null;
                $pageStats[] = [
                    'page' => $page,
                    'count' => count($pageGroups),
                    'numPages' => (int) ($pagination['numPages'] ?? 0),
                    'total' => (int) ($pagination['total'] ?? 0),
                ];

                foreach ($pageGroups as $group) {
                    if (!is_array($group)) {
                        $groupsWithoutTransferId[] = $group;
                        continue;
                    }

                    $transferId = $this->readString($group, ['transferId']);
                    if ($transferId === null) {
                        $groupsWithoutTransferId[] = $group;
                        continue;
                    }

                    if (!isset($groupsByTransferId[$transferId])) {
                        $groupsByTransferId[$transferId] = $group;
                    }
                }

                if (count($pageGroups) === 0) {
                    break;
                }

                $numPages = (int) ($pagination['numPages'] ?? 0);
                if ($numPages > 0 && $page >= $numPages) {
                    break;
                }
            }
        } finally {
            $restoreResult = $this->restorePurchasesImportContext($preferenceAutomation);
            if (!empty($restoreResult['errors']) && is_array($restoreResult['errors'])) {
                foreach ($restoreResult['errors'] as $restoreError) {
                    if (is_array($restoreError)) {
                        $errors[] = $restoreError;
                    }
                }
            }
        }

        $purchaseGroups = array_merge(array_values($groupsByTransferId), $groupsWithoutTransferId);
        $importTrades = [];
        $skipped = 0;
        $skipReasons = [];
        $groupIndex = 0;
        foreach ($purchaseGroups as $group) {
            if (count($importTrades) >= $maxItems) {
                break;
            }

            if (!is_array($group)) {
                $skipped += 1;
                $this->addSkipReason($skipReasons, 'invalid_group_payload');
                continue;
            }

            $state = strtoupper((string) ($this->readString($group, ['state']) ?? ''));
            if ($state !== 'SUCCEEDED') {
                $skipped += 1;
                $this->addSkipReason($skipReasons, 'group_state_not_succeeded');
                continue;
            }

            $rows = $this->mapPurchaseGroupPreviewRows($group, $groupIndex);
            $groupIndex += 1;
            foreach ($rows as $row) {
                if (!is_array($row)) {
                    $skipped += 1;
                    $this->addSkipReason($skipReasons, 'invalid_item_payload');
                    continue;
                }
                if (count($importTrades) >= $maxItems) {
                    break;
                }
                $importTrades[] = $row;
            }
        }

        JsonResponseFactory::success([
            'mode' => 'preview',
            'desktopLocal' => true,
            'requested' => [
                'limit' => $maxItems,
                'maxPages' => $maxPages,
                'searchString' => $searchString,
                'type' => 'purchases',
            ],
            'pagesFetched' => count($pageStats),
            'pageStats' => $pageStats,
            'totalFetched' => count($purchaseGroups),
            'normalizedCount' => count($importTrades),
            'insertable' => count($importTrades),
            'duplicates' => 0,
            'updated' => 0,
            'skipped' => $skipped,
            'skipReasons' => $skipReasons,
            'sampleTrades' => array_slice($importTrades, 0, 20),
            'importTrades' => $importTrades,
            'rawCount' => count($purchaseGroups),
            'rawDistinctByTransferId' => count($groupsByTransferId),
            'rawWithoutTransferId' => count($groupsWithoutTransferId),
            'errors' => $errors,
            'preferenceAutomation' => [
                'targetLanguage' => 'en',
                'targetAdditionalCurrency' => 'USD',
                'previousLanguage' => $preferenceAutomation['previousLanguage'] ?? null,
                'previousAdditionalCurrency' => $preferenceAutomation['previousAdditionalCurrency'] ?? null,
                'languageChangedForImport' => (bool) ($preferenceAutomation['languageChangedForImport'] ?? false),
                'languageRestored' => (bool) ($preferenceAutomation['languageRestored'] ?? false),
                'currencySetForImport' => (bool) ($preferenceAutomation['currencySetForImport'] ?? false),
                'currencyRestored' => (bool) ($preferenceAutomation['currencyRestored'] ?? false),
            ],
            'rawTrades' => $purchaseGroups,
        ]);
    }

    public function execute(Request $request): void
    {
        JsonResponseFactory::error(
            'DESKTOP_LOCAL_IMPORT_REQUIRED',
            'Desktop SkinBaron import must be written to local SQLite by the renderer/localStore layer.',
            ['desktopLocal' => true],
            501
        );
    }

    private function mapPurchaseGroupPreviewRows(array $group, int $groupIndex): array
    {
        $items = $this->readPath($group, ['purchaseItems']);
        if (!is_array($items) || $items === []) {
            return [];
        }

        $transferId = $this->resolveTransferId($group, $groupIndex);
        $formattedDate = $this->readString($group, ['formattedDate']);
        $purchasedAt = $this->parseGermanDateToIso($formattedDate);
        $paymentOption = $this->readString($group, ['paymentOption']);
        $state = strtoupper((string) ($this->readString($group, ['state']) ?? 'SUCCEEDED'));
        $rows = [];

        foreach ($items as $itemIndex => $item) {
            if (!is_array($item)) {
                continue;
            }

            if (($item['reverted'] ?? false) === true) {
                continue;
            }

            $name = $this->readString($item, ['marketHashName'])
                ?? $this->readString($item, ['name']);
            if ($name === null) {
                continue;
            }

            $amount = (int) round($this->readNumeric($item, ['amount']) ?? 1.0);
            if ($amount <= 0) {
                $amount = 1;
            }

            $unitPrice = $this->readNumeric($item, ['price']) ?? 0.0;
            $totalPrice = $unitPrice * $amount;
            $offerLink = $this->readString($item, ['offerLink']) ?? '';
            $externalTradeId = $this->buildPurchaseItemExternalTradeId(
                $transferId,
                $offerLink,
                $name,
                $unitPrice,
                $amount,
                (int) $itemIndex
            );

            $rows[] = [
                'externalTradeId' => $externalTradeId,
                'status' => 'new',
                'name' => $name,
                'marketHashName' => $name,
                'type' => $this->inferTypeFromName($name),
                'typeLabel' => 'SkinBaron Purchase',
                'quantity' => $amount,
                'buyPrice' => $unitPrice,
                'buyPriceTotal' => $totalPrice,
                'buyPriceUsd' => $unitPrice,
                'purchasedAt' => $purchasedAt,
                'fundingMode' => $paymentOption !== null ? strtolower($paymentOption) : 'wallet_funded',
                'imageUrl' => $this->readString($item, ['imageUrl']),
                'rawCurrency' => 'EUR',
                'skinBaronSaleId' => $transferId,
                'skinBaronTransferId' => $transferId,
                'skinBaronState' => $state,
                'skinBaronOfferLink' => $offerLink !== '' ? $offerLink : null,
            ];
        }

        return $rows;
    }

    private function readInt(Request $request, string $key, int $default, int $min, int $max): int
    {
        $value = $request->body[$key] ?? $request->query[$key] ?? $default;
        return min(max((int) $value, $min), $max);
    }

    private function readPath(array $payload, array $path): mixed
    {
        $cursor = $payload;
        foreach ($path as $segment) {
            if (!is_array($cursor) || !array_key_exists($segment, $cursor)) {
                return null;
            }
            $cursor = $cursor[$segment];
        }

        return $cursor;
    }

    private function readString(array $payload, array $path): ?string
    {
        $value = $this->readPath($payload, $path);
        if ($value === null || trim((string) $value) === '') {
            return null;
        }

        return trim((string) $value);
    }

    private function readNumeric(array $payload, array $path): ?float
    {
        $value = $this->readPath($payload, $path);
        if (!is_numeric($value)) {
            return null;
        }

        return (float) $value;
    }

    private function parseGermanDateToIso(?string $value): ?string
    {
        if ($value === null || trim($value) === '') {
            return null;
        }

        $normalized = trim($value);
        $formats = ['d.m.Y H:i', 'd.m.Y H:i:s'];
        foreach ($formats as $format) {
            $date = \DateTimeImmutable::createFromFormat($format, $normalized, new \DateTimeZone('Europe/Berlin'));
            if ($date !== false) {
                return $date->setTimezone(new \DateTimeZone('UTC'))->format(\DateTimeInterface::ATOM);
            }
        }

        return null;
    }

    private function buildPurchaseItemExternalTradeId(
        string $transferId,
        string $offerLink,
        string $name,
        float $unitPrice,
        int $amount,
        int $itemIndex
    ): string {
        $signature = implode('|', [
            $transferId,
            $offerLink,
            $name,
            number_format($unitPrice, 8, '.', ''),
            $amount,
            $itemIndex,
        ]);
        return sprintf('%s-%s', $transferId, substr(sha1($signature), 0, 16));
    }

    private function resolveTransferId(array $group, int $groupIndex): string
    {
        $transferId = $this->readString($group, ['transferId']);
        if ($transferId !== null) {
            return $transferId;
        }

        return $this->buildFallbackTransferId($group, $groupIndex);
    }

    private function buildFallbackTransferId(array $group, int $groupIndex): string
    {
        $items = $this->readPath($group, ['purchaseItems']);
        $itemFingerprint = [];
        if (is_array($items)) {
            foreach ($items as $item) {
                if (!is_array($item)) {
                    continue;
                }

                $itemFingerprint[] = implode('|', [
                    $this->readString($item, ['marketHashName']) ?? $this->readString($item, ['name']) ?? '',
                    number_format($this->readNumeric($item, ['price']) ?? 0.0, 8, '.', ''),
                    (int) round($this->readNumeric($item, ['amount']) ?? 1.0),
                    $this->readString($item, ['offerLink']) ?? '',
                ]);
            }
        }

        $groupFingerprint = implode('|', [
            $this->readString($group, ['formattedDate']) ?? '',
            $this->readString($group, ['paymentOption']) ?? '',
            $this->readString($group, ['state']) ?? '',
            implode(';', $itemFingerprint),
        ]);

        if ($groupFingerprint === '|||') {
            return sprintf('group-fallback-%d', $groupIndex + 1);
        }

        return sprintf('group-%s', substr(sha1($groupFingerprint), 0, 16));
    }

    private function addSkipReason(array &$skipReasons, string $reason): void
    {
        $skipReasons[$reason] = (int) ($skipReasons[$reason] ?? 0) + 1;
    }

    private function inferTypeFromName(string $name): string
    {
        $normalized = strtolower(trim($name));
        if (str_starts_with($normalized, 'sticker |')) {
            return 'sticker';
        }
        if (str_starts_with($normalized, 'music kit |')) {
            return 'music_kit';
        }
        if (str_starts_with($normalized, 'case')) {
            return 'case';
        }

        return 'skin';
    }

    private function preparePurchasesImportContext(): array
    {
        $context = [
            'previousLanguage' => null,
            'previousAdditionalCurrency' => null,
            'languageChangedForImport' => false,
            'currencySetForImport' => false,
            'languageRestored' => false,
            'currencyRestored' => false,
            'errors' => [],
        ];

        $configResult = $this->client->fetchPersonalUserConfig();
        if (!empty($configResult['error']) && is_array($configResult['error'])) {
            $context['errors'][] = [
                ...$configResult['error'],
                'step' => 'fetch_personal_user_config',
            ];
        } else {
            $config = is_array($configResult['config'] ?? null) ? $configResult['config'] : [];
            $language = strtolower(trim((string) ($config['language'] ?? '')));
            if ($language !== '') {
                $context['previousLanguage'] = $language;
            }

            $currencyCandidates = [
                $config['additionalCurrency'] ?? null,
                $config['currency'] ?? null,
                $config['additionalCurrencyCode'] ?? null,
            ];
            foreach ($currencyCandidates as $candidate) {
                $normalized = strtoupper(trim((string) $candidate));
                if ($normalized !== '') {
                    $context['previousAdditionalCurrency'] = $normalized;
                    break;
                }
            }
        }

        if (($context['previousLanguage'] ?? null) !== 'en') {
            $setLanguageResult = $this->client->setLanguage('en');
            if (!empty($setLanguageResult['error']) && is_array($setLanguageResult['error'])) {
                $context['errors'][] = [
                    ...$setLanguageResult['error'],
                    'step' => 'set_language_en',
                ];
            } else {
                $context['languageChangedForImport'] = true;
            }
        }

        $setCurrencyResult = $this->client->setAdditionalCurrency('USD');
        if (!empty($setCurrencyResult['error']) && is_array($setCurrencyResult['error'])) {
            $context['errors'][] = [
                ...$setCurrencyResult['error'],
                'step' => 'set_currency_usd',
                'attempts' => $setCurrencyResult['attempts'] ?? [],
            ];
        } else {
            $context['currencySetForImport'] = true;
        }

        return $context;
    }

    private function restorePurchasesImportContext(array &$context): array
    {
        $errors = [];

        $previousLanguage = strtolower(trim((string) ($context['previousLanguage'] ?? '')));
        $languageWasChanged = (bool) ($context['languageChangedForImport'] ?? false);
        if ($languageWasChanged && $previousLanguage !== '' && $previousLanguage !== 'en') {
            $restoreLanguageResult = $this->client->setLanguage($previousLanguage);
            if (!empty($restoreLanguageResult['error']) && is_array($restoreLanguageResult['error'])) {
                $errors[] = [
                    ...$restoreLanguageResult['error'],
                    'step' => 'restore_language',
                    'targetLanguage' => $previousLanguage,
                ];
            } else {
                $context['languageRestored'] = true;
            }
        } elseif ($languageWasChanged && $previousLanguage === 'en') {
            $context['languageRestored'] = true;
        }

        $previousCurrency = strtoupper(trim((string) ($context['previousAdditionalCurrency'] ?? '')));
        $currencyWasChanged = (bool) ($context['currencySetForImport'] ?? false);
        if ($currencyWasChanged && $previousCurrency !== '' && $previousCurrency !== 'USD') {
            $restoreCurrencyResult = $this->client->setAdditionalCurrency($previousCurrency);
            if (!empty($restoreCurrencyResult['error']) && is_array($restoreCurrencyResult['error'])) {
                $errors[] = [
                    ...$restoreCurrencyResult['error'],
                    'step' => 'restore_currency',
                    'targetCurrency' => $previousCurrency,
                    'attempts' => $restoreCurrencyResult['attempts'] ?? [],
                ];
            } else {
                $context['currencyRestored'] = true;
            }
        } elseif ($currencyWasChanged && $previousCurrency === 'USD') {
            $context['currencyRestored'] = true;
        }

        return ['errors' => $errors];
    }
}
