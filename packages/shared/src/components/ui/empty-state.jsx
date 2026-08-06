import * as React from "react";

import { cn } from "../../lib/utils.js";

/**
 * "There is nothing here" for a panel or a card body.
 *
 * Deliberately *not* the same thing as `GridTableEmpty` or `InspectorEmpty`:
 * those two fill a known slot inside their own container and must stay flush
 * with it. This one is the standalone block — a chart with no history, a groups
 * panel before the first group, a search before the first query.
 *
 * `title` is the state, `description` is what to do about it, and `action` is
 * the button that does it. An empty state without a next step is a dead end, so
 * pass `action` whenever one exists.
 */
function EmptyState({ icon, title, description, action, className, ...props }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-10 text-center",
        className,
      )}
      {...props}
    >
      {icon ? <span className="mb-1 text-muted-foreground" aria-hidden>{icon}</span> : null}
      {title ? <p className="text-[13px] font-bold text-foreground">{title}</p> : null}
      {description ? (
        <p className="max-w-[46ch] text-[12px] leading-[1.55] text-pretty text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export { EmptyState };
