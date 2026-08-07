import * as React from "react";

import { cn } from "../../lib/utils.js";
import { Button } from "./button.jsx";

/**
 * Round icon button for the rails and headers — notification bell, avatar,
 * updates feed — with the unread counter that always sits on it.
 *
 * The button and the counter were written out together at six call sites and
 * had already drifted: five used `h-11 w-11`, one `h-10 w-10`. They are one
 * primitive rather than two because the badge only ever appears inside this
 * button; positioning it (`absolute -right-1 -top-1`) depends on the round
 * frame it is anchored to.
 *
 * A count of zero renders nothing: an unread badge showing "0" is noise, and
 * every call site was already guarding for it by hand.
 */
const IconCircleButton = React.forwardRef(function IconCircleButton(
  { count, size = "default", className, children, ...props },
  ref,
) {
  const numeric = Number(count);
  const showCount = Number.isFinite(numeric) && numeric > 0;

  return (
    <Button
      ref={ref}
      variant="outline"
      size="icon"
      className={cn(
        "relative rounded-full border-border/80 bg-card/75 p-0",
        size === "sm" ? "h-10 w-10" : "h-11 w-11",
        className,
      )}
      {...props}
    >
      {children}
      {showCount ? (
        <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
          {numeric > 99 ? "99+" : numeric}
        </span>
      ) : null}
    </Button>
  );
});

export { IconCircleButton };
