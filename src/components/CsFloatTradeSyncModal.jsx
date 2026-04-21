import { useEffect, useMemo, useState } from "react";

import { BaseModal } from "@/components/BaseModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  executeCsFloatTradeSync,
  fetchCsFloatTradeSyncPreview,
} from "@/lib/apiClient";

function formatPrice(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }

  return `${value.toFixed(2)} EUR`;
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  return value;
}

function Stat({ label, value, tone = "muted" }) {
  const toneClass =
    tone === "positive"
      ? "text-green-600"
      : tone === "negative"
        ? "text-red-600"
        : "text-foreground";

  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-bold ${toneClass}`}>{value}</div>
    </div>
  );
}

export function CsFloatTradeSyncModal({ isOpen, onClose, onSynced }) {
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [executeResult, setExecuteResult] = useState(null);

  const loadPreview = async () => {
    try {
      setLoadingPreview(true);
      setError("");
      setExecuteResult(null);
      const response = await fetchCsFloatTradeSyncPreview({ type: "buy", limit: 1000, maxPages: 10 });
      setPreview(response?.data || null);
    } catch (requestError) {
      setError(requestError.message || "Preview konnte nicht geladen werden.");
    } finally {
      setLoadingPreview(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setBackupConfirmed(false);
    setPreview(null);
    setExecuteResult(null);
    void loadPreview();
  }, [isOpen]);

  const sampleRows = useMemo(() => preview?.sampleTrades || [], [preview]);
  const skipReasons = useMemo(() => preview?.skipReasons || {}, [preview]);
  const skippedExamples = useMemo(() => preview?.skippedExamples || [], [preview]);
  const skipReasonEntries = useMemo(() => Object.entries(skipReasons).sort((a, b) => b[1] - a[1]), [skipReasons]);
  const hasPreview = Boolean(preview);

  const handleExecute = async () => {
    try {
      setExecuting(true);
      setError("");
      const response = await executeCsFloatTradeSync({
        type: preview?.requested?.type || "buy",
        limit: preview?.requested?.limit || 1000,
        maxPages: preview?.requested?.maxPages || 10,
        backupConfirmed,
      });
      const payload = response?.data || null;
      setExecuteResult(payload);
      onSynced?.(payload);
      await loadPreview();
    } catch (requestError) {
      setError(requestError.message || "Import konnte nicht ausgefuehrt werden.");
    } finally {
      setExecuting(false);
    }
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="CSFloat Trades Sync"
      size="full"
      className="p-0"
    >
      <div className="flex h-full flex-col gap-4 overflow-hidden">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
          Bitte vor dem Import manuell ein Datenbank-Backup erstellen. Der Sync importiert neue CSFloat-Trades als Portfolio-Items.
        </div>

        {error ? (
          <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Stat label="Rohdaten" value={preview ? preview.totalFetched : "-"} />
          <Stat label="Normalisiert" value={preview ? preview.normalizedCount : "-"} />
          <Stat label="Importierbar" value={preview ? preview.insertable : "-"} tone="positive" />
          <Stat label="Duplikate" value={preview ? preview.duplicates : "-"} tone="negative" />
          <Stat label="Seiten" value={preview ? preview.pagesFetched : "-"} />
        </div>

        {preview?.clustering?.applied ? (
          <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
            Clustering aktiv: {preview.clustering.baseNormalizedCount} normalisierte Trades wurden zu {preview.clustering.clusteredCount} Positionen zusammengefasst ({preview.clustering.collapsedTrades} zusammengelegt).
          </div>
        ) : null}

        {preview?.skipped > 0 ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
            <div className="font-semibold">{preview.skipped} Trades wurden uebersprungen.</div>
            {skipReasonEntries.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-2">
                {skipReasonEntries.map(([reason, count]) => (
                  <Badge key={reason} variant="outline" className="border-amber-700/40 text-amber-900 dark:text-amber-200">
                    {reason}: {count}
                  </Badge>
                ))}
              </div>
            ) : null}
            {skippedExamples.length > 0 ? (
              <div className="mt-2 space-y-1 text-[11px] text-amber-900/90 dark:text-amber-100/90">
                {skippedExamples.slice(0, 3).map((example, index) => (
                  <div key={`${example.reason || "skip"}-${example.externalTradeId || index}`}>
                    {example.reason}
                    {example.externalTradeId ? ` | ${example.externalTradeId}` : ""}
                    {example.name ? ` | ${example.name}` : ""}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {preview?.backupRequired ? (
          <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
            {preview.disclaimer}
          </div>
        ) : null}

        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <CardHeader className="shrink-0 pb-2">
            <CardTitle className="text-sm uppercase text-muted-foreground">Preview</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-3 overflow-hidden">
            {loadingPreview ? (
              <div className="h-full space-y-2 overflow-hidden pr-1">
                {[1, 2, 3, 4].map((entry) => (
                  <div key={entry} className="grid gap-2 rounded-md border bg-background p-3 md:grid-cols-[1.2fr_0.5fr_0.6fr_0.7fr_0.8fr] md:items-center">
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-4/5" />
                      <Skeleton className="h-3 w-3/5" />
                    </div>
                    <Skeleton className="h-4 w-10 md:ml-auto" />
                    <Skeleton className="h-4 w-16 md:ml-auto" />
                    <Skeleton className="h-4 w-20 md:ml-auto" />
                    <div className="flex items-center justify-between gap-2 md:justify-end">
                      <Skeleton className="h-5 w-16 rounded-full" />
                      <Skeleton className="h-3 w-12" />
                    </div>
                  </div>
                ))}
              </div>
            ) : sampleRows.length === 0 ? (
              <div className="text-sm text-muted-foreground">Keine Trades gefunden oder keine importierbaren Eintraege.</div>
            ) : (
              <div className="h-full space-y-2 overflow-y-auto pr-1">
                {sampleRows.map((trade) => (
                  <div
                    key={trade.externalTradeId}
                    className="grid gap-2 rounded-md border bg-background p-3 text-sm md:grid-cols-[1.2fr_0.5fr_0.6fr_0.7fr_0.8fr] md:items-center"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{trade.name}</div>
                      <div className="truncate text-[10px] text-muted-foreground">{trade.marketHashName}</div>
                    </div>
                    <div className="text-xs text-muted-foreground md:text-right">{trade.quantity}x</div>
                    <div className="text-xs md:text-right">{formatPrice(trade.buyPrice)}</div>
                    <div className="text-xs text-muted-foreground md:text-right">{formatDate(trade.purchasedAt)}</div>
                    <div className="flex items-center justify-between gap-2 md:justify-end">
                      <Badge variant={trade.status === "duplicate" ? "outline" : "default"}>
                        {trade.status}
                      </Badge>
                      <span className="text-[10px] uppercase text-muted-foreground">{trade.typeLabel}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {executeResult ? (
          <div className="rounded-lg border bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
            Import fertig: {executeResult.inserted || 0} neu, {executeResult.updated || 0} aktualisiert, {executeResult.duplicates || 0} Duplikate, {executeResult.skipped || 0} uebersprungen.
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={backupConfirmed}
              onChange={(event) => setBackupConfirmed(event.target.checked)}
              className="h-4 w-4 rounded border border-input"
            />
            Ich habe ein Backup erstellt
          </label>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={loadPreview} disabled={loadingPreview || executing}>
              Preview neu laden
            </Button>
            <Button type="button" onClick={handleExecute} disabled={!hasPreview || executing || !backupConfirmed}>
              {executing ? "Import laeuft..." : "Import starten"}
            </Button>
          </div>
        </div>
      </div>
    </BaseModal>
  );
}

