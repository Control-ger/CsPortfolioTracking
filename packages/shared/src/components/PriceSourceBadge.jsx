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
    ? "border-sky-300 bg-sky-50 text-sky-700"
    : "border-emerald-300 bg-emerald-50 text-emerald-700";
  const title = isSteam ? "Steam-Preisquelle" : "CSFloat-Preisquelle";
  const label = compact
    ? (isSteam ? "Steam" : "CSFloat")
    : (isSteam ? "Steam Preis" : "CSFloat Preis");

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styleClass} ${className}`.trim()}
      title={title}
    >
      {label}
    </span>
  );
};
