import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Skeleton } from './ui/skeleton';
import { AlertCircle, RefreshCw, Database } from 'lucide-react';
import { fetchCacheMaintenanceStats } from '../lib/apiClient';

export function CacheMaintenancePanel() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadStats();
    // Refresh alle 2 Minuten
    const interval = setInterval(loadStats, 120000);
    return () => clearInterval(interval);
  }, []);

  const loadStats = async () => {
    try {
      setLoading(true);
      const data = await fetchCacheMaintenanceStats();
      setStats(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading && !stats) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((entry) => (
            <Card key={entry}>
              <CardHeader className="pb-3">
                <Skeleton className="h-4 w-28" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-8 w-24" />
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader className="pb-3">
            <Skeleton className="h-4 w-44" />
          </CardHeader>
          <CardContent className="space-y-2">
            {[1, 2, 3, 4].map((entry) => (
              <Skeleton key={entry} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const cacheStats = stats?.cacheStats || {};
  const maintenanceLogs = stats?.maintenanceLogs || [];
  const maintenanceStats = stats?.maintenanceStats || {};

  return (
    <div className="space-y-4">
      {/* Cache Größen Overview */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Live Cache */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Live Cache</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div>
              <p className="text-2xl font-bold">{cacheStats.liveCache?.count || 0}</p>
              <p className="text-xs text-muted-foreground">Items (max 72h old)</p>
            </div>
            <div className="space-y-1 text-xs">
              <p className="text-muted-foreground">
                Oldest: {cacheStats.liveCache?.oldest || 'N/A'}
              </p>
              <p className="text-muted-foreground">
                Newest: {cacheStats.liveCache?.newest || 'N/A'}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Catalog Cache */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Catalog Cache</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div>
              <p className="text-2xl font-bold">{cacheStats.catalogCache?.count || 0}</p>
              <p className="text-xs text-muted-foreground">Items (max 7d old)</p>
            </div>
            <div className="space-y-1 text-xs">
              <p className="text-muted-foreground">
                Oldest: {cacheStats.catalogCache?.oldest || 'N/A'}
              </p>
              <p className="text-muted-foreground">
                Newest: {cacheStats.catalogCache?.newest || 'N/A'}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Price History */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Price History</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div>
              <p className="text-2xl font-bold">{cacheStats.priceHistory?.count || 0}</p>
              <p className="text-xs text-muted-foreground">Entries (all kept)</p>
            </div>
            <div className="space-y-1 text-xs">
              <p className="text-muted-foreground">
                From: {cacheStats.priceHistory?.oldest || 'N/A'}
              </p>
              <p className="text-muted-foreground">
                To: {cacheStats.priceHistory?.newest || 'N/A'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Maintenance Stats */}
      {maintenanceStats.total_runs && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">
              Cleanup Stats (last 7 days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <p className="text-2xl font-bold">{maintenanceStats.total_runs}</p>
                <p className="text-xs text-muted-foreground">Total runs</p>
              </div>
              <div>
                <p className="text-lg font-bold text-orange-600">
                  {maintenanceStats.total_live_deleted || 0}
                </p>
                <p className="text-xs text-muted-foreground">Live cache entries deleted</p>
              </div>
              <div>
                <p className="text-lg font-bold text-blue-600">
                  {maintenanceStats.total_catalog_deleted || 0}
                </p>
                <p className="text-xs text-muted-foreground">Catalog entries deleted</p>
              </div>
              <div>
                <p className="text-sm font-mono text-green-600">
                  {Math.round(maintenanceStats.avg_duration_ms || 0)}ms avg
                </p>
                <p className="text-xs text-muted-foreground">
                  Max: {maintenanceStats.max_duration_ms || 0}ms
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Cleanup Logs */}
      {maintenanceLogs.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">
              Recent Cleanups (last 20)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {maintenanceLogs.map((log, idx) => (
                <div key={idx} className="flex items-center justify-between border-b pb-2 last:border-b-0">
                  <div className="text-xs space-y-1 flex-1">
                    <p className="font-semibold text-muted-foreground">
                      {new Date(log.executed_at).toLocaleString('de-DE')}
                    </p>
                    <div className="flex gap-2">
                      {log.live_cache_deleted > 0 && (
                        <Badge variant="outline" className="text-orange-600 border-orange-200">
                          Live: {log.live_cache_deleted}
                        </Badge>
                      )}
                      {log.catalog_cache_deleted > 0 && (
                        <Badge variant="outline" className="text-blue-600 border-blue-200">
                          Catalog: {log.catalog_cache_deleted}
                        </Badge>
                      )}
                      <span className="text-muted-foreground">
                        ({log.duration_ms}ms)
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Refresh Button */}
      <button
        onClick={loadStats}
        disabled={loading}
        className="w-full px-4 py-2 text-sm font-medium rounded-lg border border-input bg-background hover:bg-accent disabled:opacity-50 flex items-center justify-center gap-2"
      >
        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        {loading ? 'Refreshing...' : 'Refresh Stats'}
      </button>
    </div>
  );
}

