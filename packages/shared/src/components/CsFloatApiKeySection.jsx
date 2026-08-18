import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Skeleton } from "@shared/components/ui/skeleton";
import { SettingsKeyRow, SettingsKeyInput } from "@shared/components/ui/settings-card";

/**
 * One row of the "API-Schlüssel" card — the design lists CSFloat, SkinBaron and
 * the server host as sibling rows of a single table rather than three cards.
 */
export function CsFloatApiKeySection({
  apiKey,
  apiKeyLoading,
  apiKeySaving,
  apiKeyStatus,
  showApiKey,
  apiKeyError,
  apiKeySuccess,
  encryptionReady,
  desktopRuntime,
  onApiKeyChange,
  onToggleShowApiKey,
  onUpdate,
}) {
  const { t } = useTranslation("settings");
  if (apiKeyLoading) {
    return (
      <SettingsKeyRow name="CSFloat" state={t("csfloatKey.loading")}>
        <Skeleton className="h-[38px] w-full rounded-[10px]" />
      </SettingsKeyRow>
    );
  }

  const state = apiKeyError
    ? apiKeyError
    : apiKeySuccess
      ? apiKeySuccess
      : !encryptionReady
        ? desktopRuntime
          ? t("csfloatKey.osEncryptionUnavailable")
          : t("csfloatKey.encryptionNotConfigured")
        : apiKeyStatus.configured
          ? t("csfloatKey.validEndsIn", { lastFour: apiKeyStatus.lastFour })
          : t("csfloatKey.noKeyStored");
  const stateTone = apiKeyError
    ? "danger"
    : apiKeySuccess
      ? "success"
      : !encryptionReady
        ? "warn"
        : apiKeyStatus.configured
          ? "success"
          : "danger";

  return (
    <SettingsKeyRow name="CSFloat" state={state} stateTone={stateTone}>
      <span className="relative block min-w-0">
        <SettingsKeyInput
          type={showApiKey ? "text" : "password"}
          value={apiKey}
          onChange={onApiKeyChange}
          placeholder={
            apiKeyStatus.configured
              ? t("csfloatKey.changePlaceholder")
              : t("csfloatKey.placeholder")
          }
          disabled={apiKeySaving || !encryptionReady || !desktopRuntime}
          className="pr-10"
        />
        <button
          type="button"
          onClick={onToggleShowApiKey}
          disabled={apiKeySaving}
          aria-label={showApiKey ? t("csfloatKey.hideKey") : t("csfloatKey.showKey")}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
        >
          {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </span>
      <span className="flex gap-2">
        <button
          type="button"
          onClick={onUpdate}
          disabled={apiKeySaving || !encryptionReady || !apiKey.trim()}
          className="h-[34px] whitespace-nowrap rounded-[9px] bg-primary px-3 text-[12px] font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {apiKeySaving ? t("csfloatKey.saving") : t("csfloatKey.save")}
        </button>
      </span>
    </SettingsKeyRow>
  );
}
