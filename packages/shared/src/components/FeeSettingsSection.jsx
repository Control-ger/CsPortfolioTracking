import { Skeleton } from "@shared/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@shared/components/ui/card";
import { Input } from "@shared/components/ui/input";
import { Button } from "@shared/components/ui/button";
import { Badge } from "@shared/components/ui/badge";
import { Percent } from "lucide-react";

export function FeeSettingsSection({
  form,
  source,
  loading,
  saving,
  error,
  success,
  handleChange,
  handleSave,
}) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {[1, 2, 3, 4, 5].map((entry) => (
              <div key={entry} className={`space-y-2 ${entry === 5 ? "sm:col-span-2" : ""}`}>
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
          <Skeleton className="h-10 w-28" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Percent className="h-5 w-5" />
          <CardTitle>Gebuehren</CardTitle>
          <Badge variant="outline" className="ml-auto">{source === "db" ? "Aus DB" : "Standard"}</Badge>
        </div>
        <CardDescription>
          Konfiguriere die Gebuehren fuer Netto-ROI und Break-even Berechnungen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-xl border border-emerald-400/35 bg-emerald-500/12 p-3 text-sm text-emerald-300">
            {success}
          </div>
        )}

        {/* Trading Fees Section */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Trading Gebuehren</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="fxFeePercent">
                FX Fee (%)
              </label>
              <Input
                id="fxFeePercent"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={form.fxFeePercent}
                onChange={handleChange("fxFeePercent")}
                disabled={saving}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="sellerFeePercent">
                Seller Fee (%)
              </label>
              <Input
                id="sellerFeePercent"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={form.sellerFeePercent}
                onChange={handleChange("sellerFeePercent")}
                disabled={saving}
              />
            </div>
          </div>
        </div>

        {/* Deposit/Withdrawal Fees Section */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Ein-/Auszahlungsgebuehren</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="withdrawalFeePercent">
                Withdrawal Fee (%)
              </label>
              <Input
                id="withdrawalFeePercent"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={form.withdrawalFeePercent}
                onChange={handleChange("withdrawalFeePercent")}
                disabled={saving}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="depositFeePercent">
                Deposit Fee (%)
              </label>
              <Input
                id="depositFeePercent"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={form.depositFeePercent}
                onChange={handleChange("depositFeePercent")}
                disabled={saving}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="depositFeeFixedEur">
                Deposit Fee (Fix EUR)
              </label>
              <Input
                id="depositFeeFixedEur"
                type="number"
                min="0"
                step="0.01"
                value={form.depositFeeFixedEur}
                onChange={handleChange("depositFeeFixedEur")}
                disabled={saving}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 pt-2 border-t">
          <p className="text-xs text-muted-foreground max-w-md">
            Funding Mode wird pro Investment gesetzt und in der Netto-Berechnung beruecksichtigt.
          </p>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Speichert..." : "Speichern"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
