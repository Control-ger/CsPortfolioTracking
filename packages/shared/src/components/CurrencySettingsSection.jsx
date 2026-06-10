import { Skeleton } from "@shared/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@shared/components/ui/card";
import { Input } from "@shared/components/ui/input";
import { DollarSign } from "lucide-react";
import { formatExchangeRate } from "@shared/lib/settingsHelpers";

export function CurrencySettingsSection({
  currency,
  currencies,
  setCurrency,
  exchangeRates,
  ratesLoading,
  popularCurrencyCodes = [],
  currencySearchTerm,
  setCurrencySearchTerm,
}) {
  const currencyEntries = Object.entries(currencies);
  const popularRankByCode = new Map(
    popularCurrencyCodes.map((code, index) => [String(code || "").toUpperCase(), index]),
  );
  const sortedCurrencyEntries = [...currencyEntries].sort(([leftCode], [rightCode]) => {
    const leftRank = popularRankByCode.has(leftCode) ? Number(popularRankByCode.get(leftCode)) : Number.POSITIVE_INFINITY;
    const rightRank = popularRankByCode.has(rightCode) ? Number(popularRankByCode.get(rightCode)) : Number.POSITIVE_INFINITY;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    if (leftCode === currency) {
      return -1;
    }
    if (rightCode === currency) {
      return 1;
    }
    return leftCode.localeCompare(rightCode);
  });
  const normalizedCurrencySearchTerm = String(currencySearchTerm || "").trim().toLowerCase();
  const filteredCurrencyEntries = (() => {
    if (!normalizedCurrencySearchTerm) {
      return sortedCurrencyEntries;
    }

    return sortedCurrencyEntries.filter(([code, info]) => {
      const haystack = [
        code,
        info?.name,
        info?.regionName,
        info?.symbol,
      ]
        .map((entry) => String(entry || "").toLowerCase())
        .join(" ");
      return haystack.includes(normalizedCurrencySearchTerm);
    });
  })();
  const popularCurrencyEntries = popularCurrencyCodes
    .map((code) => {
      const normalizedCode = String(code || "").toUpperCase();
      return [normalizedCode, currencies[normalizedCode]];
    })
    .filter((entry) => Boolean(entry[1]))
    .slice(0, 8);
  const currentCurrencyInfo = currencies[currency] || null;
  const currentCurrencyRate = Number(exchangeRates[currency]);
  const hasCurrentCurrencyRate = Number.isFinite(currentCurrencyRate) && currentCurrencyRate > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <DollarSign className="h-5 w-5" />
          <CardTitle>Waehrung</CardTitle>
        </div>
        <CardDescription>
          Waehle deine bevorzugte Waehrung fuer Preisanzeigen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <label className="text-sm font-medium text-foreground">
            Anzeige-Waehrung
          </label>
          {popularCurrencyEntries.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Beliebt bei Nutzern (anonym)
              </p>
              <div className="flex flex-wrap gap-2">
                {popularCurrencyEntries.map(([code, info]) => (
                  <button
                    key={`popular-${code}`}
                    type="button"
                    onClick={() => setCurrency(code)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                      currency === code
                        ? "border-primary/40 bg-primary/12 text-foreground"
                        : "border-border/70 text-muted-foreground hover:bg-accent/55 hover:text-foreground"
                    }`}
                  >
                    <span>{info.flag}</span>
                    <span>{code}</span>
                    {info.hasDistinctSymbol ? <span className="text-muted-foreground">({info.symbol})</span> : null}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            <Input
              value={currencySearchTerm}
              onChange={(event) => setCurrencySearchTerm(event.target.value)}
              placeholder="Waehrung suchen (Code, Name oder Land)"
              className="h-10"
            />
            <p className="text-[11px] text-muted-foreground">
              {filteredCurrencyEntries.length} von {currencyEntries.length} Waehrungen sichtbar
            </p>
          </div>
          <div className="max-h-80 overflow-y-auto rounded-lg border border-border/70 p-2">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {filteredCurrencyEntries.map(([code, info]) => (
                <button
                  key={code}
                  onClick={() => setCurrency(code)}
                  className={`flex min-h-[108px] flex-col items-center justify-center gap-1 rounded-xl border p-3 transition-colors ${
                    currency === code
                      ? "border-primary/40 bg-primary/12 shadow-none dark:shadow-[0_10px_22px_rgba(255,255,255,0.12)]"
                      : "border-border bg-transparent hover:bg-accent/55 dark:border-border/75 dark:bg-card/65"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-base leading-none">{info.flag}</span>
                    {info.hasDistinctSymbol ? (
                      <span className="text-lg font-bold leading-none">{info.symbol}</span>
                    ) : null}
                  </div>
                  <span className="text-xs font-semibold">{info.code}</span>
                  <span className="line-clamp-2 text-center text-[10px] text-muted-foreground">{info.name}</span>
                  <span className="line-clamp-1 text-center text-[10px] text-muted-foreground/80">
                    {info.regionName || info.regionCode || "Global"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {ratesLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-transparent p-3 text-sm dark:border-border/70 dark:bg-card/65">
            <p className="font-medium text-foreground">Aktueller Wechselkurs</p>
            <div className="mt-2 rounded-md border border-border/70 bg-background/35 p-2 text-xs text-muted-foreground">
              <div className="font-semibold text-foreground">
                {currentCurrencyInfo?.flag || "🌍"} {currency}
                {currentCurrencyInfo?.hasDistinctSymbol ? ` (${currentCurrencyInfo.symbol})` : ""}
              </div>
              <div className="mt-1">
                {hasCurrentCurrencyRate ? `1 EUR = ${formatExchangeRate(currentCurrencyRate)} ${currency}` : "Kein Wechselkurs verfuegbar"}
              </div>
              {hasCurrentCurrencyRate ? (
                <div className="mt-1">1 {currency} = {formatExchangeRate(1 / currentCurrencyRate)} EUR</div>
              ) : null}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              Kurse werden taeglich aktualisiert.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
