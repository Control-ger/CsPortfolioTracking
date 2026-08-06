import { Search } from "lucide-react";

import { Skeleton } from "@shared/components/ui/skeleton";
import { StatusPill } from "@shared/components/ui/status-pill";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
} from "@shared/components/ui/settings-card";
import { formatExchangeRate } from "@shared/lib/settingsHelpers";

const FALLBACK_QUICK_CODES = ["EUR", "USD", "GBP", "CHF", "PLN"];

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
  // The current currency is always one of the quick pills, even when it is not
  // in the popularity ranking — otherwise the selected state has nowhere to show.
  // The static tail keeps the row from collapsing to a single pill before the
  // anonymised popularity aggregate has loaded (or when it is empty).
  const quickCodes = [
    currency,
    ...popularCurrencyCodes.map((code) => String(code || "").toUpperCase()),
    ...FALLBACK_QUICK_CODES,
  ].filter((code, index, list) => Boolean(currencies[code]) && list.indexOf(code) === index);
  const quickCurrencyEntries = quickCodes.slice(0, 6).map((code) => [code, currencies[code]]);
  const currentCurrencyInfo = currencies[currency] || null;
  const currentCurrencyRate = Number(exchangeRates[currency]);
  const hasCurrentCurrencyRate = Number.isFinite(currentCurrencyRate) && currentCurrencyRate > 0;
  // Rates are quoted against EUR, but prices are persisted in USD — so the rate
  // worth showing is USD → display currency. For EUR that is the only one that
  // says anything at all ("1 EUR = 1 EUR" is noise).
  const usdPerEur = Number(exchangeRates.USD);
  const usdRate =
    hasCurrentCurrencyRate && Number.isFinite(usdPerEur) && usdPerEur > 0
      ? currentCurrencyRate / usdPerEur
      : null;

  return (
    <SettingsCard id="settings-section-currency">
      <SettingsCardHeader
        title="Währung"
        description="Anzeigewährung. Gespeichert wird weiterhin in USD."
        action={
          ratesLoading ? (
            <Skeleton className="h-[26px] w-44 rounded-full" />
          ) : (
            <StatusPill tone="muted">
              {usdRate
                ? `Kurs 1 USD = ${formatExchangeRate(usdRate)} ${currency}`
                : "Kein Wechselkurs verfügbar"}
            </StatusPill>
          )
        }
      />
      <SettingsCardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2.5">
          {quickCurrencyEntries.map(([code, info]) => {
            const active = currency === code;
            return (
              <button
                key={`quick-${code}`}
                type="button"
                onClick={() => setCurrency(code)}
                className={`inline-flex h-[34px] items-center gap-1.5 rounded-[10px] border px-3.5 text-[13px] font-bold transition-colors ${
                  active
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "border-border-strong bg-transparent text-foreground hover:bg-surface-2"
                }`}
              >
                <span>{info.flag}</span>
                <span>{code}</span>
                {info.hasDistinctSymbol ? (
                  <span className="font-medium opacity-60">{info.symbol}</span>
                ) : null}
              </button>
            );
          })}
        </div>

        <label className="relative block max-w-[380px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={currencySearchTerm}
            onChange={(event) => setCurrencySearchTerm(event.target.value)}
            placeholder="Weitere Währung suchen (Code, Name, Land)"
            className="h-[38px] w-full rounded-[10px] border border-border bg-background pl-[34px] pr-3 text-[13px] outline-none transition-colors focus:border-border-strong"
          />
        </label>

        <div className="max-h-[264px] overflow-y-auto rounded-[12px] border border-border-soft bg-surface-1 p-2">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
            {filteredCurrencyEntries.map(([code, info]) => {
              const active = currency === code;
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => setCurrency(code)}
                  title={`${info.name} · ${info.regionName || info.regionCode || "Global"}`}
                  className={`flex min-w-0 items-center gap-2 rounded-[10px] border px-2.5 py-2 text-left transition-colors ${
                    active
                      ? "border-success/45 bg-success/10"
                      : "border-transparent hover:border-border-strong hover:bg-surface-2"
                  }`}
                >
                  <span className="shrink-0 text-base leading-none">{info.flag}</span>
                  <span className="min-w-0">
                    <span className="block text-[12px] font-bold text-foreground">
                      {code}
                      {info.hasDistinctSymbol ? (
                        <span className="ml-1 font-medium text-muted-foreground">{info.symbol}</span>
                      ) : null}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {info.name}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          {filteredCurrencyEntries.length} von {currencyEntries.length} Währungen sichtbar
          {hasCurrentCurrencyRate && currency !== "EUR" ? (
            <>
              {" · "}1 EUR = {formatExchangeRate(currentCurrencyRate)} {currency}
            </>
          ) : null}
          {currentCurrencyInfo?.regionName ? ` · ${currentCurrencyInfo.regionName}` : ""}
        </p>
      </SettingsCardBody>
    </SettingsCard>
  );
}
