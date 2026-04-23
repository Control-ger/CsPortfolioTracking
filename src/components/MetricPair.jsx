import { cn } from "@/lib/utils";

function MetricLine({ label, value, valueClassName = "", labelClassName = "" }) {
  return (
    <div className="space-y-0.5">
      <div className={cn("text-[10px] uppercase text-muted-foreground", labelClassName)}>
        {label}
      </div>
      <div className={cn("text-xs font-semibold", valueClassName)}>{value}</div>
    </div>
  );
}

export function MetricPairBlock({
  title,
  grossLabel = "Brutto",
  grossValue,
  grossValueClassName = "",
  netLabel = "Netto",
  netValue,
  netValueClassName = "",
  note,
  className = "",
}) {
  return (
    <div className={cn("rounded-md border p-2 sm:p-3", className)}>
      {title ? <p className="text-[10px] uppercase text-muted-foreground">{title}</p> : null}
      <div className="mt-1 space-y-2">
        <MetricLine label={grossLabel} value={grossValue} valueClassName={cn("text-xs sm:text-sm font-bold", grossValueClassName)} />
        <MetricLine label={netLabel} value={netValue} valueClassName={cn("text-[11px] sm:text-xs font-semibold", netValueClassName)} />
        {note ? <p className="pt-1 text-[10px] text-muted-foreground">{note}</p> : null}
      </div>
    </div>
  );
}

export function MetricPairInline({
  grossLabel = "Brutto",
  grossValue,
  grossValueClassName = "",
  netLabel = "Netto",
  netValue,
  netValueClassName = "",
  className = "",
  align = "end",
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", align === "end" ? "items-end" : "items-start", className)}>
      <div className="text-[10px] uppercase text-muted-foreground">{grossLabel}</div>
      <div className={cn("text-sm font-bold", grossValueClassName)}>{grossValue}</div>
      <div className="mt-1 text-[10px] uppercase text-muted-foreground">{netLabel}</div>
      <div className={cn("text-[11px] font-semibold", netValueClassName)}>{netValue}</div>
    </div>
  );
}

