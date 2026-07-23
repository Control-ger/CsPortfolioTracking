import { useEffect, useMemo, useState } from "react";

import { BaseModal } from "@shared/components/BaseModal";
import { Badge } from "@shared/components/ui/badge";
import { Button } from "@shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shared/components/ui/card";
import { Skeleton } from "@shared/components/ui/skeleton";
import {
  executeCsFloatTradeSync,
  fetchCsFloatTradeSyncPreview,
} from "@shared/lib/apiClient";
import { fetchCsFloatBuyOrdersData } from "@shared/lib/dataSource.js";
import { useCurrency } from "@shared/contexts/CurrencyContext";

function formatDate(value) {
  if (!value) {
    return "-";
  }

  return value;
}

function Stat({ label, value, tone = "muted" }) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-400"
      : tone === "negative"
        ? "text-red-400"
        : "text-foreground";

  return (
    <div className="rounded-xl border border-border/70 bg-card/65 px-2 py-1.5 sm:p-2">
      <div className="text-[9px] sm:text-[10px] uppercase text-muted-foreground leading-tight">{label}</div>
      <div className={`text-sm sm:text-base font-bold ${toneClass}`}>{value}</div>
    </div>
  );
}

export function CsFloatTradeSyncModal({ isOpen, onClose, onSynced }) {
  const { formatPrice } = useCurrency();
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [previewConfirmed, setPreviewConfirmed] = useState(false);
  const [error, setError] = useState("");

  const loadPreview = async () => {
    try {
      setLoadingPreview(true);
      setError("");
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

    setPreviewConfirmed(false);
    setPreview(null);
    void loadPreview();
  }, [isOpen]);

  const sampleRows = useMemo(() => {
    const rows = Array.isArray(preview?.importTrades)
      ? preview.importTrades
      : Array.isArray(preview?.sampleTrades)
        ? preview.sampleTrades
        : [];

    return rows.filter((trade) => {
      const status = String(trade?.status || "new").toLowerCase();
      return status !== "duplicate" && status !== "excluded";
    });
  }, [preview]);
  const hiddenIgnoredCount = useMemo(() => {
    const rows = Array.isArray(preview?.importTrades)
      ? preview.importTrades
      : Array.isArray(preview?.sampleTrades)
        ? preview.sampleTrades
        : [];

    return rows.filter((trade) => {
      const status = String(trade?.status || "").toLowerCase();
      return status === "duplicate" || status === "excluded";
    }).length;
  }, [preview]);
  const updatedCount = useMemo(() => {
    const rows = Array.isArray(preview?.importTrades)
      ? preview.importTrades
      : Array.isArray(preview?.sampleTrades)
        ? preview.sampleTrades
        : [];

    return rows.filter((trade) => String(trade?.status || "") === "updated").length;
  }, [preview]);
  const skipReasons = useMemo(() => preview?.skipReasons || {}, [preview]);
  const skipReasonEntries = useMemo(() => Object.entries(skipReasons).sort((a, b) => b[1] - a[1]), [skipReasons]);
  const previewErrors = useMemo(
    () => (Array.isArray(preview?.errors) ? preview.errors.filter(Boolean) : []),
    [preview],
  );
  const hasPreview = Boolean(preview);

  const handleExecute = async () => {
    try {
      setExecuting(true);
      setError("");
      const response = await executeCsFloatTradeSync({
        type: preview?.requested?.type || "buy",
        limit: preview?.requested?.limit || 1000,
        maxPages: preview?.requested?.maxPages || 10,
        backupConfirmed: previewConfirmed,
      });
      try {
        await fetchCsFloatBuyOrdersData({
          syncNow: true,
        });
      } catch (buyOrderSyncError) {
        console.warn("[csfloat-sync] buyorders refresh failed", buyOrderSyncError);
      }
      const payload = response?.data || null;
      await onSynced?.(payload);
      onClose();
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
      <div className="flex h-full flex-col gap-3 overflow-y-auto">
        {error ? (
          <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        ) : null}

        {previewErrors.length > 0 ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <div className="font-semibold">CSFloat hat den Abruf abgelehnt:</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {previewErrors.map((err, index) => (
                <li key={`${err?.code || "csfloat-error"}-${index}`}>
                  {err?.statusCode ? `${err.statusCode} ` : ""}
                  {err?.message || err?.label || err?.code || "Unbekannter CSFloat-Fehler"}
                  {String(err?.code || "").includes("UNAUTHORIZED") || err?.statusCode === 401
                    ? " — API-Key pruefen (Einstellungen → CSFloat)."
                    : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Stat label="Rohdaten" value={preview ? preview.totalFetched : "-"} />
          <Stat label="Normalisiert" value={preview ? preview.normalizedCount : "-"} />
          <Stat label="Importierbar" value={preview ? preview.insertable : "-"} tone="positive" />
          <Stat label="Aktualisiert" value={preview ? (preview.updated ?? updatedCount) : "-"} tone="positive" />
          <Stat label="Duplikate" value={preview ? preview.duplicates : "-"} tone="negative" />
          <Stat label="Seiten" value={preview ? preview.pagesFetched : "-"} />
          <Stat label="Übersprungen" value={preview ? preview.skipped ?? 0 : "-"} />
        </div>

        {preview?.clustering?.applied ? (
          <div className="rounded-xl border border-border/70 bg-card/65 px-2 py-1.5 text-[10px] text-muted-foreground">
            Clustering: {preview.clustering.baseNormalizedCount} → {preview.clustering.clusteredCount} Positionen
          </div>
        ) : null}

        {preview?.skipped > 0 ? (
          <div className="rounded-xl border border-amber-400/35 bg-amber-500/12 p-2 text-xs text-amber-200">
            <div className="flex flex-wrap items-center gap-1">
              <span className="font-semibold">{preview.skipped} übersprungen:</span>
              {skipReasonEntries.slice(0, 2).map(([reason, count]) => (
                <Badge key={reason} variant="outline" className="border-amber-400/35 bg-amber-500/10 text-[10px] text-amber-200">
                  {reason}: {count}
                </Badge>
              ))}
              {skipReasonEntries.length > 2 && (
                <span className="text-[10px] text-amber-300">+{skipReasonEntries.length - 2} mehr</span>
              )}
            </div>
          </div>
        ) : null}

        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <CardHeader className="shrink-0 pb-2">
            <CardTitle className="text-sm uppercase text-muted-foreground">Preview</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto">
            {loadingPreview ? (
              <div className="h-full space-y-2 overflow-hidden pr-1">
                {[1, 2, 3, 4].map((entry) => (
                  <div key={entry} className="grid gap-2 rounded-xl border border-border/70 bg-card/65 p-3 md:grid-cols-[1.2fr_0.5fr_0.6fr_0.7fr_0.8fr] md:items-center">
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
              <div className="text-sm text-muted-foreground">Keine neuen Cluster zum Import gefunden.</div>
            ) : (
              <div className="h-full space-y-2 overflow-y-auto pr-1">
                {sampleRows.slice(0, 20).map((trade) => (
                  <div
                    key={trade.externalTradeId}
                    className="grid gap-2 rounded-xl border border-border/70 bg-card/65 p-3 text-sm md:grid-cols-[1.2fr_0.5fr_0.6fr_0.7fr_0.8fr] md:items-center"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{trade.name}</div>
                      <div className="truncate text-[10px] text-muted-foreground">{trade.marketHashName}</div>
                    </div>
                    <div className="text-xs text-muted-foreground md:text-right">
                      {trade.quantity}x
                      {Number.isFinite(Number(trade?.quantityDelta)) && Number(trade.quantityDelta) !== 0
                        ? ` (${Number(trade.quantityDelta) > 0 ? "+" : ""}${Number(trade.quantityDelta)})`
                        : ""}
                    </div>
                    <div className="text-xs md:text-right">
                      {formatPrice(trade.buyPriceUsd ?? trade.buyPrice, {
                        useUsd: true,
                        buyPriceUsd: trade.buyPriceUsd ?? trade.buyPrice,
                      })}
                    </div>
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
            {hiddenIgnoredCount > 0 ? (
              <p className="text-xs text-muted-foreground">
                {hiddenIgnoredCount} Duplikate/Excluded in der Preview ausgeblendet.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between shrink-0">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={previewConfirmed}
              onChange={(event) => setPreviewConfirmed(event.target.checked)}
              className="h-4 w-4 rounded border border-input"
            />
            Preview bestätigen
          </label>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={loadPreview} disabled={loadingPreview || executing}>
              Preview neu laden
            </Button>
            <Button type="button" onClick={handleExecute} disabled={!hasPreview || executing || !previewConfirmed} data-keyboard-default>
              {executing ? "Import laeuft..." : "Import starten"}
            </Button>
          </div>
        </div>
      </div>
    </BaseModal>
  );
}
