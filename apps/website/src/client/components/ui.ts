/**
 * Shared class names for the control styles the app uses. Kept as plain strings
 * so they compose with layout utilities at the call site.
 *
 * Every control here carries the full state vocabulary: hover, keyboard focus,
 * active and disabled. Reach for one of these instead of hand-rolling a button.
 */

/**
 * Keyboard focus. One accent ring, drawn outside the control so it reads on
 * both the paper and a filled surface. Pointer clicks never show it.
 */
export const focusRing =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * The card and panel surface: one hairline plus a 1px shadow, used everywhere
 * something lifts off the paper. Radii stay in the 12–16px band; pills are for
 * small controls only.
 */
export const surfacePanel = "border border-line bg-surface shadow-xs";

/** Accent pill: the one primary action per view. */
export const primaryButton = `inline-flex h-11 items-center justify-center gap-2 rounded-full bg-accent px-5 text-[15px] font-medium text-on-accent transition-[background-color,transform] duration-150 hover:bg-accent-hover active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 ${focusRing}`;

/** Compact primary, for headers and dialog footers. */
export const primaryButtonSmall = `inline-flex h-9 items-center justify-center gap-2 rounded-full bg-accent px-4 text-sm font-medium text-on-accent transition-[background-color,transform] duration-150 hover:bg-accent-hover active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 ${focusRing}`;

/** Quiet pill for secondary actions in lists and dialogs. */
export const secondaryButton = `inline-flex h-9 items-center justify-center gap-2 rounded-full border border-line-strong px-4 text-sm font-medium text-ink transition-colors hover:bg-surface-hover hover:text-ink active:bg-surface-muted disabled:pointer-events-none disabled:opacity-50 ${focusRing}`;

/** Row-level action inside lists. */
export const rowButton = `inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] font-medium text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink active:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;

/** Row-level destructive action. */
export const rowDangerButton = `inline-flex h-8 items-center gap-1.5 rounded-full border border-danger-line px-3 text-[13px] font-medium text-danger transition-colors hover:bg-danger-soft active:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;

/** Filled destructive confirmation. */
export const dangerButtonSmall = `inline-flex h-9 items-center justify-center rounded-full bg-danger-strong px-4 text-sm font-medium text-on-accent transition-colors hover:opacity-90 active:opacity-80 disabled:pointer-events-none disabled:opacity-50 ${focusRing}`;

/** Borderless action: refresh, "mark all read", dialog cancel. */
export const quietButton = `inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-ink-subtle transition-colors hover:bg-surface-hover hover:text-ink active:bg-surface-muted disabled:pointer-events-none disabled:opacity-50 ${focusRing}`;

/** Plain text link with a trailing arrow (wrap the arrow in a span). */
export const textLink = `group inline-flex items-center gap-1.5 rounded-md text-[15px] text-ink [&>span]:inline-block [&>span]:transition-transform hover:[&>span]:translate-x-[3px] ${focusRing}`;

/** Round icon-only close button used in dialogs. */
export const closeButton = `grid size-9 shrink-0 place-items-center rounded-full text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink active:bg-surface-muted disabled:opacity-50 ${focusRing}`;
