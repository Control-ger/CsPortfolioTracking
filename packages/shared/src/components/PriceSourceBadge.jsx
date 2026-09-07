
import { translate } from "@shared/lib/i18n/index.js";
export const PriceSourceBadge = ({
  priceSource,
  compact = false,
  className = "",
}) => {
  const normalized = String(priceSource || "").trim().toLowerCase();
  const isSteam = normalized === "steam";
  const isCsFloat = normalized === "csfloat";

  if (!isSteam && !isCsFloat) {
    return null;
  }

  const styleClass = isSteam
    ? "border-info/30 bg-info/10 text-info"
    : "border-success/30 bg-success/10 text-success";
  const title = isSteam
    ? translate("inventory:priceSource.steamTitle")
    : translate("inventory:priceSource.csfloatTitle");
  const label = compact
    ? (isSteam ? "Steam" : "CSFloat")
    : (isSteam
        ? translate("inventory:priceSource.steamPrice")
        : translate("inventory:priceSource.csfloatPrice"));

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styleClass} ${className}`.trim()}
      title={title}
    >
      {label}
    </span>
  );
};
