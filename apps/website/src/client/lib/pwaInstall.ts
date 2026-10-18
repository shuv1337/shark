interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

let installPrompt: BeforeInstallPromptEvent | null = null;
const availabilityListeners = new Set<() => void>();

function announceAvailability(): void {
  for (const listener of availabilityListeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event as BeforeInstallPromptEvent;
    announceAvailability();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    announceAvailability();
  });
}

export function canInstall(): boolean {
  return installPrompt !== null;
}

/**
 * Chromium fires `beforeinstallprompt` on its own schedule, often after the
 * page has rendered, so the Settings install section listens rather than
 * reading once and being wrong for the rest of the session.
 */
export function subscribeToInstallAvailability(listener: () => void): () => void {
  availabilityListeners.add(listener);
  return () => {
    availabilityListeners.delete(listener);
  };
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const prompt = installPrompt;
  if (!prompt) return "unavailable";
  installPrompt = null;
  await prompt.prompt();
  return (await prompt.userChoice).outcome;
}

export function isStandalone(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const agent = navigator.userAgent;
  const ios =
    /iPad|iPhone|iPod/.test(agent) || (agent.includes("Macintosh") && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(agent) && !/(CriOS|FxiOS|EdgiOS|OPiOS)/.test(agent);
}

/**
 * Desktop Safari, which has no install prompt but has carried "Add to Dock"
 * since Sonoma. Every other desktop browser either fires
 * `beforeinstallprompt` or cannot install a web app at all.
 */
export function isMacSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const agent = navigator.userAgent;
  return (
    agent.includes("Macintosh") &&
    // An iPad reports a Macintosh agent; its touch points are what give it away.
    navigator.maxTouchPoints <= 1 &&
    /Safari/.test(agent) &&
    !/(Chrome|Chromium|Edg|OPR|Firefox)/.test(agent)
  );
}
