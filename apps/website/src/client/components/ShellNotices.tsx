import { useCallback, useEffect, useState } from "react";
import { useOffline } from "../lib/connection";
import { applyUpdate, onUpdateAvailable } from "../lib/pwaUpdate";
import { IconOffline, IconX } from "./icons";
import { PAGE_COLUMN } from "./SiteChrome";
import { closeButton, focusRing } from "./ui";

/**
 * The two things the shell says about itself rather than about the operator's
 * data: that this browser cannot reach the server, and that a newer build is
 * already downloaded and waiting to take over.
 *
 * Both are bars under the header, not dialogs. Neither needs an answer before
 * the board can be read, and interrupting someone to tell them the app got
 * better would be the worst moment to do it.
 */
export function ShellNotices({ column = PAGE_COLUMN }: { column?: string }) {
  return (
    <>
      <OfflineNotice column={column} />
      <UpdateNotice column={column} />
    </>
  );
}

const BAR = "flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13px]";

/**
 * Offline. The pages keep whatever they last loaded on screen, so this says
 * what the screen is rather than that something failed: an error paragraph in
 * place of the board would throw away the only copy of it this browser has.
 */
function OfflineNotice({ column }: { column: string }) {
  const offline = useOffline();
  if (!offline) return null;
  return (
    <div className="border-b border-warn/35 bg-warn/12">
      <div className={`${column} ${BAR} text-ink`} role="status">
        <IconOffline className="size-4 shrink-0 text-ink-muted" />
        <p>You're offline. Showing what was last loaded.</p>
      </div>
    </div>
  );
}

/**
 * Only fields inside an ask count as being mid-answer: a reply, a snooze date,
 * a dismissal reason. Pressing one of the option buttons resolves the ask in a
 * single click, so there is nothing to lose there.
 */
const ASK_FIELD = "[data-ask-id] textarea, [data-ask-id] input";

function midAnswer(): boolean {
  const active = typeof document === "undefined" ? null : document.activeElement;
  return active instanceof HTMLElement && active.matches(ASK_FIELD);
}

/**
 * A waiting worker, offered rather than taken. `applyUpdate` reloads the page,
 * which would discard a half-typed answer to an agent, so when the update
 * lands while an ask field has focus the bar waits until that field is left.
 *
 * Dismissing it is final for this build: the worker stays waiting and takes
 * over on the next natural reload, which is what every other tab does anyway.
 */
function UpdateNotice({ column }: { column: string }) {
  const [state, setState] = useState<"none" | "held" | "ready" | "dismissed">("none");
  const [reloading, setReloading] = useState(false);

  useEffect(
    () =>
      onUpdateAvailable(() => {
        setState((current) => (current === "dismissed" ? current : midAnswer() ? "held" : "ready"));
      }),
    [],
  );

  // Held: show it the moment the ask field is left. `focusout` fires before
  // focus lands, so the check happens after the browser has moved it.
  useEffect(() => {
    if (state !== "held") return;
    const check = () => {
      if (!midAnswer()) setState("ready");
    };
    const onFocusOut = () => setTimeout(check, 0);
    document.addEventListener("focusout", onFocusOut);
    return () => document.removeEventListener("focusout", onFocusOut);
  }, [state]);

  const reload = useCallback(() => {
    setReloading(true);
    void applyUpdate().then((applied) => {
      // Nothing was waiting after all; the page is already the new build.
      if (!applied) {
        setReloading(false);
        setState("dismissed");
      }
    });
  }, []);

  if (state !== "ready") return null;
  return (
    <div className="border-b border-line bg-accent-wash">
      <div className={`${column} ${BAR} text-ink-muted`} role="status">
        <p>
          <span className="font-medium text-ink">SHark updated.</span> Reload to use the new
          version.
        </p>
        <button
          className={`inline-flex h-8 items-center rounded-full bg-accent px-3.5 text-[13px] font-medium whitespace-nowrap text-on-accent transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50 ${focusRing}`}
          disabled={reloading}
          onClick={reload}
          type="button"
        >
          {reloading ? "Reloading…" : "Reload"}
        </button>
        <button
          aria-label="Dismiss the update notice"
          className={`${closeButton} ml-auto size-8`}
          onClick={() => setState("dismissed")}
          type="button"
        >
          <IconX className="size-4" />
        </button>
      </div>
    </div>
  );
}
