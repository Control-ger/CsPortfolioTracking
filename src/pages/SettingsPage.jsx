import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchFeeSettings, updateFeeSettings } from "@/lib/apiClient";

const DEFAULT_FORM = {
  fxFeePercent: "0",
  sellerFeePercent: "2",
  withdrawalFeePercent: "2.5",
  depositFeePercent: "2.8",
  depositFeeFixedEur: "0.26",
};

function toInputValue(value, fallback) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return String(value);
}

export function SettingsPage() {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [source, setSource] = useState("defaults");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    const loadFeeSettings = async () => {
      try {
        setLoading(true);
        const response = await fetchFeeSettings();
        const data = response?.data || {};

        setForm({
          fxFeePercent: toInputValue(data.fxFeePercent, DEFAULT_FORM.fxFeePercent),
          sellerFeePercent: toInputValue(data.sellerFeePercent, DEFAULT_FORM.sellerFeePercent),
          withdrawalFeePercent: toInputValue(
            data.withdrawalFeePercent,
            DEFAULT_FORM.withdrawalFeePercent,
          ),
          depositFeePercent: toInputValue(data.depositFeePercent, DEFAULT_FORM.depositFeePercent),
          depositFeeFixedEur: toInputValue(
            data.depositFeeFixedEur,
            DEFAULT_FORM.depositFeeFixedEur,
          ),
        });
        setSource(data.source === "db" ? "db" : "defaults");
        setError("");
      } catch (loadError) {
        setError(loadError.message || "Fee-Settings konnten nicht geladen werden.");
      } finally {
        setLoading(false);
      }
    };

    void loadFeeSettings();
  }, []);

  const handleChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
    setSuccess("");
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError("");

      const payload = {
        fxFeePercent: Number(form.fxFeePercent),
        sellerFeePercent: Number(form.sellerFeePercent),
        withdrawalFeePercent: Number(form.withdrawalFeePercent),
        depositFeePercent: Number(form.depositFeePercent),
        depositFeeFixedEur: Number(form.depositFeeFixedEur),
      };

      const response = await updateFeeSettings(payload);
      const saved = response?.data || payload;

      setForm({
        fxFeePercent: toInputValue(saved.fxFeePercent, DEFAULT_FORM.fxFeePercent),
        sellerFeePercent: toInputValue(saved.sellerFeePercent, DEFAULT_FORM.sellerFeePercent),
        withdrawalFeePercent: toInputValue(
          saved.withdrawalFeePercent,
          DEFAULT_FORM.withdrawalFeePercent,
        ),
        depositFeePercent: toInputValue(saved.depositFeePercent, DEFAULT_FORM.depositFeePercent),
        depositFeeFixedEur: toInputValue(saved.depositFeeFixedEur, DEFAULT_FORM.depositFeeFixedEur),
      });
      setSource("db");
      setSuccess("Fee-Settings gespeichert.");
    } catch (saveError) {
      setError(saveError.message || "Fee-Settings konnten nicht gespeichert werden.");
      setSuccess("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-8 font-sans text-foreground">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-primary">Einstellungen</h1>
            <p className="text-muted-foreground">
              Fee-Konfiguration fuer Netto-ROI und Break-even.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        {loading ? (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-6 w-28" />
                <Skeleton className="h-6 w-28" />
              </div>
              <Skeleton className="h-4 w-96" />
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
              <div className="flex gap-2">
                <Skeleton className="h-10 w-28" />
                <Skeleton className="h-10 w-44" />
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Gebuehren</CardTitle>
              <Badge variant="outline">Quelle: {source === "db" ? "DB" : "Defaults"}</Badge>
            </div>
            <CardDescription>
              Withdrawal Fee ist standardmaessig auf 2.5% gesetzt und frei anpassbar.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}
            {success ? (
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
                {success}
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase text-muted-foreground" htmlFor="fxFeePercent">
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
                  disabled={loading || saving}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase text-muted-foreground" htmlFor="sellerFeePercent">
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
                  disabled={loading || saving}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase text-muted-foreground" htmlFor="withdrawalFeePercent">
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
                  disabled={loading || saving}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase text-muted-foreground" htmlFor="depositFeePercent">
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
                  disabled={loading || saving}
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-semibold uppercase text-muted-foreground" htmlFor="depositFeeFixedEur">
                  Deposit Fee Fixed (EUR)
                </label>
                <Input
                  id="depositFeeFixedEur"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.depositFeeFixedEur}
                  onChange={handleChange("depositFeeFixedEur")}
                  disabled={loading || saving}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleSave} disabled={loading || saving}>
                {saving ? "Speichert..." : "Speichern"}
              </Button>
              <Button asChild variant="outline">
                <Link to="/">Zurueck zum Portfolio</Link>
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Funding Mode wird pro Investment gesetzt (`cash_in` oder `wallet_funded`) und in
              der Netto-Berechnung beruecksichtigt.
            </p>
          </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
