import * as React from "react";

import { cn } from "../../lib/utils.js";

/**
 * 44x25 track switch from the Einstellungen design — the single on/off control
 * for every boolean setting, replacing the "Aktivieren"/"Deaktivieren" buttons.
 *
 * The knob is `card` rather than a fixed dark value so it stays legible on the
 * green track in both themes: dark `--card` is exactly the design's
 * oklch(17% .011 260), light `--card` is white on the darker light-mode success.
 */
const Switch = React.forwardRef(
  ({ checked = false, onCheckedChange, disabled = false, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        "relative h-[25px] w-11 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-transparent bg-success" : "border-border-strong bg-surface-2",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "absolute top-[3px] size-[17px] rounded-full transition-[left] duration-150",
          checked ? "left-[22px] bg-card" : "left-[3px] bg-muted-foreground",
        )}
      />
    </button>
  ),
);
Switch.displayName = "Switch";

export { Switch };
