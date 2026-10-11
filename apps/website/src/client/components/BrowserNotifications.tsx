import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiRequestError } from "../lib/api";
import { offlineProps, useOffline } from "../lib/connection";
import {
  browserDeviceName,
  browserPushAvailability,
  currentWebPushSubscription,
  enableWebPush,
  requestWebPushPermission,
} from "../lib/webPush";
import { errorMessage, SECTION, SectionHeading } from "./DashboardKit";
import { primaryButtonSmall, rowDangerButton, secondaryButton, surfacePanel } from "./ui";

type BrowserNotificationState =
  | "checking"
  | "unsupported"
  | "default"
  | "denied"
  | "enabled"
  | "error";

/** Web Push for the browser you are reading this in. */
export function BrowserNotifications({ onChanged = () => {} }: { onChanged?: () => void }) {
  const [state, setState] = useState<BrowserNotificationState>("checking");
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [busy, setBusy] = useState<"enable" | "test" | "disable" | "reset" | null>(null);
  // The browser holds a subscription the server refused; it must be dropped before a new one
  // can be created, because `pushManager.subscribe` returns the existing one.
  const [refused, setRefused] = useState<PushSubscription | null>(null);
  // Removing a device, disconnecting a client and the push handshake are all
  // server writes, so they say why rather than failing on the tap.
  const offline = useOffline();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onChangedRef = useRef(onChanged);

  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  const inspect = useCallback(async () => {
    setError(null);
    const availability = browserPushAvailability();
    if (availability.status === "unsupported") {
      setState("unsupported");
      return;
    }
    if (availability.status === "denied") {
      setState("denied");
      return;
    }

    setRefused(null);
    let current: PushSubscription | null = null;
    try {
      current = await currentWebPushSubscription();
      if (current) {
        await api.registerWebPushSubscription(current.toJSON(), browserDeviceName());
        onChangedRef.current();
      }
      setSubscription(current);
      setState(current ? "enabled" : "default");
    } catch (err) {
      setState("error");
      setError(describeRegistrationError(err, "Could not check browser notifications."));
      if (current && err instanceof ApiRequestError && err.status === 400) setRefused(current);
    }
  }, []);

  const reset = useCallback(async () => {
    if (!refused) return;
    setBusy("reset");
    setError(null);
    try {
      await refused.unsubscribe();
      setRefused(null);
      setSubscription(null);
      setState("default");
      setMessage("The old subscription was removed. Enable notifications to create a new one.");
    } catch (err) {
      setError(errorMessage(err, "Could not remove the old subscription."));
    } finally {
      setBusy(null);
    }
  }, [refused]);

  useEffect(() => {
    void inspect();
  }, [inspect]);

  const enable = async () => {
    setBusy("enable");
    setError(null);
    setMessage(null);
    try {
      await requestWebPushPermission();
      const { publicKey } = await api.getWebPushPublicKey();
      const next = await enableWebPush(publicKey);
      await api.registerWebPushSubscription(next.toJSON(), browserDeviceName());
      setSubscription(next);
      setState("enabled");
      setMessage("Desktop alerts are enabled for this browser.");
      onChanged();
    } catch (err) {
      const availability = browserPushAvailability();
      if (availability.status === "denied") setState("denied");
      setError(errorMessage(err, "Could not enable browser notifications."));
    } finally {
      setBusy(null);
    }
  };

  const sendTest = async () => {
    if (!subscription) return;
    setBusy("test");
    setError(null);
    setMessage(null);
    try {
      const result = await api.testWebPushSubscription(subscription.endpoint);
      if (!result.accepted) throw new Error("The push service did not accept the test alert.");
      setMessage("Test alert sent. It may take a moment to appear.");
    } catch (err) {
      setError(errorMessage(err, "Could not send a test notification."));
    } finally {
      setBusy(null);
    }
  };

  const disable = async () => {
    if (!subscription) return;
    setBusy("disable");
    setError(null);
    setMessage(null);
    try {
      await api.removeWebPushSubscription(subscription.endpoint);
      await subscription.unsubscribe();
      setSubscription(null);
      setState("default");
      setMessage("Desktop alerts are disabled for this browser.");
      onChanged();
    } catch (err) {
      setError(errorMessage(err, "Could not disable browser notifications."));
    } finally {
      setBusy(null);
    }
  };

  const statusCopy = {
    checking: "Checking notification support…",
    unsupported: "This browser does not support Web Push, or this page is not in a secure context.",
    default: "Enable alerts even when the SHark tab is closed.",
    denied: "Notifications are blocked. Allow them in this site's browser settings, then reload.",
    enabled: "Enabled for this browser profile.",
    error: "SHark could not check notifications for this browser.",
  }[state];

  return (
    <section
      aria-labelledby="browser-notifications-heading"
      className={`${SECTION} scroll-mt-24`}
      id="notifications"
    >
      <SectionHeading
        id="browser-notifications-heading"
        title="Browser notifications"
        description="Desktop alerts for this browser, delivered by Web Push."
      />
      <div className={`${surfacePanel} rounded-2xl px-5 py-4`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">
              {state === "enabled" ? "Notifications on" : "Browser alerts"}
            </p>
            <p className="mt-1 text-xs text-ink-subtle">{statusCopy}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {state === "default" ? (
              <button
                className={primaryButtonSmall}
                disabled={busy !== null}
                onClick={() => void enable()}
                type="button"
                {...offlineProps(offline)}
              >
                {busy === "enable" ? "Enabling…" : "Enable notifications"}
              </button>
            ) : null}
            {state === "error" && refused ? (
              <button
                className={primaryButtonSmall}
                disabled={busy !== null}
                onClick={() => void reset()}
                type="button"
                {...offlineProps(offline)}
              >
                {busy === "reset" ? "Removing…" : "Remove old subscription"}
              </button>
            ) : null}
            {state === "error" ? (
              <button
                className={secondaryButton}
                disabled={busy !== null}
                onClick={() => {
                  setState("checking");
                  void inspect();
                }}
                type="button"
              >
                Try again
              </button>
            ) : null}
            {state === "enabled" ? (
              <>
                <button
                  className={secondaryButton}
                  disabled={busy !== null}
                  onClick={() => void sendTest()}
                  type="button"
                  {...offlineProps(offline)}
                >
                  {busy === "test" ? "Sending…" : "Send test"}
                </button>
                <button
                  className={`${rowDangerButton} h-9 px-4 text-sm`}
                  disabled={busy !== null}
                  onClick={() => void disable()}
                  type="button"
                  {...offlineProps(offline)}
                >
                  {busy === "disable" ? "Disabling…" : "Disable"}
                </button>
              </>
            ) : null}
          </div>
        </div>
        {message ? (
          <p className="mt-3 text-xs text-ink-muted" role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="mt-3 text-xs text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/**
 * A 400 from the subscription endpoint carries the validation issue (for example a push
 * service that is not on the allowlist); show it, since "invalid" alone cannot be acted on.
 */
function describeRegistrationError(error: unknown, fallback: string): string {
  const base = errorMessage(error, fallback);
  if (!(error instanceof ApiRequestError) || !Array.isArray(error.issues)) return base;
  const detail = error.issues
    .map((issue) =>
      issue && typeof issue === "object" ? (issue as { message?: unknown }).message : null,
    )
    .find((message): message is string => typeof message === "string" && message.length > 0);
  return detail ? `${base}: ${detail}.` : base;
}
