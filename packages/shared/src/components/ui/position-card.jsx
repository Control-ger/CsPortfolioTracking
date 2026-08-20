import { ItemThumb } from "./item-thumb.jsx";
import { ItemName } from "./item-name.jsx";
import { cn } from "../../lib/utils.js";
import { translate } from "../../lib/i18n/index.js";

/**
 * Tappable inventory position, the mobile counterpart of a `GridTable` row.
 *
 * Deliberately not `ItemListRow`: that one is the watchlist/search shape (thumb,
 * name, price, trend arrow) and is shared by three surfaces. The inventory card
 * carries different information — the meta chips and the ROI pill — and folding
 * both into one component would mean a prop per screen.
 *
 * The whole card is the touch target, so nothing inside it is interactive.
 */
function MetaChip({ children }) {
  if (children === null || children === undefined || children === "") {
    return null;
  }
  return (
    <span className="inline-flex h-[19px] items-center rounded-md bg-surface-1 px-[7px] text-[10px] font-bold text-muted-foreground">
      {children}
    </span>
  );
}

export function PositionCard({
  name,
  imageUrl,
  isGroup = false,
  metaChips = [],
  valueLabel,
  deltaLabel,
  deltaTone = "muted",
  selected = false,
  onClick,
  className,
}) {
  const toneClass =
    deltaTone === "success"
      ? "bg-success/15 text-success"
      : deltaTone === "danger"
        ? "bg-danger/15 text-danger"
        : "bg-surface-2 text-muted-foreground";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-[11px] rounded-2xl border bg-card px-3.5 py-[13px] text-left transition-colors",
        selected ? "border-border-strong" : "border-border",
        className,
      )}
    >
      <ItemThumb src={imageUrl} alt={name} className="size-[38px] shrink-0 rounded-[9px]" />

      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          {isGroup ? (
            <span className="shrink-0 rounded-[5px] bg-info/18 px-1.5 py-px text-[9px] font-extrabold uppercase tracking-[0.04em] text-info">
              {translate("inventory:table.groupBadge")}
            </span>
          ) : null}
          {/* The first meta chip is the category, so a "Sticker | " prefix on
              the name would state the same thing twice on one card. */}
          <ItemName name={name} nameClassName="text-[13.5px] font-bold" dropKindPrefix />
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {metaChips.map((chip, index) => (
            <MetaChip key={`${chip}-${index}`}>{chip}</MetaChip>
          ))}
        </span>
      </span>

      <span className="flex max-w-24 shrink-0 flex-col items-end gap-1">
        <span className="text-[15px] font-extrabold tabular-nums">{valueLabel}</span>
        {deltaLabel ? (
          <span
            className={cn(
              "inline-flex h-[22px] items-center rounded-full px-[7px] text-[10px] font-bold tabular-nums",
              toneClass,
            )}
          >
            {deltaLabel}
          </span>
        ) : null}
      </span>
    </button>
  );
}
