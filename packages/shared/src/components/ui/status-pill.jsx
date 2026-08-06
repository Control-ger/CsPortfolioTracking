/* eslint-disable react-refresh/only-export-components */
import * as React from "react";
import { cva } from "class-variance-authority";

import { cn } from "../../lib/utils.js";
import { TONE_TINT, toneFill } from "./tone.js";

/**
 * Rounded status pill with an optional leading dot.
 *
 * Carries a single semantic tone from the shared vocabulary in `tone.js`
 * (success/warn/info/danger/muted). Renders as a <button> when `onClick` is supplied,
 * otherwise as a non-interactive <span> — the design uses both forms in the
 * same row (clickable "80 ohne Einkaufspreis" next to static "0 neue Items").
 */
const statusPillVariants = cva(
  "inline-flex items-center gap-[7px] rounded-full border font-bold whitespace-nowrap transition-colors",
  {
    variants: {
      tone: {
        success: TONE_TINT.success,
        warn: TONE_TINT.warn,
        info: TONE_TINT.info,
        danger: TONE_TINT.danger,
        // Not a tint: the muted pill is an outline, so it recedes next to a
        // coloured one instead of competing with it as a grey wash.
        muted: "border-border bg-transparent text-muted-foreground font-semibold",
      },
      size: {
        sm: "h-[26px] px-2.5 text-[11px]",
        default: "h-8 px-3 text-xs",
      },
      interactive: {
        true: "cursor-pointer",
        false: "",
      },
    },
    compoundVariants: [
      { tone: "success", interactive: true, className: "hover:border-success/60" },
      { tone: "warn", interactive: true, className: "hover:border-warn/60" },
      { tone: "info", interactive: true, className: "hover:border-info/60" },
      { tone: "danger", interactive: true, className: "hover:border-danger/60" },
      { tone: "muted", interactive: true, className: "hover:border-border-strong" },
    ],
    defaultVariants: { tone: "muted", size: "sm", interactive: false },
  },
);

const StatusPill = React.forwardRef(
  ({ className, tone = "muted", size, dot = false, onClick, children, ...props }, ref) => {
    const interactive = typeof onClick === "function";
    const Comp = interactive ? "button" : "span";
    return (
      <Comp
        ref={ref}
        onClick={onClick}
        type={interactive ? "button" : undefined}
        className={cn(statusPillVariants({ tone, size, interactive }), className)}
        {...props}
      >
        {dot ? (
          <span className={cn("size-[6px] shrink-0 rounded-full", toneFill(tone))} aria-hidden />
        ) : null}
        {children}
      </Comp>
    );
  },
);
StatusPill.displayName = "StatusPill";

export { StatusPill, statusPillVariants };
