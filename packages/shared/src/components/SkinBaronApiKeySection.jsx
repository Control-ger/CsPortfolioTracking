import { Skeleton } from "@shared/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@shared/components/ui/card";
import { Input } from "@shared/components/ui/input";
import { Button } from "@shared/components/ui/button";
import { Badge } from "@shared/components/ui/badge";
import { Key, Eye, EyeOff } from "lucide-react";

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
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-4 w-80" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-28 w-full" />
        </CardContent>
      </Card>
    );
  }

  const sessionCookieAccess = skinBaronApiKeyStatus?.sessionCookieAccess || {};
  const readOnlyImportReady = skinBaronApiKeyStatus?.importReady === true
    || sessionCookieAccess?.allowed === true;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          <CardTitle>SkinBaron AUTHID</CardTitle>
        </div>
        <CardDescription>
          Der SkinBaron Import nutzt ausschliesslich den Session-Cookie (AUTHID) und speichert ihn lokal verschluesselt.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div
          className={
            readOnlyImportReady
              ? "rounded-xl border border-emerald-400/35 bg-emerald-500/12 p-3 text-sm text-emerald-300"
              : "rounded-xl border border-amber-400/35 bg-amber-500/12 p-3 text-sm text-amber-200"
          }
        >
          <p className="font-medium">
            {readOnlyImportReady ? "Read-only Preset: Import bereit" : "Read-only Preset: Import noch nicht bereit"}
          </p>
          <p className="mt-1 text-xs text-current/90">
            Voraussetzung ist ein gueltiger <span className="font-semibold">SkinBaron Session-Cookie (AUTHID)</span>.{" "}
            {readOnlyImportReady
              ? "Der SkinBaron-Import kann jetzt genutzt werden."
              : "Bitte Session-Cookie pruefen oder neu setzen."}
          </p>
        </div>

        <div className="space-y-3 rounded-xl border border-border/70 bg-card/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Session-Cookie fuer Purchases</p>
            <Badge
              variant="outline"
              className={readOnlyImportReady ? "border-emerald-400/35 text-emerald-300" : "border-amber-400/35 text-amber-300"}
            >
              {readOnlyImportReady ? "Import Ready" : "Nicht bereit"}
            </Badge>
          </div>

          {skinBaronApiKeyStatus?.sessionCookieConfigured ? (
            <div className="rounded-lg border border-emerald-400/25 bg-emerald-500/10 p-2 text-xs text-muted-foreground">
              AUTHID ...{skinBaronApiKeyStatus.sessionCookieLastFour || "----"}
              {skinBaronApiKeyStatus?.sessionCookieCheckedAt
                ? ` | letzter Purchases-Check: ${new Date(skinBaronApiKeyStatus.sessionCookieCheckedAt).toLocaleString("de-DE")}`
                : ""}
              {sessionCookieAccess?.message ? ` | ${sessionCookieAccess.message}` : ""}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Noch kein Session-Cookie gespeichert. Bitte `AUTHID=...` aus einer aktiven SkinBaron-Websession hinterlegen.
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/40 p-2">
            <p className="text-[11px] text-muted-foreground">
              Automatisch: Login-Fenster oeffnen, bei erfolgreichem Login wird `AUTHID` direkt uebernommen.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={onConnectViaBrowser}
              disabled={skinBaronSessionSaving || skinBaronSessionBrowserConnecting || !encryptionReady}
            >
              {skinBaronSessionBrowserConnecting ? "Warte auf Login..." : "Mit SkinBaron verbinden"}
            </Button>
          </div>

          <div className="relative">
            <Input
              type={showSkinBaronSessionCookie ? "text" : "password"}
              value={skinBaronSessionCookie}
              onChange={onSessionCookieChange}
              placeholder="AUTHID=..."
              disabled={skinBaronSessionSaving || skinBaronSessionBrowserConnecting || !encryptionReady}
              className="pr-10"
            />
            <button
              type="button"
              onClick={onToggleShowSessionCookie}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              disabled={skinBaronSessionSaving || skinBaronSessionBrowserConnecting}
            >
              {showSkinBaronSessionCookie ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={onSaveSessionCookie}
              disabled={
                skinBaronSessionSaving
                || skinBaronSessionBrowserConnecting
                || !encryptionReady
                || !skinBaronSessionCookie.trim()
              }
            >
              {skinBaronSessionSaving ? "Prueft + speichert..." : "Session-Cookie Speichern"}
            </Button>
          </div>
        </div>

        {skinBaronApiKeyError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {skinBaronApiKeyError}
          </div>
        )}
        {skinBaronApiKeySuccess && (
          <div className="rounded-xl border border-emerald-400/35 bg-emerald-500/12 p-3 text-sm text-emerald-300">
            {skinBaronApiKeySuccess}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
