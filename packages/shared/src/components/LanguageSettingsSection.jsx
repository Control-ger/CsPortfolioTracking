import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { useLanguage } from "@shared/contexts/LanguageContext";

import { NativeSelect } from "./ui/native-select.jsx";
import { SettingsCard, SettingsCardHeader, SettingsRow } from "./ui/settings-card.jsx";

const SYSTEM_VALUE = "system";

/**
 * The language control.
 *
 * The detection (stored choice → system language → English) has always been
 * there, but nothing rendered a way to see or override it: a profile whose
 * stored value disagreed with the system was stuck in that language with no way
 * out short of devtools. "System" is therefore a real option here, not just the
 * absence of a choice — picking it clears the stored value.
 */
export function LanguageSettingsSection() {
  const { t } = useTranslation("settings");
  const { language, languages, followsSystem, systemLanguage, setLanguage, followSystemLanguage } =
    useLanguage();

  const handleChange = useCallback(
    (event) => {
      const value = event.target.value;
      if (value === SYSTEM_VALUE) {
        void followSystemLanguage();
        return;
      }
      void setLanguage(value);
    },
    [setLanguage, followSystemLanguage],
  );

  // Native name, so the option is readable to someone who cannot read the
  // language the UI is currently in — the case that matters most here.
  const systemLabel =
    languages.find((entry) => entry.code === systemLanguage)?.nativeLabel || systemLanguage;

  return (
    <SettingsCard id="settings-section-language">
      <SettingsCardHeader title={t("language.title")} description={t("language.description")} />
      <SettingsRow
        title={t("language.uiLanguage")}
        description={
          followsSystem
            ? systemLanguage
              ? t("language.followingSystem", { language: systemLabel })
              : t("language.systemUnknown")
            : t("language.explicitChoice")
        }
        divider={false}
      >
        <NativeSelect
          aria-label={t("language.uiLanguage")}
          value={followsSystem ? SYSTEM_VALUE : language}
          onChange={handleChange}
        >
          <option value={SYSTEM_VALUE}>
            {systemLabel
              ? t("language.systemOptionWith", { language: systemLabel })
              : t("language.systemOption")}
          </option>
          {languages.map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.nativeLabel}
            </option>
          ))}
        </NativeSelect>
      </SettingsRow>
    </SettingsCard>
  );
}

export default LanguageSettingsSection;
