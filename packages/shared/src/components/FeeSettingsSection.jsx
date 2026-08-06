import { Skeleton } from "@shared/components/ui/skeleton";
import { StatusPill } from "@shared/components/ui/status-pill";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
} from "@shared/components/ui/settings-card";

const FEE_FIELDS = [
  {
    field: "sellerFeePercent",
    label: "Seller-Gebühr",
    unit: "%",
    hint: "Marktplatz-Anteil beim Verkauf",
  },
  {
    field: "fxFeePercent",
    label: "FX-Gebühr",
    unit: "%",
    hint: "Umrechnung USD → Anzeigewährung",
  },
  {
    field: "withdrawalFeePercent",
    label: "Auszahlung",
    unit: "%",
    hint: "Beim Abheben auf dein Konto",
  },
  {
    field: "depositFeePercent",
    label: "Einzahlung",
    unit: "%",
    hint: "Prozentualer Anteil",
  },
  {
    field: "depositFeeFixedEur",
    label: "Einzahlung fix",
    unit: "€",
    hint: "Fixbetrag je Einzahlung",
  },
];

const percent = (value) => {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(0, parsed) / 100 : 0;
};

/**
 * Fees have no save button of their own — they belong to the page-level dirty
 * set and are saved from the header ("Änderungen speichern"), matching the
 * design where the whole panel commits at once.
 */
export function FeeSettingsSection({ form, source, loading, saving, error, success, handleChange }) {
  if (loading) {
    return (
      <SettingsCard>
        <SettingsCardHeader title="Gebühren" description="Wird geladen …" />
        <SettingsCardBody className="grid gap-3 sm:grid-cols-3">
          {[1, 2, 3, 4, 5].map((entry) => (
            <div key={entry} className="space-y-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </SettingsCardBody>
      </SettingsCard>
    );
  }

  // Mirrors FeeCalculationService::calculateNetProceeds — seller fee first, the
  // withdrawal fee on what is left. The FX and deposit fees are acquisition-side
  // and deliberately not part of this preview.
  const netOnHundred = 100 * (1 - percent(form.sellerFeePercent)) * (1 - percent(form.withdrawalFeePercent));

  return (
    <SettingsCard id="settings-section-fees">
      <SettingsCardHeader
        title="Gebühren"
        description="Fließen in Nettoerlös, Break-even und Rendite ein."
        action={
          <StatusPill tone={source === "db" ? "success" : "muted"} dot={source === "db"}>
            {source === "db" ? "Gespeichert" : "Standardwerte"}
          </StatusPill>
        }
      />
      {error ? (
        <div className="border-b border-danger/25 bg-danger/10 px-5 py-3 text-[12px] text-danger">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="border-b border-success/25 bg-success/10 px-5 py-3 text-[12px] text-success">
          {success}
        </div>
      ) : null}
      <SettingsCardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FEE_FIELDS.map((entry) => (
          <label key={entry.field} className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
              {entry.label}
            </span>
            <span className="relative block">
              <input
                id={entry.field}
                type="number"
                min="0"
                max={entry.unit === "%" ? "100" : undefined}
                step="0.01"
                value={form[entry.field]}
                onChange={handleChange(entry.field)}
                disabled={saving}
                className="h-10 w-full rounded-[10px] border border-border-strong bg-background pl-3 pr-9 text-sm tabular-nums outline-none transition-colors focus:border-foreground/40 disabled:opacity-50"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                {entry.unit}
              </span>
            </span>
            <span className="text-[11px] text-muted-foreground">{entry.hint}</span>
          </label>
        ))}

        <div className="flex flex-wrap items-center gap-2.5 rounded-[12px] border border-border-soft bg-surface-1 px-3.5 py-3 sm:col-span-2 lg:col-span-3">
          <span className="text-[12px] text-muted-foreground">
            Beispiel: Verkauf für 100,00 € ergibt netto
          </span>
          <span className="text-[13px] font-bold tabular-nums text-success">
            {netOnHundred.toFixed(2).replace(".", ",")} €
          </span>
          <span className="text-[11px] text-muted-foreground">
            nach Seller- und Auszahlungsgebühr
          </span>
        </div>
      </SettingsCardBody>
    </SettingsCard>
  );
}
