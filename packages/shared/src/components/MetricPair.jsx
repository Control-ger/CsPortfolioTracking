import { useTranslation } from "react-i18next";
import { cn } from "@shared/lib/utils";
import { FieldLabel } from "./ui/data-display.jsx";

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
  grossLabel,
  grossValue,
  grossValueClassName = "",
  netLabel,
  netValue,
  netValueClassName = "",
  note,
  className = "",
}) {
  const { t } = useTranslation("common");
  const gross = grossLabel ?? t("metrics.gross");
  const net = netLabel ?? t("metrics.net");
  return (
    <div className={cn("rounded-xl border border-border/70 bg-card/65 p-2 sm:p-3", className)}>
      {title ? <FieldLabel>{title}</FieldLabel> : null}
      <div className="mt-1 space-y-2">
        <MetricLine label={gross} value={grossValue} valueClassName={cn("text-xs sm:text-sm font-bold", grossValueClassName)} />
        <MetricLine label={net} value={netValue} valueClassName={cn("text-[11px] sm:text-xs font-semibold", netValueClassName)} />
        {note ? <p className="pt-1 text-[10px] text-muted-foreground">{note}</p> : null}
      </div>
    </div>
  );
}

export function MetricPairInline({
  grossLabel,
  grossValue,
  grossValueClassName = "",
  netLabel,
  netValue,
  netValueClassName = "",
  className = "",
  align = "end",
}) {
  const { t } = useTranslation("common");
  const gross = grossLabel ?? t("metrics.gross");
  const net = netLabel ?? t("metrics.net");
  return (
    <div className={cn("flex flex-col gap-0.5", align === "end" ? "items-end" : "items-start", className)}>
      <FieldLabel>{gross}</FieldLabel>
      <div className={cn("text-sm font-bold", grossValueClassName)}>{grossValue}</div>
      <div className="mt-1 text-[10px] uppercase text-muted-foreground">{net}</div>
      <div className={cn("text-[11px] font-semibold", netValueClassName)}>{netValue}</div>
    </div>
  );
}

