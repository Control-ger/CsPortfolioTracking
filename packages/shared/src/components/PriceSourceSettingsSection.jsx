import { useTranslation } from "react-i18next";

import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
  SettingsTile,
} from "@shared/components/ui/settings-card";
import { StatusPill } from "@shared/components/ui/status-pill";

const PRICE_SOURCE_OPTIONS = [
  { value: "auto", labelKey: "priceSource.auto", hintKey: "priceSource.autoHint" },
  { value: "csfloat", labelKey: "priceSource.csfloat", hintKey: "priceSource.csfloatHint" },
  { value: "steam", labelKey: "priceSource.steam", hintKey: "priceSource.steamHint" },
];

/**
 * The preference has no save button of its own — it is part of the page-level
 * dirty set, saved from the header ("Änderungen speichern"), like the fees.
 */
export function PriceSourceSettingsSection({
  priceSourceMode,
  priceSourceError,
  priceSourceSuccess,
  onPriceSourceChange,
}) {
  const { t } = useTranslation("settings");
  return (
    <SettingsCard id="settings-section-price-source">
      <SettingsCardHeader
        title={t("priceSource.title")}
        description={t("priceSource.hint")}
        action={
          priceSourceError ? (
            <StatusPill tone="danger">{priceSourceError}</StatusPill>
          ) : priceSourceSuccess ? (
            <StatusPill tone="success" dot>
              {priceSourceSuccess}
            </StatusPill>
          ) : null
        }
      />
      <SettingsCardBody>
        <div className="grid gap-2.5 sm:grid-cols-3">
          {PRICE_SOURCE_OPTIONS.map((option) => (
            <SettingsTile
              key={option.value}
              active={priceSourceMode === option.value}
              label={t(option.labelKey)}
              hint={t(option.hintKey)}
              onClick={() => onPriceSourceChange(option.value)}
            />
          ))}
        </div>
      </SettingsCardBody>
    </SettingsCard>
  );
}
