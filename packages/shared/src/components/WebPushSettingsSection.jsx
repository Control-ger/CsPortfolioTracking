import { Skeleton } from "@shared/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@shared/components/ui/card";
import { Button } from "@shared/components/ui/button";
import { Badge } from "@shared/components/ui/badge";
import { Bell } from "lucide-react";

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
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          <CardTitle>Browser Push (CS Updates)</CardTitle>
          <Badge variant="outline" className="ml-auto">
            {webPushSubscribed ? "Aktiv" : "Inaktiv"}
          </Badge>
        </div>
        <CardDescription>
          Erhalte Benachrichtigungen bei neuen CS-Updates auf Mobile und Desktop (PWA/Web).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!webPushSupported ? (
          <div className="rounded-lg border border-border bg-transparent p-3 text-sm text-muted-foreground dark:border-border/70 dark:bg-card/65">
            Browser Push ist hier nicht verfuegbar (z.B. Electron Runtime oder fehlende Push-Unterstuetzung).
          </div>
        ) : null}

        {webPushLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-44" />
          </div>
        ) : null}

        {webPushError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {webPushError}
          </div>
        ) : null}

        {webPushSuccess ? (
          <div className="rounded-xl border border-emerald-400/35 bg-emerald-500/12 p-3 text-sm text-emerald-300">
            {webPushSuccess}
          </div>
        ) : null}

        <div className="rounded-lg border border-border bg-transparent p-3 text-xs text-muted-foreground dark:border-border/70 dark:bg-card/65">
          <p>
            Berechtigung: <span className="font-semibold text-foreground">{webPushPermission}</span>
          </p>
          <p>
            Server konfiguriert: <span className="font-semibold text-foreground">{webPushConfigured ? "ja" : "nein"}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => void onEnable()}
            disabled={!webPushSupported || webPushSaving}
          >
            {webPushSaving ? "Aktiviere..." : "Push aktivieren"}
          </Button>
          <Button
            variant="outline"
            onClick={() => void onDisable()}
            disabled={!webPushSupported || webPushSaving || !webPushSubscribed}
          >
            {webPushSaving ? "Deaktiviere..." : "Push deaktivieren"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
