import * as React from "react";

import { cn } from "../../lib/utils.js";
import { toneText, toneTintSurface } from "./tone.js";

/**
 * The tinted inline box: hairline border, 10% wash, optional leading icon.
 *
 * This idiom was hand-built in roughly seventy places — "Preise sind älter als
 * 24 Stunden", "CSFloat-Key fehlt", "Import erfolgreich" — with the wash
 * ranging from /7 to /18 and the border from /25 to /40 depending on who wrote
 * it. One component, one set of values.
 *
 * Body text is `text-foreground`, not the tone: a callout carries a sentence,
 * and a sentence set in warn-amber on a warn wash is decorative rather than
 * readable. The tone shows in the border, the wash and the icon. Use `title`
 * when the message needs a short coloured headline above the prose.
 */
function Callout({ tone = "info", icon, title, className, children, ...props }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-[12px] border px-3.5 py-3 text-[12px] leading-[1.55] text-pretty text-foreground",
        toneTintSurface(tone),
        className,
      )}
      {...props}
    >
      {icon ? (
        <span className={cn("mt-px shrink-0", toneText(tone, "muted"))} aria-hidden>
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        {title ? (
          <p className={cn("mb-0.5 text-[12px] font-bold", toneText(tone, "muted"))}>{title}</p>
        ) : null}
        {children}
      </div>
    </div>
  );
}

export { Callout };
