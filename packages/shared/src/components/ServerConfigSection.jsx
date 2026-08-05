import { AppWindow } from "lucide-react";

import { SettingsKeyRow, SettingsKeyInput } from "@shared/components/ui/settings-card";

/** Server-host row of the "API-Schlüssel" card (last row — no divider). */
export function ServerConfigSection({
  serverUrl,
  serverConfigLoading,
  serverConfigSaving,
  serverConfigTesting,
  serverConfigError,
  serverConfigMessage,
  onUrlChange,
  onTestConnection,
  onSave,
}) {
  const state = serverConfigError
    ? serverConfigError
    : serverConfigMessage
      ? serverConfigMessage
      : serverConfigLoading
        ? "wird geladen …"
        : "Ziel für Sync & Server";
  const stateTone = serverConfigError ? "danger" : serverConfigMessage ? "success" : "muted";

  return (
    <SettingsKeyRow name="Server-Host" state={state} stateTone={stateTone} divider={false}>
      <SettingsKeyInput
        value={serverUrl}
        onChange={onUrlChange}
        placeholder="cs2.clustercontrol.cc"
        disabled={serverConfigLoading || serverConfigSaving || serverConfigTesting}
      />
      <span className="flex gap-2">
        <button
          type="button"
          title="Kann ein Chromium-Fenster für die Cloudflare-Bestätigung öffnen"
          onClick={onTestConnection}
          disabled={serverConfigLoading || serverConfigTesting || !serverUrl.trim()}
          className="inline-flex h-[34px] items-center gap-1.5 whitespace-nowrap rounded-[9px] border border-border-strong px-3 text-[12px] font-semibold text-foreground transition-colors hover:bg-surface-2 disabled:opacity-40"
        >
          <AppWindow className="size-[13px] shrink-0 opacity-70" />
          {serverConfigTesting ? "Testet…" : "Verbindung testen"}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={serverConfigLoading || serverConfigSaving || !serverUrl.trim()}
          className="h-[34px] whitespace-nowrap rounded-[9px] bg-primary px-3 text-[12px] font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {serverConfigSaving ? "Speichert…" : "Speichern"}
        </button>
      </span>
    </SettingsKeyRow>
  );
}
