type UpdateCallback = (registration: ServiceWorkerRegistration) => void;

let registrationPromise: Promise<ServiceWorkerRegistration | undefined> | undefined;
let registration: ServiceWorkerRegistration | undefined;
let applying = false;
const updateCallbacks = new Set<UpdateCallback>();

function announceUpdate(): void {
  if (!registration?.waiting) return;
  for (const callback of updateCallbacks) callback(registration);
}

function watchRegistration(next: ServiceWorkerRegistration): void {
  registration = next;
  announceUpdate();
  next.addEventListener("updatefound", () => {
    const installing = next.installing;
    installing?.addEventListener("statechange", () => {
      if (installing.state === "installed" && navigator.serviceWorker.controller) announceUpdate();
    });
  });
}

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | undefined> {
  if (registrationPromise) return registrationPromise;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    registrationPromise = Promise.resolve(undefined);
    return registrationPromise;
  }
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
 */
export async function checkForUpdate(): Promise<boolean> {
  const next = registration ?? (await registerServiceWorker());
  if (!next) return false;
  await next.update();
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

export async function applyUpdate(): Promise<boolean> {
  const next = registration ?? (await registerServiceWorker());
  if (!next?.waiting) return false;
  // One reload, however many times the button is pressed while the handover
  // is in flight: a second listener would reload the page it just loaded.
  if (applying) return true;
  applying = true;
  const controllerChanged = new Promise<void>((resolve) => {
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => {
        window.location.reload();
        resolve();
      },
      { once: true },
    );
  });
  next.waiting.postMessage({ type: "hark:skip-waiting" });
  await controllerChanged;
  return true;
}
