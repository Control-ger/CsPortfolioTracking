import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
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
        setEnvironment(data.data.environment);
        setDebug(data.data.debug);
      }
    } catch (error) {
      console.error("Fehler beim Laden der Logs:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const showInitialLoading = loading && !environment && logs.app.length === 0 && logs.proxy.length === 0;

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="csfloat">CSFloat & Logs</TabsTrigger>
          <TabsTrigger value="cache">Cache Maintenance</TabsTrigger>
        </TabsList>

        <TabsContent value="csfloat" className="space-y-4">
          <div className="flex gap-2 items-center">
            <button
              onClick={fetchLogs}
              disabled={loading}
              className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? "Laden..." : "Aktualisieren"}
            </button>
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

          {environment && (
            <>
              <Card className="border-amber-200/50 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/20">
                <CardHeader>
                  <CardTitle className="text-sm">CSFloat Konfiguration</CardTitle>
                </CardHeader>
                <CardContent className="text-xs space-y-1">
                  <p>
                    <strong>API-Key vorhanden:</strong> {environment.apiKeyProvided ? "✅ Ja" : "❌ Nein"}
                  </p>
                  <p>
                    <strong>API-Key Länge:</strong> {environment.apiKeyLength}
                  </p>
                  <p>
                    <strong>API-Key Prefix:</strong> {environment.apiKeyPrefix}
                  </p>
                </CardContent>
              </Card>

              {debug && (
                <Card className="border-red-200/50 dark:border-red-800/50 bg-red-50/50 dark:bg-red-950/20">
                  <CardHeader>
                    <CardTitle className="text-sm">Debug Info</CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs space-y-2 font-mono">
                    <p>
                      <strong>getenv():</strong> {debug.getenv}
                    </p>
                    <p>
                      <strong>$_ENV:</strong> {debug.ENV}
                    </p>

                    <div className="mt-3 pt-3 border-t dark:border-muted">
                      <p className="font-bold mb-1">.env Datei Standorte:</p>
                      {debug.env_locations && Object.entries(debug.env_locations).map(([path, exists]) => (
                        <p key={path}>
                          {exists ? "✅" : "❌"} {path}
                        </p>
                      ))}
                    </div>

                    <div className="mt-3 pt-3 border-t dark:border-muted">
                      <p className="font-bold mb-1">System Info:</p>
                      <p>SAPI: {debug.php_sapi_name}</p>
                      <p>CWD: {debug.getcwd}</p>
                    </div>

                    <div className="mt-3 pt-3 border-t dark:border-muted">
                      <p className="font-bold mb-1">Alle Env-Keys ({debug.all_env_keys?.length || 0}):</p>
                      <div className="max-h-40 overflow-auto bg-background dark:bg-slate-900 p-2 rounded text-[10px] border dark:border-muted">
                        {debug.all_env_keys?.map(key => (
                          <p key={key}>{key}</p>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {logs.app && logs.app.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">App Logs ({logs.app.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-green-400 p-3 rounded font-mono text-xs overflow-auto max-h-96 space-y-1 border dark:border-muted">
                  {logs.app.map((line, idx) => (
                    <div key={idx} className="break-words">
                      {line}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {logs.proxy && logs.proxy.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">CSFloat Proxy Logs ({logs.proxy.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-blue-400 p-3 rounded font-mono text-xs overflow-auto max-h-96 space-y-1 border dark:border-muted">
                  {logs.proxy.map((line, idx) => (
                    <div key={idx} className="break-words">
                      {line}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {!logs.app || (logs.app.length === 0 && !logs.proxy) || logs.proxy.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="pt-6 text-center text-muted-foreground">
                Keine Logs vorhanden
              </CardContent>
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
