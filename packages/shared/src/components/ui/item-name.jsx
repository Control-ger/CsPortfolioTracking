import { parseItemName } from "../../lib/itemName.js";
import { cn } from "../../lib/utils.js";

/**
 * Item name with the variant prefix and the wear pulled out into chips.
 *
 * The name stays the flexible part and truncates; the chips are `shrink-0`, so
 * on a narrow row the skin name gives way rather than the wear disappearing —
 * the wear is the shorter and the more distinguishing of the two, since a
 * portfolio routinely holds the same skin in several conditions.
 *
 * `title` carries the untouched canonical name, so nothing is actually lost.
 */
const PREFIX_TONES = {
  souvenir: "bg-warn/18 text-warn",
  stattrak: "bg-danger/18 text-danger",
  star: "bg-surface-2 text-foreground",
};

export function ItemName({
  name,
  className,
  nameClassName,
  showWear = true,
  // Only where a category chip already states the kind — otherwise
  // "Boom Blast (Glitter)" loses the one word that identifies what it is.
  dropKindPrefix = false,
}) {
  const { base, short, prefixes, wear, wearShort } = parseItemName(name);
  const label = dropKindPrefix ? short : base;

  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)} title={name || undefined}>
      {prefixes.map((prefix) => (
        <span
          key={prefix.key}
          aria-label={prefix.title}
          className={cn(
            "inline-flex h-[17px] shrink-0 items-center rounded-[5px] px-1.5 text-[9px] font-extrabold leading-none",
            PREFIX_TONES[prefix.key] ?? "bg-surface-2 text-muted-foreground",
          )}
        >
          {prefix.label}
        </span>
      ))}
      <span className={cn("min-w-0 truncate", nameClassName)}>{label}</span>
      {showWear && wearShort ? (
        <span
          aria-label={wear}
          className="inline-flex h-[17px] shrink-0 items-center rounded-[5px] bg-surface-2 px-1.5 text-[9px] font-bold leading-none text-muted-foreground"
        >
          {wearShort}
        </span>
      ) : null}
    </span>
  );
}
