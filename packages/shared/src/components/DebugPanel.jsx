import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { CacheMaintenancePanel } from "./CacheMaintenancePanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

export function DebugPanel() {
  const [logs, setLogs] = useState({ app: [], proxy: [] });
  const [environment, setEnvironment] = useState(null);
  const [debug, setDebug] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("csfloat");

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/index.php/api/v1/debug/csfloat");
      const data = await response.json();
      if (data.data) {
        setLogs(data.data.logs || { app: [], proxy: [] });
        setEnvironment(data.data.environment || null);
        setDebug(data.data.debug || null);
      }
    } catch (error) {
      console.error("Fehler beim Laden der Logs:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchLogs();
  }, []);

  const showInitialLoading = loading && !environment && logs.app.length === 0 && logs.proxy.length === 0;
  const appLogCount = Array.isArray(logs.app) ? logs.app.length : 0;
  const proxyLogCount = Array.isArray(logs.proxy) ? logs.proxy.length : 0;
  const hasAnyLogs = appLogCount > 0 || proxyLogCount > 0;
  const statusTone = environment?.apiKeyProvided ? "default" : "destructive";
  const statusText = environment?.apiKeyProvided ? "API Key erkannt" : "API Key fehlt";

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="csfloat">CSFloat & Logs</TabsTrigger>
          <TabsTrigger value="cache">Cache Maintenance</TabsTrigger>
        </TabsList>

        <TabsContent value="csfloat" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void fetchLogs()} disabled={loading} size="sm">
              {loading ? "Laden..." : "Aktualisieren"}
            </Button>
            <Badge variant={statusTone}>{statusText}</Badge>
            <Badge variant="outline">App Logs: {appLogCount}</Badge>
            <Badge variant="outline">Proxy Logs: {proxyLogCount}</Badge>
          </div>

          {showInitialLoading ? (
            <>
              <Card>
                <CardHeader>
                  <Skeleton className="h-5 w-44" />
                </CardHeader>
                <CardContent className="space-y-2">
                  <Skeleton className="h-4 w-56" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-48" />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <Skeleton className="h-5 w-36" />
                </CardHeader>
                <CardContent className="space-y-2">
                  {[1, 2, 3, 4].map((entry) => (
                    <Skeleton key={entry} className="h-4 w-full" />
                  ))}
                </CardContent>
              </Card>
            </>
          ) : null}

          {environment ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Konfiguration</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <div className="flex items-center justify-between rounded border p-2">
                    <span className="text-muted-foreground">API Key</span>
                    <Badge variant={environment.apiKeyProvided ? "default" : "destructive"}>
                      {environment.apiKeyProvided ? "Vorhanden" : "Fehlt"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between rounded border p-2">
                    <span className="text-muted-foreground">Key Laenge</span>
                    <span className="font-mono">{environment.apiKeyLength ?? "-"}</span>
                  </div>
                  <div className="flex items-center justify-between rounded border p-2">
                    <span className="text-muted-foreground">Key Prefix</span>
                    <span className="font-mono">{environment.apiKeyPrefix || "-"}</span>
                  </div>
                </CardContent>
              </Card>

              {debug ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Runtime</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs">
                    <div className="flex items-center justify-between rounded border p-2">
                      <span className="text-muted-foreground">getenv()</span>
                      <span className="font-mono">{debug.getenv}</span>
                    </div>
                    <div className="flex items-center justify-between rounded border p-2">
                      <span className="text-muted-foreground">$_ENV</span>
                      <span className="font-mono">{debug.ENV}</span>
                    </div>
                    <div className="flex items-center justify-between rounded border p-2">
                      <span className="text-muted-foreground">SAPI</span>
                      <span className="font-mono">{debug.php_sapi_name || "-"}</span>
                    </div>
                    <div className="rounded border p-2">
                      <p className="mb-1 text-muted-foreground">Working Directory</p>
                      <p className="break-all font-mono text-[11px]">{debug.getcwd || "-"}</p>
                    </div>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          ) : null}

          {debug?.env_locations ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">.env Datei-Standorte</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {Object.entries(debug.env_locations).map(([entryPath, exists]) => (
                  <div key={entryPath} className="flex items-center justify-between rounded border p-2">
                    <span className="truncate text-muted-foreground">{entryPath}</span>
                    <Badge variant={exists ? "default" : "secondary"}>{exists ? "Gefunden" : "Fehlt"}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {debug?.all_env_keys?.length ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Env Keys ({debug.all_env_keys.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-40 overflow-auto rounded border bg-slate-100 p-2 font-mono text-[11px] dark:bg-slate-900">
                  {debug.all_env_keys.map((key) => (
                    <p key={key}>{key}</p>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {appLogCount > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">App Logs ({appLogCount})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-96 space-y-1 overflow-auto rounded border bg-slate-100 p-3 font-mono text-xs text-slate-900 dark:border-muted dark:bg-slate-900 dark:text-green-400">
                  {logs.app.map((line, idx) => (
                    <div key={idx} className="break-words">
                      {line}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {proxyLogCount > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">CSFloat Proxy Logs ({proxyLogCount})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-96 space-y-1 overflow-auto rounded border bg-slate-100 p-3 font-mono text-xs text-slate-900 dark:border-muted dark:bg-slate-900 dark:text-blue-400">
                  {logs.proxy.map((line, idx) => (
                    <div key={idx} className="break-words">
                      {line}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {!hasAnyLogs ? (
            <Card className="border-dashed">
              <CardContent className="pt-6 text-center text-muted-foreground">Keine Logs vorhanden</CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="cache">
          <CacheMaintenancePanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
