import { useCallback, useEffect, useRef, useState } from "react";
import { dangerButtonSmall, primaryButtonSmall, secondaryButton } from "./ui";

export interface ConfirmOptions {
  title: string;
  message: string;
  /** Label for the confirming button, e.g. "Delete". Defaults to "Confirm". */
  confirmLabel?: string;
  /** Renders the confirming button in the danger style. */
  destructive?: boolean;
}

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

/**
 * Promise-based replacement for window.confirm, rendered with the app's own
 * modal shell. Call `confirm(options)` and render `{dialog}` inside the
 * component that owns the action:
 *
 *   const { confirm, dialog } = useConfirm();
 *   if (!(await confirm({ title, message, confirmLabel: "Delete", destructive: true }))) return;
 */
export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending((current) => {
          // A second request while one is open cancels the first rather than
          // silently dropping it.
          current?.resolve(false);
          return { options, resolve };
        });
      }),
    [],
  );

  const dialog = pending ? (
    <ConfirmDialog
      options={pending.options}
      onClose={(value) => {
        pending.resolve(value);
        setPending(null);
      }}
    />
  ) : null;

  return { confirm, dialog };
}

function ConfirmDialog({
  options,
  onClose,
}: {
  options: ConfirmOptions;
  onClose: (value: boolean) => void;
}) {
  const [closing, setClosing] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(
    (value: boolean) => {
      setClosing((current) => {
        if (current) return current;
        window.setTimeout(() => onClose(value), 120);
        return true;
      });
    },
    [onClose],
  );

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => cancelRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [close]);

  return (
    <div className={`hark-modal-backdrop ${closing ? "is-closing" : ""}`}>
      <button
        aria-label="Cancel"
        className="hark-modal-dismiss"
        onClick={() => close(false)}
        type="button"
      />
      <div
        aria-describedby="confirm-dialog-message"
        aria-labelledby="confirm-dialog-title"
        aria-modal="true"
        className="hark-modal-panel hark-glass hark-glass-strong"
        role="alertdialog"
      >
        <h2 id="confirm-dialog-title" className="text-xl font-medium text-white">
          {options.title}
        </h2>
        <p id="confirm-dialog-message" className="mt-2 text-[15px] leading-relaxed text-ink-muted">
          {options.message}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => close(false)}
            className={secondaryButton}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => close(true)}
            className={options.destructive ? dangerButtonSmall : primaryButtonSmall}
          >
            {options.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
