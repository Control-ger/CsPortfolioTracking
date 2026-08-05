import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
  SettingsTile,
} from "@shared/components/ui/settings-card";
import { StatusPill } from "@shared/components/ui/status-pill";

const PRICE_SOURCE_OPTIONS = [
  { value: "auto", label: "Auto", hint: "CSFloat zuerst, Steam als Fallback" },
  { value: "csfloat", label: "CSFloat", hint: "Nur CSFloat bevorzugen" },
  { value: "steam", label: "Steam", hint: "Nur Steam bevorzugen" },
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
  return (
    <SettingsCard id="settings-section-price-source">
      <SettingsCardHeader
        title="Live-Preisquelle"
        description="Woher die App aktuelle Marktpreise zieht."
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
              label={option.label}
              hint={option.hint}
              onClick={() => onPriceSourceChange(option.value)}
            />
          ))}
        </div>
      </SettingsCardBody>
    </SettingsCard>
  );
}
