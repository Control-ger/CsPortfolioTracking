import { Eye, EyeOff, AppWindow } from "lucide-react";

import { Skeleton } from "@shared/components/ui/skeleton";
import { SettingsKeyRow, SettingsKeyInput } from "@shared/components/ui/settings-card";

/**
 * SkinBaron row of the "API-Schlüssel" card. Unlike CSFloat this is a session
 * cookie, and the primary path is the browser login — "Verbinden" opens an
 * embedded Chromium window and captures AUTHID, which is why it carries the
 * same window icon as the design's "can open a browser window" actions.
 */
export function SkinBaronApiKeySection({
  skinBaronStatusLoading,
  skinBaronApiKeyStatus,
  skinBaronApiKeyError,
  skinBaronApiKeySuccess,
  skinBaronSessionCookie,
  showSkinBaronSessionCookie,
  skinBaronSessionSaving,
  skinBaronSessionBrowserConnecting,
  encryptionReady,
  onSessionCookieChange,
  onToggleShowSessionCookie,
  onSaveSessionCookie,
  onConnectViaBrowser,
}) {
  if (skinBaronStatusLoading) {
    return (
      <SettingsKeyRow name="SkinBaron" state="wird geladen …">
        <Skeleton className="h-[38px] w-full rounded-[10px]" />
      </SettingsKeyRow>
    );
  }

  const sessionCookieAccess = skinBaronApiKeyStatus?.sessionCookieAccess || {};
  const importReady =
    skinBaronApiKeyStatus?.importReady === true || sessionCookieAccess?.allowed === true;
  const checkedAt = skinBaronApiKeyStatus?.sessionCookieCheckedAt
    ? new Date(skinBaronApiKeyStatus.sessionCookieCheckedAt).toLocaleString("de-DE")
    : "";

  const state = skinBaronApiKeyError
    ? skinBaronApiKeyError
    : skinBaronApiKeySuccess
      ? skinBaronApiKeySuccess
      : importReady
        ? `Import bereit${checkedAt ? ` · geprüft ${checkedAt}` : ""}`
        : skinBaronApiKeyStatus?.sessionCookieConfigured
          ? `Session abgelaufen · AUTHID …${skinBaronApiKeyStatus.sessionCookieLastFour || "----"}`
          : "Keine Session hinterlegt";
  const stateTone = skinBaronApiKeyError
    ? "danger"
    : skinBaronApiKeySuccess || importReady
      ? "success"
      : skinBaronApiKeyStatus?.sessionCookieConfigured
        ? "warn"
        : "danger";

  const busy = skinBaronSessionSaving || skinBaronSessionBrowserConnecting;

  return (
    <SettingsKeyRow name="SkinBaron (AUTHID)" state={state} stateTone={stateTone}>
      <span className="relative block min-w-0">
        <SettingsKeyInput
          type={showSkinBaronSessionCookie ? "text" : "password"}
          value={skinBaronSessionCookie}
          onChange={onSessionCookieChange}
          placeholder="AUTHID=…"
          disabled={busy || !encryptionReady}
          className="pr-10"
        />
        <button
          type="button"
          onClick={onToggleShowSessionCookie}
          disabled={busy}
          aria-label={showSkinBaronSessionCookie ? "Cookie verbergen" : "Cookie anzeigen"}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
        >
          {showSkinBaronSessionCookie ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </span>
      <span className="flex gap-2">
        <button
          type="button"
          title="Öffnet ein Chromium-Fenster zum Anmelden"
          onClick={onConnectViaBrowser}
          disabled={busy || !encryptionReady}
          className="inline-flex h-[34px] items-center gap-1.5 whitespace-nowrap rounded-[9px] border border-border-strong px-3 text-[12px] font-semibold text-foreground transition-colors hover:bg-surface-2 disabled:opacity-40"
        >
          <AppWindow className="size-[13px] shrink-0 opacity-70" />
          {skinBaronSessionBrowserConnecting ? "Warte auf Login…" : "Verbinden"}
        </button>
        <button
          type="button"
          onClick={onSaveSessionCookie}
          disabled={busy || !encryptionReady || !skinBaronSessionCookie.trim()}
          className="h-[34px] whitespace-nowrap rounded-[9px] bg-primary px-3 text-[12px] font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {skinBaronSessionSaving ? "Prüft…" : "Speichern"}
        </button>
      </span>
    </SettingsKeyRow>
  );
}
