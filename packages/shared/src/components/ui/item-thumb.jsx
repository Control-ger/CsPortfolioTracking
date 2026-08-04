import * as React from "react";

import { cn } from "../../lib/utils.js";

const SIZES = {
  xs: "size-[28px] rounded-[7px]",
  sm: "size-[30px] rounded-lg",
  md: "size-9 rounded-[9px]",
  lg: "size-10 rounded-[10px]",
  xl: "size-14 rounded-xl",
};

/**
 * Item artwork with the design system's diagonal-stripe placeholder.
 *
 * The placeholder is the same `--stripe` hatch the design uses for every
 * unresolved image, so a missing icon reads as "no artwork yet" rather than as
 * a broken tile. Falls back to the hatch both when `src` is absent and when the
 * image fails to load.
 */
function ItemThumb({ src, alt = "", size = "md", bordered = true, className, ...props }) {
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    setFailed(false);
  }, [src]);

  const showImage = Boolean(src) && !failed;

  return (
    <div
      className={cn(
        "flex-none overflow-hidden",
        SIZES[size] ?? SIZES.md,
        bordered && "border border-border",
        !showImage &&
          "bg-[repeating-linear-gradient(135deg,var(--stripe)_0_5px,transparent_5px_10px)]",
        className,
      )}
      {...props}
    >
      {showImage ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="size-full object-contain"
        />
      ) : null}
    </div>
  );
}

export { ItemThumb };
