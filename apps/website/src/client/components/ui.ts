/**
 * Shared class names for the few control styles the site uses. Kept as plain
 * strings so they compose with layout utilities at the call site.
 */

/** White pill with green type: the one primary action per view. */
export const primaryButton =
  "inline-flex h-11 items-center justify-center gap-2 rounded-full bg-white px-5 text-[15px] font-medium text-green transition-[background-color,transform] duration-150 hover:bg-white/90 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50";

/** Compact primary, for headers and dialog footers. */
export const primaryButtonSmall =
  "inline-flex h-9 items-center justify-center gap-2 rounded-full bg-white px-4 text-sm font-medium text-green transition-[background-color,transform] duration-150 hover:bg-white/90 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50";

/** Quiet pill for secondary actions in lists and dialogs. */
export const secondaryButton =
  "inline-flex h-9 items-center justify-center gap-2 rounded-full border border-line-strong px-4 text-sm font-medium text-ink transition-colors hover:bg-surface-hover hover:text-white disabled:pointer-events-none disabled:opacity-50";

/** Row-level action inside lists. */
export const rowButton =
  "inline-flex h-8 items-center rounded-full border border-line px-3 text-[13px] font-medium text-ink-muted transition-colors hover:bg-surface-hover hover:text-white disabled:cursor-not-allowed disabled:opacity-50";

/** Row-level destructive action. */
export const rowDangerButton =
  "inline-flex h-8 items-center rounded-full border border-danger-line px-3 text-[13px] font-medium text-danger transition-colors hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-50";

/** Filled destructive confirmation. */
export const dangerButtonSmall =
  "inline-flex h-9 items-center justify-center rounded-full bg-danger-strong px-4 text-sm font-medium text-white transition-colors hover:bg-danger-strong-hover disabled:opacity-50";

/** Plain white text link with a trailing arrow (wrap the arrow in a span). */
export const textLink =
  "group inline-flex items-center gap-1.5 text-[15px] text-white [&>span]:inline-block [&>span]:transition-transform hover:[&>span]:translate-x-[3px]";

/** Round icon-only close button used in dialogs. */
export const closeButton =
  "grid size-9 shrink-0 place-items-center rounded-full text-xl leading-none text-ink-faint transition-colors hover:bg-surface-hover hover:text-white disabled:opacity-50";
