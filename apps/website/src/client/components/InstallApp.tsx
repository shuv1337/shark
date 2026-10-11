import { useEffect, useState } from "react";
import {
  canInstall,
  isIosSafari,
  isMacSafari,
  isStandalone,
  promptInstall,
  subscribeToInstallAvailability,
} from "../lib/pwaInstall";
import { checkForUpdate, serviceWorkerVersion } from "../lib/pwaUpdate";
import { SECTION, SectionHeading } from "./DashboardKit";
import { IconPlusSquare, IconShare } from "./icons";
import { primaryButton, secondaryButton } from "./ui";

/**
 * The "Install app" section of Settings.
 *
 * Installing a web app is four different things in four browsers, and only one
 * of them is a button. Rather than show a button that does nothing and steps
 * that do not apply, the section asks which of them this browser is and shows
 * that one. Where none of them applies — Firefox on the desktop, a browser
 * that cannot install at all — there is no section, and the build line that
 * would have been in it stands on its own instead.
 */

/**
 * Which install path this browser has, in precedence order. `null` means none:
 * the section does not render.
 */
export type InstallTarget = "installed" | "prompt" | "ios-safari" | "mac-safari" | null;

function readInstallTarget(): InstallTarget {
  if (isStandalone()) return "installed";
  if (canInstall()) return "prompt";
  if (isIosSafari()) return "ios-safari";
  if (isMacSafari()) return "mac-safari";
  return null;
}

export function useInstallTarget(): InstallTarget {
  const [target, setTarget] = useState<InstallTarget>(readInstallTarget);
  // Chromium decides when the page is install-worthy, which is usually after
  // this has already rendered.
  useEffect(() => subscribeToInstallAvailability(() => setTarget(readInstallTarget())), []);
  return target;
}

function useServiceWorkerVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => {
      void serviceWorkerVersion().then((value) => {
        if (live && value) setVersion(value);
      });
    };
    read();
    /*
     * On a first visit the worker is still installing when this mounts, so
     * there is nothing in control to ask yet. It claims the page a moment
     * later; read again then rather than leaving the line wrong until the
     * next reload.
     */
    const worker = typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
    worker?.addEventListener("controllerchange", read);
    return () => {
      live = false;
      worker?.removeEventListener("controllerchange", read);
    };
  }, []);
  return version;
}

/**
 * Which build is actually in control of this tab. It comes from the service
 * worker rather than from the bundle, because in an installed app those two
 * can differ until the next reload, and this line is what someone reads back
 * when they are asked which version they are on.
 */
export function AppBuildLine({ className = "" }: { className?: string }) {
  const version = useServiceWorkerVersion();
  return (
    <p className={`text-[13px] text-ink-faint ${className}`}>
      {version ? (
        <>
          App build <span className="font-mono text-ink-subtle">{version}</span>
        </>
      ) : (
        "No service worker is in control of this tab yet, so there is no build to report."
      )}
    </p>
  );
}

export function InstallAppSection() {
  const target = useInstallTarget();
  if (!target) return null;
  return (
    <section aria-labelledby="install-heading" className={`${SECTION} scroll-mt-24`} id="install">
      <SectionHeading
        id="install-heading"
        title="Install app"
        description="Run SHark in its own window, with the board one tap from the home screen or the Dock."
      />
      {target === "installed" ? <Installed /> : null}
      {target === "prompt" ? <ChromiumInstall /> : null}
      {target === "ios-safari" ? <AddToHomeScreen /> : null}
      {target === "mac-safari" ? <AddToDock /> : null}
    </section>
  );
}

function Installed() {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const check = () => {
    setChecking(true);
    setResult(null);
    void checkForUpdate()
      .then((waiting) =>
        setResult(
          waiting
            ? "A new build is ready. Reload from the bar at the top to use it."
            : "You are on the latest build.",
        ),
      )
      .catch(() => setResult("Could not reach the server to check."))
      .finally(() => setChecking(false));
  };

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="font-medium text-ink">Installed</p>
        <AppBuildLine className="mt-1.5" />
        {result ? <p className="mt-2 text-[13px] text-ink-muted">{result}</p> : null}
      </div>
      <button className={secondaryButton} disabled={checking} onClick={check} type="button">
        {checking ? "Checking…" : "Check for updates"}
      </button>
    </div>
  );
}

function ChromiumInstall() {
  const [outcome, setOutcome] = useState<"accepted" | "dismissed" | "unavailable" | null>(null);
  const [busy, setBusy] = useState(false);

  const install = () => {
    setBusy(true);
    void promptInstall()
      .then(setOutcome)
      .finally(() => setBusy(false));
  };

  // Accepting removes the prompt, so the section re-reads as "installed" on
  // the next load; until then this is the only confirmation there is.
  const message =
    outcome === "accepted"
      ? "Installed. Look for SHark alongside your other apps."
      : outcome === "dismissed"
        ? "Not installed. You can install it any time from here."
        : outcome === "unavailable"
          ? "This browser withdrew the install prompt. Reload the page and try again."
          : null;

  return (
    <div>
      <button className={primaryButton} disabled={busy} onClick={install} type="button">
        Install SHark
      </button>
      {message ? <p className="mt-3 text-[13px] text-ink-muted">{message}</p> : null}
      <AppBuildLine className="mt-4" />
    </div>
  );
}

const STEP = "flex items-start gap-3";
const STEP_MARK =
  "mt-px grid size-6 shrink-0 place-items-center rounded-full bg-surface-muted text-ink-muted";

function AddToHomeScreen() {
  return (
    <div>
      <ol className="flex flex-col gap-3 text-[15px] text-ink-muted">
        <li className={STEP}>
          <span className={STEP_MARK}>
            <IconShare className="size-4" />
          </span>
          <span>
            Tap <span className="font-medium text-ink">Share</span> in Safari's toolbar.
          </span>
        </li>
        <li className={STEP}>
          <span className={STEP_MARK}>
            <IconPlusSquare className="size-4" />
          </span>
          <span>
            Choose <span className="font-medium text-ink">Add to Home Screen</span>.
          </span>
        </li>
        <li className={STEP}>
          <span className={`${STEP_MARK} text-[13px] font-semibold`}>3</span>
          <span>
            Tap <span className="font-medium text-ink">Add</span>. SHark opens full screen, with the
            board first.
          </span>
        </li>
      </ol>
      <AppBuildLine className="mt-4" />
    </div>
  );
}

function AddToDock() {
  return (
    <div>
      <p className="flex flex-wrap items-center gap-1.5 text-[15px] text-ink-muted">
        <IconShare className="size-4 shrink-0 text-ink-faint" />
        <span>
          In Safari, choose <span className="font-medium text-ink">Share ▸ Add to Dock</span> to
          keep SHark in your Dock as its own app.
        </span>
      </p>
      <AppBuildLine className="mt-4" />
    </div>
  );
}
