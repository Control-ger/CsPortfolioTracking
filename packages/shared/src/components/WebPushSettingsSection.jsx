const PERMISSION_LABEL = {
  granted: "erteilt",
  denied: "blockiert",
  default: "noch nicht erteilt",
};

/**
 * Footer strip of the Web-Push channel inside the Benachrichtigungen card.
 *
 * The per-event toggles above only decide *what* gets sent; this line owns the
 * one prerequisite they cannot express — the browser permission and the push
 * subscription itself — which is why the design keeps it as a single closing
 * sentence with one action rather than its own card.
 */
export function WebPushSettingsSection({
  webPushSupported,
  webPushLoading,
  webPushError,
  webPushSuccess,
  webPushPermission,
  webPushConfigured,
  webPushSubscribed,
  webPushSaving,
  onEnable,
  onDisable,
}) {
  const message = webPushError
    ? webPushError
    : webPushSuccess
      ? webPushSuccess
      : !webPushSupported
        ? "Browser Push ist in dieser Umgebung nicht verfügbar."
        : webPushLoading
          ? "Push-Status wird geladen …"
          : !webPushConfigured
            ? "Push ist serverseitig noch nicht konfiguriert (VAPID Keys fehlen)."
            : null;
  const tone = webPushError ? "text-danger" : webPushSuccess ? "text-success" : "text-muted-foreground";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
      <p className={`min-w-0 text-[11px] leading-[1.55] ${tone}`}>
        {message ?? (
          <>
            Web Push braucht eine erteilte Browser-Berechtigung. Status:{" "}
            <span
              className={`font-bold ${
                webPushPermission === "granted"
                  ? "text-success"
                  : webPushPermission === "denied"
                    ? "text-danger"
                    : "text-warn"
              }`}
            >
              {PERMISSION_LABEL[webPushPermission] || webPushPermission}
            </span>{" "}
            · Abo auf diesem Gerät{" "}
            <span className={`font-bold ${webPushSubscribed ? "text-success" : "text-muted-foreground"}`}>
              {webPushSubscribed ? "aktiv" : "inaktiv"}
            </span>
            .
          </>
        )}
      </p>
      <button
        type="button"
        onClick={() => void (webPushSubscribed ? onDisable() : onEnable())}
        disabled={!webPushSupported || webPushSaving}
        className="h-8 shrink-0 whitespace-nowrap rounded-[9px] border border-border-strong px-3 text-[12px] font-semibold text-foreground transition-colors hover:bg-surface-2 disabled:opacity-40"
      >
        {webPushSaving
          ? "Moment …"
          : webPushSubscribed
            ? "Push deaktivieren"
            : "Push aktivieren"}
      </button>
    </div>
  );
}
