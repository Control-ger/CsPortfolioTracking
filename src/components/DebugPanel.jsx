import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

export function DebugPanel() {
  const [logs, setLogs] = useState({ app: [], proxy: [] });
  const [environment, setEnvironment] = useState(null);
  const [debug, setDebug] = useState(null);
  const [loading, setLoading] = useState(false);

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

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center">
        <button
          onClick={fetchLogs}
          disabled={loading}
          className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? "Laden..." : "Aktualisieren"}
        </button>
      </div>

      {environment && (
        <>
          <Card className="border-yellow-500/50 bg-yellow-50/50">
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
            <Card className="border-red-500/50 bg-red-50/50">
              <CardHeader>
                <CardTitle className="text-sm">Debug Info (warum kein API-Key?)</CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-2 font-mono">
                <p>
                  <strong>getenv():</strong> {debug.getenv}
                </p>
                <p>
                  <strong>$_ENV:</strong> {debug.ENV}
                </p>
                
                <div className="mt-3 pt-3 border-t">
                  <p className="font-bold mb-1">.env Datei Standorte:</p>
                  {debug.env_locations && Object.entries(debug.env_locations).map(([path, exists]) => (
                    <p key={path}>
                      {exists ? "✅" : "❌"} {path}
                    </p>
                  ))}
                </div>

                <div className="mt-3 pt-3 border-t">
                  <p className="font-bold mb-1">System Info:</p>
                  <p>SAPI: {debug.php_sapi_name}</p>
                  <p>CWD: {debug.getcwd}</p>
                </div>

                <div className="mt-3 pt-3 border-t">
                  <p className="font-bold mb-1">Alle Env-Keys ({debug.all_env_keys?.length || 0}):</p>
                  <div className="max-h-40 overflow-auto bg-white p-2 rounded text-[10px]">
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
            <div className="bg-black text-green-400 p-3 rounded font-mono text-xs overflow-auto max-h-96 space-y-1">
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
            <div className="bg-black text-blue-400 p-3 rounded font-mono text-xs overflow-auto max-h-96 space-y-1">
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
    </div>
  );
}
