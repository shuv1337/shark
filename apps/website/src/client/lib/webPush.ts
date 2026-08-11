export type BrowserPushAvailability =
  | { status: "unsupported" }
  | { status: "denied" }
  | { status: "available"; permission: NotificationPermission };

export function browserPushAvailability(): BrowserPushAvailability {
  if (
    typeof window === "undefined" ||
    !window.isSecureContext ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return { status: "unsupported" };
  }

  if (Notification.permission === "denied") return { status: "denied" };
  return { status: "available", permission: Notification.permission };
}

export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  return new Uint8Array(bytes.buffer);
}

export async function currentWebPushSubscription(): Promise<PushSubscription | null> {
  const availability = browserPushAvailability();
  if (availability.status !== "available") return null;
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return registration.pushManager.getSubscription();
}

export async function requestWebPushPermission(): Promise<void> {
  const availability = browserPushAvailability();
  if (availability.status === "unsupported") {
    throw new Error("Browser notifications are not supported here.");
  }
  if (availability.status === "denied") {
    throw new Error("Notifications are blocked in this browser's site settings.");
  }

  const permission =
    availability.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked in this browser's site settings."
        : "Notification permission was not granted.",
    );
  }
}

export async function enableWebPush(publicKey: string): Promise<PushSubscription> {
  const availability = browserPushAvailability();
  if (availability.status !== "available" || availability.permission !== "granted") {
    throw new Error("Notification permission must be granted before subscribing.");
  }

  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
}

export function browserDeviceName(): string {
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform;
  return platform ? `Browser on ${platform}` : "This browser";
}
