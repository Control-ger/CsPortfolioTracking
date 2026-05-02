export const PriceSourceBadge = ({
  priceSource,
  compact = false,
  className = "",
}) => {
  if (priceSource !== "steam") {
    return null;
  }

  return (
    <span
      className={`inline-flex items-center rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 ${className}`.trim()}
      title="Steam-Fallbackpreis"
    >
      {compact ? "Steam" : "Steam Fallback"}
    </span>
  );
};
