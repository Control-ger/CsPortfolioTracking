import { Skeleton } from "@shared/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@shared/components/ui/card";
import { Input } from "@shared/components/ui/input";
import { Button } from "@shared/components/ui/button";
import { Badge } from "@shared/components/ui/badge";
import { Key, Lock, AlertCircle, Eye, EyeOff } from "lucide-react";

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
  if (apiKeyLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-32" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          <CardTitle>CSFloat API Key</CardTitle>
          {apiKeyStatus.configured && (
            <Badge variant="outline" className="ml-auto border-emerald-400/35 text-emerald-300">
              Konfiguriert
            </Badge>
          )}
        </div>
        <CardDescription>
          API Key fuer CSFloat Integration. Wird lokal verschluesselt gespeichert.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!encryptionReady && (
          <div className="rounded-xl border border-amber-400/35 bg-amber-500/12 p-3 text-sm text-amber-300">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              <span>
                {desktopRuntime
                  ? "OS-Verschluesselung ist auf diesem System nicht verfuegbar."
                  : "Verschluesselung nicht konfiguriert. Bitte VITE_ENCRYPTION_KEY in .env setzen."}
              </span>
            </div>
          </div>
        )}

        {apiKeyError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {apiKeyError}
          </div>
        )}
        {apiKeySuccess && (
          <div className="rounded-xl border border-emerald-400/35 bg-emerald-500/12 p-3 text-sm text-emerald-300">
            {apiKeySuccess}
          </div>
        )}

        {/* Current Status */}
        {apiKeyStatus.configured && (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/18">
              <Lock className="h-5 w-5 text-emerald-300" />
            </div>
            <div>
              <p className="text-sm font-medium">API Key aktiv</p>
              <p className="text-xs text-muted-foreground">Endet auf ...{apiKeyStatus.lastFour}</p>
            </div>
          </div>
        )}

        {/* Input Section */}
        <div className="space-y-3">
          <label className="text-sm font-medium">
            {apiKeyStatus.configured ? "Neuen Key eingeben" : "API Key eingeben"}
          </label>
          <div className="relative">
            <Input
              type={showApiKey ? "text" : "password"}
              value={apiKey}
              onChange={onApiKeyChange}
              placeholder={apiKeyStatus.configured ? "Zum Aendern neuen Key eingeben..." : "CSFloat API Key..."}
              disabled={apiKeySaving || !encryptionReady}
              className="pr-10"
            />
            <button
              type="button"
              onClick={onToggleShowApiKey}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              disabled={apiKeySaving}
            >
              {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            {desktopRuntime
              ? "Desktop speichert den Key ueber die OS-Verschluesselung im Electron Main Process."
              : "Web-Modus: CSFloat Key-Update ist deaktiviert."}
          </p>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={onUpdate}
            disabled={apiKeySaving || !encryptionReady || !apiKey.trim()}
          >
            {apiKeySaving ? "Speichert..." : apiKeyStatus.configured ? "Key Aktualisieren" : "Key Speichern"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
