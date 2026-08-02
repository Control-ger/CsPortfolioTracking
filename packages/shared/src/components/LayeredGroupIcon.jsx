import React from "react";

/**
 * Stacked thumbnail for a portfolio group: the two highest-weighted clusters
 * fanned out. Shared by the inventory list and the group management card so a
 * group looks identical wherever it is rendered.
 *
 * `visuals` are `group.topVisuals` entries from buildPortfolioGroupSummaries.
 * `size` picks between the inventory list ("md") and the compact card ("sm").
 */
export function LayeredGroupIcon({ visuals = [], fallbackLabel, size = "md" }) {
  const items = Array.isArray(visuals) ? visuals.slice(0, 2) : [];
  const isCompact = size === "sm";
  const frameClass = isCompact ? "h-9 w-[3.25rem]" : "h-12 w-[4.25rem]";
  const tileClass = isCompact ? "h-9 w-9" : "h-12 w-12";
  const secondOffsetClass = isCompact ? "left-[0.8rem]" : "left-[1.05rem]";

  return (
    <div className={`relative shrink-0 ${frameClass}`}>
      {items.length === 0 ? (
        <div
          className={`flex items-center justify-center rounded-xl border border-border/70 bg-card/70 text-[11px] font-semibold text-muted-foreground ${tileClass}`}
        >
          {String(fallbackLabel || "Group").slice(0, 2).toUpperCase()}
        </div>
      ) : null}
      {items.map((item, index) => {
        const offsetClass =
          index === 0
            ? "left-0 top-0 z-20 rotate-[-3deg]"
            : `${secondOffsetClass} top-[0.1rem] z-10 rotate-[4deg]`;
        const cardToneClass = index === 0 ? "bg-card/95 shadow-sm" : "bg-card shadow-md";
        return (
          <div
            key={item.id || `${item.name}-${index}`}
            className={`absolute ${offsetClass} flex items-center justify-center overflow-hidden rounded-xl border border-border/80 ${cardToneClass} p-1 transition-transform ${tileClass}`}
          >
            {item.imageUrl ? (
              <img
                src={item.imageUrl}
                alt={item.name || "Group visual"}
                className="h-full w-full object-contain"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[11px] font-semibold text-muted-foreground">
                {String(item.name || fallbackLabel || "Group").slice(0, 2).toUpperCase()}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default LayeredGroupIcon;
