type UpdateCallback = (registration: ServiceWorkerRegistration) => void;

let registrationPromise: Promise<ServiceWorkerRegistration | undefined> | undefined;
let registration: ServiceWorkerRegistration | undefined;
let applying = false;
const updateCallbacks = new Set<UpdateCallback>();

function announceUpdate(): void {
  if (!registration?.waiting) return;
  for (const callback of updateCallbacks) callback(registration);
}

/**
 * The handover, watched for the whole page rather than only inside
 * `applyUpdate`.
 *
 * The worker calls `clients.claim()` when it activates, so pressing Reload in
 * one tab takes every other tab's controller with it. A tab that only
 * listened while its own button was pressed would be left running the old
 * bundle against the new worker, with its bar gone and nothing to press. So
 * the listener is attached once at registration and every tab reloads itself
 * exactly once when its controller is replaced.
 *
 * "Replaced" is the condition, not "changed": the first worker a browser ever
 * installs claims the page it was installed on, and reloading there would
 * reload a page that has only just finished loading.
 */
let controllerWatched = false;
let hadController = false;
let controllerChanged = false;
let reloaded = false;
const controllerWaiters = new Set<() => void>();

function reloadOnce(): void {
  if (reloaded) return;
  reloaded = true;
  window.location.reload();
}

function watchController(): void {
  if (controllerWatched) return;
  controllerWatched = true;
  hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    const replaced = hadController;
    hadController = Boolean(navigator.serviceWorker.controller);
    controllerChanged = true;
    for (const waiter of [...controllerWaiters]) waiter();
    controllerWaiters.clear();
    if (replaced) reloadOnce();
  });
}

function onceControllerChanged(): Promise<void> {
  return new Promise((resolve) => controllerWaiters.add(resolve));
}

/**
 * Follow one worker to the end of its install.
 *
 * A worker that reaches `installed` while something already controls the page
 * is a new build waiting its turn, which is the whole signal the update bar
 * runs on. One that installs with no controller is the first worker this
 * browser has ever had: it activates immediately and there is nothing to
 * offer.
 *
 * The listener is attached and then fired by hand, because by the time any of
 * this runs the worker may already be past `installing` — `register()`
 * resolves while the install is still going, so `updatefound` has usually
 * fired before there is anywhere to hear it.
 */
function watchInstalling(worker: ServiceWorker | null | undefined): void {
  if (!worker) return;
  const onStateChange = () => {
    if (worker.state === "installing") return;
    worker.removeEventListener("statechange", onStateChange);
    if (worker.state === "installed" && navigator.serviceWorker.controller) announceUpdate();
  };
  worker.addEventListener("statechange", onStateChange);
  onStateChange();
}

function watchRegistration(next: ServiceWorkerRegistration): void {
  registration = next;
  announceUpdate();
  // The install that was already running when this registration resolved.
  // Without this the session that discovers a new build never offers it, and
  // only the next full load shows the bar.
  watchInstalling(next.installing);
  next.addEventListener("updatefound", () => watchInstalling(next.installing));
}

/** Settle once this worker is no longer installing, or give up waiting. */
function installSettled(worker: ServiceWorker | null, timeoutMs: number): Promise<void> {
  if (!worker || worker.state !== "installing") return Promise.resolve();
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      clearTimeout(timer);
      worker.removeEventListener("statechange", onStateChange);
      resolve();
    };
    const onStateChange = () => {
      if (worker.state !== "installing") finish();
    };
    // A worker that never leaves `installing` must not leave the caller's
    // button saying "Checking…" for the rest of the session.
    timer = setTimeout(finish, timeoutMs);
    worker.addEventListener("statechange", onStateChange);
  });
}

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | undefined> {
  if (registrationPromise) return registrationPromise;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    registrationPromise = Promise.resolve(undefined);
    return registrationPromise;
  }
  // Before the register, so the controller this page started with is read
  // before anything has had a chance to replace it.
  watchController();
  registrationPromise = navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((next) => {
    watchRegistration(next);
    return next;
  });
  return registrationPromise;
}

export function onUpdateAvailable(callback: UpdateCallback): () => void {
  updateCallbacks.add(callback);
  if (registration?.waiting) queueMicrotask(announceUpdate);
  return () => updateCallbacks.delete(callback);
}

/**
 * Ask the server whether a newer worker exists, for the "Check for updates"
 * action in Settings. Resolves true when one is downloaded and waiting, which
 * is also when the shell's update bar appears.
 *
 * `update()` resolves once the new script has been fetched, which can be
 * before the worker it started has finished installing. Answering then would
 * let Settings say "You are on the latest build" with an install in flight
 * behind it, so this waits for that install to settle first.
 */
export async function checkForUpdate(installTimeoutMs = 10_000): Promise<boolean> {
  const next = registration ?? (await registerServiceWorker());
  if (!next) return false;
  await next.update();
  await installSettled(next.installing, installTimeoutMs);
  announceUpdate();
  return Boolean(next.waiting);
}

/**
 * The build the worker controlling this tab is running — which is what an
 * installed app actually serves, rather than whatever bundle this tab happens
 * to still hold. Resolves null when no worker is in control yet, or when one
 * does not answer, so a caller never waits on it forever.
 */
export function serviceWorkerVersion(timeoutMs = 2000): Promise<string | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return Promise.resolve(null);
  }
  const worker = navigator.serviceWorker.controller;
  if (!worker) return Promise.resolve(null);
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; version?: unknown } | null;
      if (data?.type !== "hark:sw-version" || typeof data.version !== "string") return;
      finish(data.version);
    };
    const finish = (version: string | null) => {
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("message", onMessage);
      resolve(version);
    };
    timer = setTimeout(() => finish(null), timeoutMs);
    navigator.serviceWorker.addEventListener("message", onMessage);
    worker.postMessage({ type: "hark:get-version" });
  });
}

/**
 * Hand over to the waiting build and reload onto it.
 *
 * Resolves true once the handover has happened — the page is reloading, so
 * nothing after that matters. Resolves false when there is genuinely nothing
 * to apply. Rejects when a handover was asked for and did not arrive, so the
 * caller can say so and offer the button again rather than leaving it
 * spinning on "Reloading…" for the rest of the session.
 */
export async function applyUpdate(timeoutMs = 10_000): Promise<boolean> {
  const next = registration ?? (await registerServiceWorker());
  if (!next) return false;
  if (!next.waiting) {
    /*
     * Another tab pressed Reload first and the new worker claimed this one
     * too, which cleared `waiting` here. This tab is now the old bundle
     * running against the new worker; the page-wide listener has normally
     * reloaded it already, and this covers the press that raced it.
     */
    if (controllerChanged) {
      reloadOnce();
      return true;
    }
    return false;
  }
  // One handover, however many times the button is pressed while it is in
  // flight.
  if (applying) return true;
  applying = true;
  try {
    const handover = onceControllerChanged();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const gaveUp = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("The new version did not take over in time.")),
        timeoutMs,
      );
    });
    next.waiting.postMessage({ type: "hark:skip-waiting" });
    try {
      await Promise.race([handover, gaveUp]);
    } finally {
      clearTimeout(timer);
    }
  } catch (reason) {
    // The worker refused, went redundant, or never answered. Let the caller
    // show it and press again.
    applying = false;
    throw reason;
  }
  reloadOnce();
  return true;
}
