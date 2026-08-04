/* eslint-disable react-refresh/only-export-components */
import * as React from "react";
import { cva } from "class-variance-authority";

import { cn } from "../../lib/utils.js";

// Chevron drawn as a data URI so the control keeps one appearance across
// platforms — the native select arrow is what `appearance: none` removes.
// The stroke is a fixed mid grey (per the design): a data URI cannot read CSS
// variables, and this value stays legible against both themes.
const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888f9c' stroke-width='2.4' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

/**
 * Native <select> styled to the design system.
 *
 * `line-height` is pinned to the control height minus its borders because
 * Chrome vertically centres the closed-state label off the line box, not the
 * box — without it the text sits high in the taller sizes.
 */
const nativeSelectVariants = cva(
  "appearance-none rounded-[5px] border border-border bg-background font-semibold text-foreground outline-none transition-colors cursor-pointer focus:border-[color-mix(in_oklab,var(--muted-foreground)_40%,var(--border))] disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      size: {
        sm: "h-[30px] pl-2 text-xs leading-[28px]",
        default: "h-[38px] pl-2.5 text-xs leading-[36px]",
        lg: "h-[42px] pl-3 text-sm leading-[40px]",
      },
    },
    defaultVariants: { size: "default" },
  },
);

const NativeSelect = React.forwardRef(({ className, size, style, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(nativeSelectVariants({ size }), "pr-8", className)}
    style={{
      backgroundImage: CHEVRON,
      backgroundRepeat: "no-repeat",
      backgroundPosition: "right 11px center",
      ...style,
    }}
    {...props}
  />
));
NativeSelect.displayName = "NativeSelect";

export { NativeSelect, nativeSelectVariants };
