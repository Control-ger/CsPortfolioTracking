<?php
declare(strict_types=1);

namespace App\Application\Support;

final class MarketItemClassifier
{
    private const WEAR_MAP = [
        'Factory New' => ['key' => 'factory_new', 'label' => 'Factory New'],
        'Minimal Wear' => ['key' => 'minimal_wear', 'label' => 'Minimal Wear'],
        'Field-Tested' => ['key' => 'field_tested', 'label' => 'Field-Tested'],
        'Well-Worn' => ['key' => 'well_worn', 'label' => 'Well-Worn'],
        'Battle-Scarred' => ['key' => 'battle_scarred', 'label' => 'Battle-Scarred'],
    ];

    public function classify(
        string $marketHashName,
        ?string $steamTypeLabel = null,
        ?string $csFloatType = null,
        ?string $csFloatTypeLabel = null
    ): array {
        $normalizedName = strtolower(trim($marketHashName));
        $normalizedSteamType = strtolower(trim((string) $steamTypeLabel));
        $normalizedCsFloatType = trim((string) $csFloatType);

        if (str_starts_with($normalizedName, 'sticker |')) {
            return ['key' => 'sticker', 'label' => 'Sticker', 'isWearable' => false];
        }

        if (str_starts_with($normalizedName, 'patch |')) {
            return ['key' => 'patch', 'label' => 'Patch', 'isWearable' => false];
        }

        if (str_starts_with($normalizedName, 'music kit |') || $normalizedCsFloatType === 'music_kit') {
            return ['key' => 'music_kit', 'label' => 'Music Kit', 'isWearable' => false];
        }

        if (str_contains($normalizedName, 'souvenir package')) {
            return ['key' => 'souvenir_package', 'label' => 'Souvenir Package', 'isWearable' => false];
        }

        if (str_contains($normalizedName, 'sticker capsule') || str_contains($normalizedName, 'autograph capsule')) {
            return ['key' => 'sticker_capsule', 'label' => 'Sticker Capsule', 'isWearable' => false];
        }

        if (str_contains($normalizedName, 'case')) {
            return ['key' => 'case', 'label' => 'Case', 'isWearable' => false];
        }

        if (str_contains($normalizedName, 'key') || $normalizedCsFloatType === 'key') {
            return ['key' => 'key', 'label' => 'Key', 'isWearable' => false];
        }

        if (str_contains($normalizedName, 'terminal')) {
            return ['key' => 'terminal', 'label' => 'Terminal', 'isWearable' => false];
        }

        if ($normalizedCsFloatType === 'agent' || str_contains($normalizedSteamType, 'agent')) {
            return ['key' => 'agent', 'label' => 'Agent', 'isWearable' => false];
        }

        if ($normalizedCsFloatType === 'charm' || str_contains($normalizedSteamType, 'charm')) {
            return ['key' => 'charm', 'label' => 'Charm', 'isWearable' => false];
        }

        if ($normalizedCsFloatType === 'graffiti' || str_contains($normalizedSteamType, 'graffiti')) {
            return ['key' => 'graffiti', 'label' => 'Graffiti', 'isWearable' => false];
        }

        if ($normalizedCsFloatType === 'tool' || str_contains($normalizedSteamType, 'tool')) {
            return ['key' => 'tool', 'label' => 'Tool', 'isWearable' => false];
        }

        if (
            $normalizedCsFloatType === 'container' ||
            str_contains($normalizedSteamType, 'container')
        ) {
            return ['key' => 'container', 'label' => 'Container', 'isWearable' => false];
        }

        if (
            $normalizedCsFloatType === 'skin' ||
            $this->looksLikeWearableSkin($marketHashName, $normalizedSteamType, $csFloatTypeLabel)
        ) {
            return ['key' => 'skin', 'label' => 'Skin', 'isWearable' => true];
        }

        return [
            'key' => 'other',
            'label' => $csFloatTypeLabel ?: $steamTypeLabel ?: 'Other',
            'isWearable' => false,
        ];
    }

    public function normalizeWear(?string $wearName, string $marketHashName): ?array
    {
        $candidate = trim((string) $wearName);
        if ($candidate === '' && preg_match('/\(([^)]+)\)$/', $marketHashName, $matches) === 1) {
            $candidate = trim($matches[1]);
        }

        if ($candidate === '' || !isset(self::WEAR_MAP[$candidate])) {
            return null;
        }

        return self::WEAR_MAP[$candidate];
    }

    public function matchesFilters(
        array $classification,
        ?array $wear,
        ?string $itemTypeFilter,
        ?string $wearFilter
    ): bool {
        $normalizedItemType = trim((string) $itemTypeFilter);
        $normalizedWear = trim((string) $wearFilter);

        if ($normalizedItemType !== '' && $normalizedItemType !== 'all' && ($classification['key'] ?? null) !== $normalizedItemType) {
            return false;
        }

        if ($normalizedWear === '' || $normalizedWear === 'all') {
            return true;
        }

        if (($classification['key'] ?? null) !== 'skin') {
            return false;
        }

        return ($wear['key'] ?? null) === $normalizedWear;
    }

    private function looksLikeWearableSkin(string $marketHashName, string $steamTypeLabel, ?string $csFloatTypeLabel): bool
    {
        $normalizedCsFloatTypeLabel = strtolower(trim((string) $csFloatTypeLabel));
        $wear = $this->normalizeWear(null, $marketHashName);
        if ($wear !== null) {
            return true;
        }

        foreach ([
            'rifle',
            'pistol',
            'smg',
            'shotgun',
            'sniper rifle',
            'machinegun',
            'knife',
            'gloves',
        ] as $token) {
            if (str_contains($steamTypeLabel, $token) || str_contains($normalizedCsFloatTypeLabel, $token)) {
                return true;
            }
        }

        return false;
    }
}
