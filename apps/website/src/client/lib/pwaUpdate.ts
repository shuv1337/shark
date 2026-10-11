type UpdateCallback = (registration: ServiceWorkerRegistration) => void;

let registrationPromise: Promise<ServiceWorkerRegistration | undefined> | undefined;
let registration: ServiceWorkerRegistration | undefined;
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

export async function applyUpdate(): Promise<boolean> {
  const next = registration ?? (await registerServiceWorker());
  if (!next?.waiting) return false;
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
