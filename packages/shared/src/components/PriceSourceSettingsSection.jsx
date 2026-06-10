import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@shared/components/ui/card";
import { Button } from "@shared/components/ui/button";
import { Badge } from "@shared/components/ui/badge";
import { LineChart } from "lucide-react";

export function PriceSourceSettingsSection({
  priceSourceMode,
  priceSourceSaving,
  priceSourceError,
  priceSourceSuccess,
  onPriceSourceChange,
  onPriceSourceSave,
}) {
  const priceSourceLabel = priceSourceMode === "csfloat"
    ? "Nur CSFloat"
    : priceSourceMode === "steam"
      ? "Nur Steam"
      : "Auto (CSFloat bevorzugt)";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <LineChart className="h-5 w-5" />
          <CardTitle>Live-Preisquelle</CardTitle>
          <Badge variant="outline" className="ml-auto">
            {priceSourceLabel}
          </Badge>
        </div>
        <CardDescription>
          Lege fest, welche Quelle fuer Live-Preise bevorzugt wird.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {priceSourceError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {priceSourceError}
          </div>
        ) : null}
        {priceSourceSuccess ? (
          <div className="rounded-xl border border-emerald-400/35 bg-emerald-500/12 p-3 text-sm text-emerald-300">
            {priceSourceSuccess}
          </div>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-3">
          {[
            { value: "auto", label: "Auto", hint: "CSFloat zuerst, Steam als Fallback" },
            { value: "csfloat", label: "CSFloat", hint: "Nur CSFloat bevorzugen" },
            { value: "steam", label: "Steam", hint: "Nur Steam bevorzugen" },
          ].map((option) => (
            <button
              key={option.value}
              onClick={() => onPriceSourceChange(option.value)}
              className={`rounded-xl border p-3 text-left transition-colors ${
                priceSourceMode === option.value
                  ? "border-primary/40 bg-primary/12 shadow-none dark:shadow-[0_10px_22px_rgba(255,255,255,0.12)]"
                  : "border-border bg-transparent hover:bg-accent/55 dark:border-border/75 dark:bg-card/65"
              }`}
            >
              <p className="text-sm font-semibold text-foreground">{option.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{option.hint}</p>
            </button>
          ))}
        </div>

        <div className="flex justify-end">
          <Button
            disabled={priceSourceSaving}
            onClick={onPriceSourceSave}
          >
            {priceSourceSaving ? "Speichert..." : "Praeferenz speichern"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
