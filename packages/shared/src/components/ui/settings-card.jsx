import * as React from "react";

import { cn } from "../../lib/utils.js";

/**
 * Building blocks for the Einstellungen panel.
 *
 * The design drops the generic `Card` for settings: a settings card is a single
 * bordered block whose header is separated by a rule and whose body is either a
 * padded area or a stack of full-bleed rows. Rows carry their own divider, so
 * the card itself clips (`overflow-hidden`) and the last row's border falls
 * outside the rounded edge.
 *
 * Radii are explicit — this project sets `--radius` to 14px, so `rounded-xl`
 * is 18px and cannot express the design's 9/10/12/14px steps.
 */
function SettingsCard({ className, children, ...props }) {
  return (
    <section
      className={cn("overflow-hidden rounded-[18px] border border-border bg-card", className)}
      {...props}
    >
      {children}
    </section>
  );
}

function SettingsCardHeader({ title, description, action, className, ...props }) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b border-border px-5 py-4",
        className,
      )}
      {...props}
    >
      <div className="min-w-0">
        <h4 className="text-[15px] font-bold leading-tight text-foreground">{title}</h4>
        {description ? (
          <p className="mt-1 text-[12px] leading-[1.55] text-pretty text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

/** Padded body for cards that hold tiles or a form grid rather than rows. */
function SettingsCardBody({ className, children, ...props }) {
  return (
    <div className={cn("px-5 py-[18px]", className)} {...props}>
      {children}
    </div>
  );
}

/**
 * Full-bleed label/control row. `divider` is off for the last row of a card,
 * where the card border already closes the stack.
 */
function SettingsRow({ title, description, children, divider = true, className, ...props }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 px-5 py-3.5",
        divider ? "border-b border-border-soft" : "",
        className,
      )}
      {...props}
    >
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-foreground">{title}</p>
        {description ? (
          <p className="mt-[3px] text-[11px] leading-[1.5] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2.5">{children}</div> : null}
    </div>
  );
}

/**
 * Selectable option tile (theme mode, window buttons, price source). `swatch`
 * paints the 46px preview strip above the label.
 */
function SettingsTile({ active = false, label, hint, swatch, className, ...props }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "rounded-[14px] border p-3 text-left transition-colors",
        active
          ? "border-success/45 bg-success/10"
          : "border-border bg-background hover:border-border-strong",
        className,
      )}
      {...props}
    >
      {swatch ? (
        <span
          className="block h-[46px] rounded-[9px] border border-border"
          style={{ background: swatch }}
        />
      ) : null}
      <span className={cn("block text-[13px] font-bold text-foreground", swatch ? "mt-2.5" : "")}>
        {label}
      </span>
      {hint ? <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span> : null}
    </button>
  );
}

/** Recessed strip used under tiles for the "currently active / detected" line. */
function SettingsNote({ className, children, ...props }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-[12px] border border-border-soft bg-surface-1 px-3.5 py-2.5 text-[11px] text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

const KEY_STATE_TONE = {
  success: "text-success",
  warn: "text-warn",
  danger: "text-danger",
  muted: "text-muted-foreground",
};

/**
 * Credential row: fixed name column, elastic value column, actions.
 *
 * The name column is a fixed 170px so the inputs of stacked rows line up —
 * "CSFloat", "SkinBaron" and "Server-Host" read as one table, which is the
 * point of the design collapsing three separate cards into one.
 */
function SettingsKeyRow({ name, state, stateTone = "muted", children, divider = true, className, ...props }) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 items-center gap-3 px-5 py-3.5 sm:grid-cols-[170px_minmax(0,1fr)] lg:grid-cols-[170px_minmax(0,1fr)_auto]",
        divider ? "border-b border-border-soft" : "",
        className,
      )}
      {...props}
    >
      <div className="min-w-0">
        <p className="text-[13px] font-bold text-foreground">{name}</p>
        {state ? (
          <p className={cn("mt-[3px] text-[11px] font-semibold", KEY_STATE_TONE[stateTone] ?? KEY_STATE_TONE.muted)}>
            {state}
          </p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** Monospaced credential input used inside `SettingsKeyRow`. */
function SettingsKeyInput({ className, ...props }) {
  return (
    <input
      className={cn(
        "h-[38px] w-full min-w-0 rounded-[10px] border border-border bg-background px-3 font-mono text-[12px] tracking-[0.04em] outline-none transition-colors focus:border-border-strong disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

/** Tinted inline banner (info hint, error, success) inside a settings card. */
const BANNER_TONE = {
  info: "border-info/25 bg-info/8 text-muted-foreground",
  success: "border-success/30 bg-success/10 text-success",
  warn: "border-warn/30 bg-warn/10 text-warn",
  danger: "border-danger/30 bg-danger/10 text-danger",
};

function SettingsBanner({ tone = "info", icon, className, children, ...props }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 border-b px-5 py-3 text-[11.5px] leading-[1.55] text-pretty",
        BANNER_TONE[tone] ?? BANNER_TONE.info,
        className,
      )}
      {...props}
    >
      {icon ? <span className="mt-px shrink-0">{icon}</span> : null}
      <span className="min-w-0">{children}</span>
    </div>
  );
}

export {
  SettingsCard,
  SettingsCardHeader,
  SettingsCardBody,
  SettingsRow,
  SettingsTile,
  SettingsNote,
  SettingsBanner,
  SettingsKeyRow,
  SettingsKeyInput,
};
