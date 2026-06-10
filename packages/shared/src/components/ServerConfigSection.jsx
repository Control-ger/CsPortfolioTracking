import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@shared/components/ui/card";
import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";

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
  return (
    <Card>
      <CardHeader>
        <CardTitle>Server Verbindung</CardTitle>
        <CardDescription>
          URL fuer Sync und Server-Features. Lokal gespeichert im Desktop-Profil.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {serverConfigError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {serverConfigError}
          </div>
        ) : null}
        {serverConfigMessage ? (
          <div className="rounded-xl border border-emerald-400/35 bg-emerald-500/12 p-3 text-sm text-emerald-300">
            {serverConfigMessage}
          </div>
        ) : null}
        <Input
          value={serverUrl}
          onChange={onUrlChange}
          placeholder="cs2.clustercontrol.cc"
          disabled={serverConfigLoading || serverConfigSaving || serverConfigTesting}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={serverConfigLoading || serverConfigTesting || !serverUrl.trim()}
            onClick={onTestConnection}
          >
            {serverConfigTesting ? "Teste..." : "Verbindung testen"}
          </Button>
          <Button
            disabled={serverConfigLoading || serverConfigSaving || !serverUrl.trim()}
            onClick={onSave}
          >
            {serverConfigSaving ? "Speichert..." : "Speichern"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
