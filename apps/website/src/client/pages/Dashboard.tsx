import type {
  ApiTokenDto,
  DeviceDto,
  EventDto,
  LiveActivityDto,
  ServiceCreatedResponse,
  ServiceDto,
} from "@hark/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { BrandWordmark } from "../components/BrandWordmark";
import { useConfirm } from "../components/ConfirmDialog";
import { CopyField } from "../components/CopyField";
import { InboxPanel } from "../components/InboxPanel";
import { api } from "../lib/api";
import { signOut, useSession } from "../lib/auth";
import {
  browserDeviceName,
  browserPushAvailability,
  currentWebPushSubscription,
  enableWebPush,
  requestWebPushPermission,
} from "../lib/webPush";

function curlExample(webhookUrl: string): string {
  return [
    `curl -X POST ${webhookUrl} \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H 'Idempotency-Key: unique-event-id' \\`,
    `  -d '{ "body": "Deploy finished ✅" }'`,
  ].join("\n");
}

function agentPrompt(webhookUrl: string, devices: DeviceDto[]): string {
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["body"],
    properties: {
      body: {
        type: "string",
        minLength: 1,
        maxLength: 2000,
        description: "Notification message body.",
      },
      title: {
        type: "string",
        minLength: 1,
        maxLength: 80,
        description: "Optional sender title. Overrides the service default.",
      },
      imageUrl: {
        type: "string",
        format: "uri",
        pattern: "^https://",
        maxLength: 2048,
        description: "Optional avatar URL. Overrides the service default.",
      },
      url: {
        type: "string",
        format: "uri",
        maxLength: 2048,
        description: "Optional destination opened when the notification is tapped.",
      },
      deviceIds: {
        type: "array",
        minItems: 1,
        maxItems: 50,
        uniqueItems: true,
        items: {
          type: "string",
          ...(devices.length > 0 ? { enum: devices.map((device) => device.id) } : {}),
        },
        description:
          "Optional SHark routing targets. Omit to notify every active registered device.",
      },
    },
  };

  return [
    "Configure an integration that sends notifications through this SHark webhook.",
    "",
    `Webhook endpoint: ${webhookUrl}`,
    "Method: POST",
    "Header: Content-Type: application/json",
    "",
    "Payload JSON Schema:",
    JSON.stringify(schema, null, 2),
    "",
    "Minimal test request:",
    curlExample(webhookUrl),
    "",
    "Use body for the notification message. title, imageUrl, and url are optional per-request overrides of the service defaults.",
    "Omit deviceIds to deliver to all devices. Include one or more IDs to route only to those devices.",
    ...(devices.length > 0
      ? [
          "",
          "Registered devices:",
          ...devices.map((device) => `- ${device.deviceName ?? "Device"}: ${device.id}`),
        ]
      : []),
  ].join("\n");
}

export function SelfHostedBadge() {
  return (
    <span className="bg-accent-soft text-accent-text rounded-full px-3 py-2 text-xs font-semibold">
      Self-hosted
    </span>
  );
}

export function Dashboard() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();

  const [services, setServices] = useState<ServiceDto[] | null>(null);
  const [events, setEvents] = useState<EventDto[] | null>(null);
  const [liveActivities, setLiveActivities] = useState<LiveActivityDto[] | null>(null);
  const [devices, setDevices] = useState<DeviceDto[] | null>(null);
  const [apiTokens, setApiTokens] = useState<ApiTokenDto[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ServiceDto | null>(null);
  const [reveal, setReveal] = useState<
    (ServiceCreatedResponse & { kind: "created" | "rotated" }) | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [svc, dev, tokenState, activity, liveActivityState] = await Promise.all([
        api.listServices(),
        api.listDevices(),
        api.listApiTokens(),
        api.listEvents(),
        api.listLiveActivities(),
      ]);
      setServices(svc.services);
      setDevices(dev.devices);
      setApiTokens(tokenState.tokens);
      setEvents(activity.events);
      setLiveActivities(liveActivityState.activities);
    } catch {
      setError("Could not load your dashboard data. Please refresh and try again.");
    }
  }, []);

  const refreshActivity = useCallback(async () => {
    try {
      const [activity, liveActivityState] = await Promise.all([
        api.listEvents(),
        api.listLiveActivities(),
      ]);
      setEvents(activity.events);
      setLiveActivities(liveActivityState.activities);
    } catch {
      // Keep the last successful activity snapshot visible.
    }
  }, []);

  useEffect(() => {
    if (!isPending && !session) {
      navigate("/", { replace: true });
      return;
    }
    if (session) void refresh();
  }, [session, isPending, navigate, refresh]);

  useEffect(() => {
    if (!session) return;
    const interval = window.setInterval(() => void refreshActivity(), 10_000);
    return () => window.clearInterval(interval);
  }, [session, refreshActivity]);

  if (isPending || !session) {
    return <div className="flex min-h-dvh items-center justify-center text-ink-faint">…</div>;
  }

  const activeDeviceCount = devices?.filter((device) => device.active).length ?? null;
  const deliveryDeviceCount = activeDeviceCount;

  return (
    <div className="min-h-dvh">
      <header>
        <div className="mx-auto flex h-20 w-full max-w-3xl items-center justify-between px-6">
          <Link to="/" className="text-lg font-semibold">
            <BrandWordmark />
          </Link>
          <div className="flex items-center gap-3">
            <Link className="text-ink-subtle hover:text-ink text-sm transition" to="/docs">
              Docs
            </Link>
            {session.user.image ? (
              <img
                src={session.user.image}
                alt=""
                className="border-media-line size-7 rounded-full border"
                referrerPolicy="no-referrer"
              />
            ) : null}
            <span className="hidden text-sm text-ink-subtle sm:block">{session.user.email}</span>
            <SelfHostedBadge />
            <button
              type="button"
              onClick={() => void signOut().then(() => navigate("/"))}
              className="min-h-10 rounded-full border border-line bg-surface px-3.5 text-xs font-medium text-ink-muted shadow-xs transition-colors hover:bg-surface-hover"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-10">
        <InboxPanel />

        <div className="mt-16 mb-8 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Services</h1>
            <p className="mt-1 text-sm text-ink-subtle">
              {deliveryDeviceCount === null
                ? "Each service gets a secret webhook URL."
                : deliveryDeviceCount === 0
                  ? "No devices registered yet — enable this browser or sign in inside the SHark app."
                  : `Delivering to ${deliveryDeviceCount} registered ${deliveryDeviceCount === 1 ? "device" : "devices"}.`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="bg-accent hover:bg-accent-hover rounded-full px-4 py-2 text-sm font-medium text-on-accent transition"
          >
            New service
          </button>
        </div>

        {error ? (
          <div className="mb-6 rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger">
            {error}
          </div>
        ) : null}

        {reveal ? (
          <WebhookReveal
            devices={devices?.filter((device) => device.active) ?? []}
            reveal={reveal}
            onDismiss={() => setReveal(null)}
          />
        ) : null}

        {creating ? (
          <ServiceModal
            onCancel={() => setCreating(false)}
            onCreated={(response) => {
              setCreating(false);
              setReveal({ ...response, kind: "created" });
              void refresh();
            }}
          />
        ) : null}

        {editing ? (
          <ServiceModal
            service={editing}
            onCancel={() => setEditing(null)}
            onUpdated={() => {
              setEditing(null);
              void refresh();
            }}
          />
        ) : null}

        <ServiceList
          services={services}
          tokens={apiTokens}
          onEdit={setEditing}
          onRotated={(response) => {
            setReveal({ ...response, kind: "rotated" });
            void refresh();
          }}
          onDeleted={() => void refresh()}
          onTokenRevoked={(id) =>
            setApiTokens((current) => current?.filter((token) => token.id !== id) ?? current)
          }
        />

        <BrowserNotifications onChanged={() => void refresh()} />

        <Devices devices={devices} onRemoved={() => void refresh()} />

        <LiveActivities activities={liveActivities} />

        <ActivityLog events={events} onRefresh={refreshActivity} />
      </main>
    </div>
  );
}

function WebhookReveal({
  devices,
  reveal,
  onDismiss,
}: {
  devices: DeviceDto[];
  reveal: ServiceCreatedResponse & { kind: "created" | "rotated" };
  onDismiss: () => void;
}) {
  const [agentPromptCopied, setAgentPromptCopied] = useState(false);

  useEffect(() => {
    if (!agentPromptCopied) return;
    const timeout = window.setTimeout(() => setAgentPromptCopied(false), 1600);
    return () => window.clearTimeout(timeout);
  }, [agentPromptCopied]);

  const copyAgentPrompt = async () => {
    try {
      await navigator.clipboard.writeText(agentPrompt(reveal.webhookUrl, devices));
      setAgentPromptCopied(true);
    } catch {
      // Clipboard access can be unavailable outside a secure context.
    }
  };

  return (
    <section className="mb-10">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-accent-text text-sm font-semibold">
          {reveal.kind === "created"
            ? `“${reveal.service.title}” is ready`
            : `New webhook URL for “${reveal.service.title}”`}
        </h2>
        <button
          type="button"
          onClick={onDismiss}
          className="text-accent-text text-xs font-medium underline-offset-2 hover:underline"
        >
          Done
        </button>
      </div>
      <p className="text-accent-text mb-4 text-xs">
        This URL is encrypted at rest and remains available from your service's copy button.
      </p>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1">
          <CopyField label="Webhook URL" value={reveal.webhookUrl} />
        </div>
        <button
          type="button"
          onClick={copyAgentPrompt}
          className="bg-accent hover:bg-accent-hover shrink-0 self-start rounded-full px-4 py-2 text-sm font-medium text-on-accent transition sm:self-auto"
        >
          {agentPromptCopied ? "Agent prompt copied" : "Copy agent prompt"}
        </button>
      </div>
    </section>
  );
}

type BrowserNotificationState =
  | "checking"
  | "unsupported"
  | "default"
  | "denied"
  | "enabled"
  | "error";

export function BrowserNotifications({ onChanged = () => {} }: { onChanged?: () => void }) {
  const [state, setState] = useState<BrowserNotificationState>("checking");
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [busy, setBusy] = useState<"enable" | "test" | "disable" | null>(null);
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

    try {
      const current = await currentWebPushSubscription();
      if (current) {
        await api.registerWebPushSubscription(current.toJSON(), browserDeviceName());
        onChangedRef.current();
      }
      setSubscription(current);
      setState(current ? "enabled" : "default");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Could not check browser notifications.");
    }
  }, []);

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
      setError(err instanceof Error ? err.message : "Could not enable browser notifications.");
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
      setError(err instanceof Error ? err.message : "Could not send a test notification.");
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
      setError(err instanceof Error ? err.message : "Could not disable browser notifications.");
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
    <section className="mt-16" aria-labelledby="browser-notifications-heading">
      <div className="mb-4">
        <h2 id="browser-notifications-heading" className="text-lg font-semibold">
          This browser
        </h2>
        <p className="mt-1 text-sm text-ink-subtle">Desktop notifications</p>
      </div>
      <div className="rounded-2xl border border-line bg-surface px-5 py-4 shadow-xs">
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
                type="button"
                disabled={busy !== null}
                onClick={() => void enable()}
                className="bg-accent hover:bg-accent-hover rounded-full px-4 py-2 text-xs font-medium text-on-accent transition disabled:opacity-50"
              >
                {busy === "enable" ? "Enabling…" : "Enable notifications"}
              </button>
            ) : null}
            {state === "error" ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  setState("checking");
                  void inspect();
                }}
                className="rounded-full border border-line px-3.5 py-2 text-xs font-medium text-ink-muted transition hover:bg-surface-hover disabled:opacity-50"
              >
                Try again
              </button>
            ) : null}
            {state === "enabled" ? (
              <>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void sendTest()}
                  className="rounded-full border border-line px-3.5 py-2 text-xs font-medium text-ink-muted transition hover:bg-surface-hover disabled:opacity-50"
                >
                  {busy === "test" ? "Sending…" : "Send test"}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void disable()}
                  className="rounded-full border border-danger-line px-3.5 py-2 text-xs font-medium text-danger transition hover:bg-danger-soft disabled:opacity-50"
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

function Devices({ devices, onRemoved }: { devices: DeviceDto[] | null; onRemoved: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const remove = async (device: DeviceDto) => {
    const deviceLabel =
      device.deviceName ?? (device.platform === "web" ? "this browser" : "this iPhone");
    const confirmed = await confirm({
      title: "Remove device",
      message: `Remove ${deviceLabel} from SHark? It stops receiving notifications until it is registered again.`,
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!confirmed) return;
    setBusyId(device.id);
    setError(null);
    try {
      await api.removeDevice(device.id);
      onRemoved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove this device");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="mt-16" aria-labelledby="devices-heading">
      <div className="mb-4">
        <h2 id="devices-heading" className="text-lg font-semibold">
          Devices
        </h2>
        <p className="mt-1 text-sm text-ink-subtle">
          Omit <code className="font-mono text-xs text-ink-muted">deviceIds</code> to notify all
          active devices. Include IDs to route a webhook to specific devices.
        </p>
      </div>
      {devices === null ? <p className="py-6 text-sm text-ink-faint">Loading devices…</p> : null}
      {devices?.length === 0 ? (
        <p className="border-y border-line py-8 text-sm text-ink-faint">
          No devices registered yet.
        </p>
      ) : null}
      {devices && devices.length > 0 ? (
        <ul className="divide-y divide-line border-y border-line">
          {devices.map((device) => (
            <li className="flex items-center justify-between gap-4 py-3" key={device.id}>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {device.deviceName ?? (device.platform === "web" ? "Browser" : "iPhone")}
                  {!device.active ? (
                    <span className="ml-2 text-xs text-ink-faint">Inactive</span>
                  ) : null}
                </p>
                <p className="truncate font-mono text-[11px] text-ink-faint">{device.id}</p>
                <p className="mt-0.5 text-[11px] text-ink-faint">
                  {device.platform === "web"
                    ? `Web Push · refreshed ${new Date(device.lastSeenAt).toLocaleString()}`
                    : device.liveActivitiesCapable
                      ? `Live Activities ready · ${device.liveActivityTokenEnvironment} · refreshed ${new Date(
                          device.liveActivityTokenUpdatedAt ?? device.lastSeenAt,
                        ).toLocaleString()}`
                      : "Live Activities token not registered"}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(device.id)}
                  className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-surface-hover"
                >
                  Copy ID
                </button>
                <button
                  type="button"
                  disabled={busyId === device.id}
                  onClick={() => void remove(device)}
                  className="rounded-full border border-danger-line px-3 py-1.5 text-xs font-medium text-danger transition hover:bg-danger-soft disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}
      {dialog}
    </section>
  );
}

function relativeTime(iso: string): string {
  const deltaMinutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (deltaMinutes < 1) return "just now";
  if (deltaMinutes < 60) return `${deltaMinutes} minute${deltaMinutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(deltaMinutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function ServiceModal({
  service,
  onCancel,
  onCreated,
  onUpdated,
}: {
  service?: ServiceDto;
  onCancel: () => void;
  onCreated?: (response: ServiceCreatedResponse) => void;
  onUpdated?: (service: ServiceDto) => void;
}) {
  const [title, setTitle] = useState(service?.title ?? "");
  const [imageUrl, setImageUrl] = useState(service?.imageUrl ?? "");
  const [url, setUrl] = useState(service?.url ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(
    (afterClose: () => void = onCancel) => {
      if (closing) return;
      setClosing(true);
      window.setTimeout(afterClose, 120);
    },
    [closing, onCancel],
  );

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => titleInputRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [busy, close]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input = {
        title: title.trim(),
        imageUrl: imageUrl.trim() || null,
        url: url.trim() || null,
      };
      if (service) {
        const response = await api.updateService(service.id, input);
        close(() => onUpdated?.(response.service));
      } else {
        const response = await api.createService(input);
        close(() => onCreated?.(response));
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : `Could not ${service ? "update" : "create"} service`,
      );
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    "focus:border-accent w-full rounded-lg border border-line-strong bg-field px-3 py-2 text-base text-ink placeholder:text-ink-faint focus:outline-none sm:text-sm";

  return (
    <div className={`hark-modal-backdrop ${closing ? "is-closing" : ""}`}>
      <button
        aria-label={`Close ${service ? "edit" : "new"} service dialog`}
        className="hark-modal-dismiss"
        disabled={busy}
        onClick={() => close()}
        type="button"
      />
      <form
        aria-labelledby="service-form-title"
        aria-modal="true"
        className="hark-modal-panel"
        onSubmit={submit}
        role="dialog"
      >
        <div className="mb-6 flex items-start justify-between gap-6">
          <div>
            <h2 id="service-form-title" className="text-lg font-semibold">
              {service ? "Edit service" : "New service"}
            </h2>
            <p className="mt-1 text-sm text-ink-subtle">
              {service ? "Update this webhook's defaults." : "Set the defaults for this webhook."}
            </p>
          </div>
          <button
            aria-label="Close"
            className="grid size-9 shrink-0 place-items-center rounded-full text-xl leading-none text-ink-faint transition hover:bg-surface-hover hover:text-ink-muted"
            disabled={busy}
            onClick={() => close()}
            type="button"
          >
            ×
          </button>
        </div>
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-subtle">
              Title (sender name)
            </span>
            <input
              className={inputClass}
              ref={titleInputRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Acme CRM"
              maxLength={80}
              required
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-subtle">
              Avatar image URL <span className="font-normal">(optional)</span>
            </span>
            <input
              className={inputClass}
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://example.com/logo.png"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-subtle">
              Destination URL <span className="font-normal">(optional, opened on tap)</span>
            </span>
            <input
              className={inputClass}
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/dashboard"
            />
          </label>
        </div>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => close()}
            className="rounded-full px-4 py-2 text-sm font-medium text-ink-subtle transition hover:bg-surface-hover disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || title.trim().length === 0}
            className="bg-accent hover:bg-accent-hover rounded-full px-4 py-2 text-sm font-medium text-on-accent transition disabled:opacity-50"
          >
            {busy
              ? service
                ? "Saving…"
                : "Creating…"
              : service
                ? "Save changes"
                : "Create service"}
          </button>
        </div>
      </form>
    </div>
  );
}

function LiveActivities({ activities }: { activities: LiveActivityDto[] | null }) {
  if (activities === null || activities.length === 0) return null;
  return (
    <section className="mt-16" aria-labelledby="live-activities-heading">
      <h2 id="live-activities-heading" className="text-lg font-semibold">
        Live Activities
      </h2>
      <ul className="mt-4 divide-y divide-line border-y border-line">
        {activities.map((activity) => (
          <li className="flex items-center justify-between gap-4 py-3" key={activity.id}>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{activity.props.title}</p>
              <p className="truncate text-xs text-ink-subtle">{activity.props.status}</p>
            </div>
            <p className="shrink-0 font-mono text-[11px] text-ink-faint">
              seq {activity.sequence} · {activity.status}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ActivityLog({
  events,
  onRefresh,
}: {
  events: EventDto[] | null;
  onRefresh: () => Promise<void>;
}) {
  return (
    <section className="mt-16" aria-labelledby="activity-heading">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 id="activity-heading" className="text-lg font-semibold">
            Activity
          </h2>
          <p className="mt-1 text-sm text-ink-subtle">Latest webhook delivery attempts.</p>
        </div>
        <button
          type="button"
          onClick={() => void onRefresh()}
          className="rounded-full px-3 py-1.5 text-xs font-medium text-ink-subtle transition hover:bg-surface-hover hover:text-ink"
        >
          Refresh
        </button>
      </div>

      {events === null ? <p className="py-6 text-sm text-ink-faint">Loading activity…</p> : null}
      {events?.length === 0 ? (
        <p className="border-t border-line py-8 text-sm text-ink-faint">No webhook activity yet.</p>
      ) : null}
      {events && events.length > 0 ? (
        <ol className="divide-y divide-line border-y border-line">
          {events.map((activityEvent) => (
            <li className="flex gap-2.5 py-3" key={activityEvent.id}>
              <ActivityAvatar activityEvent={activityEvent} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-4">
                  <p className="truncate text-sm leading-5 font-medium">
                    {activityEvent.serviceTitle} · {activityEvent.title}
                  </p>
                  <time
                    className="shrink-0 text-xs text-ink-faint"
                    dateTime={activityEvent.createdAt}
                    title={new Date(activityEvent.createdAt).toLocaleString()}
                  >
                    {new Date(activityEvent.createdAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
                <p className="mt-0.5 truncate text-xs leading-4 text-ink-subtle">
                  {activityEvent.body}
                </p>
                <p className="mt-0.5 text-[11px] leading-4 text-ink-faint">
                  {activityLabel(activityEvent)}
                  {activityEvent.error ? ` · ${activityEvent.error}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "accepted" || status === "delivered"
      ? "bg-accent"
      : status === "failed"
        ? "bg-danger-strong"
        : status === "partial"
          ? "bg-warn"
          : status === "processing"
            ? "bg-info"
            : "bg-idle";
  return <span className={`${color} size-2 rounded-full`} aria-hidden="true" />;
}

function ActivityAvatar({ activityEvent }: { activityEvent: EventDto }) {
  return (
    <span className="relative size-8 shrink-0">
      {activityEvent.imageUrl ? (
        <img
          alt=""
          className="border-media-line size-8 rounded-full border object-cover"
          src={activityEvent.imageUrl}
        />
      ) : (
        <span className="bg-accent-soft text-accent-text grid size-8 place-items-center rounded-full text-xs font-medium">
          {activityEvent.serviceTitle.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="absolute -right-0.5 -bottom-0.5 grid size-3 place-items-center rounded-full bg-surface">
        <StatusDot status={activityEvent.status} />
      </span>
    </span>
  );
}

function activityLabel(activityEvent: EventDto): string {
  if (activityEvent.status === "accepted" || activityEvent.status === "delivered") {
    return `Accepted for ${activityEvent.deliveredCount} ${activityEvent.deliveredCount === 1 ? "device" : "devices"}`;
  }
  if (activityEvent.status === "partial") {
    return `Partially accepted for ${activityEvent.deliveredCount} devices`;
  }
  if (activityEvent.status === "no_devices") return "No active devices";
  if (activityEvent.status === "processing") return "Processing";
  return "Failed";
}

function ServiceList({
  services,
  tokens,
  onEdit,
  onRotated,
  onDeleted,
  onTokenRevoked,
}: {
  services: ServiceDto[] | null;
  tokens: ApiTokenDto[] | null;
  onEdit: (service: ServiceDto) => void;
  onRotated: (response: ServiceCreatedResponse) => void;
  onDeleted: () => void;
  onTokenRevoked: (id: string) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const activeTokens = tokens?.filter((token) => token.revokedAt === null) ?? [];

  if (services === null) {
    return <div className="py-12 text-center text-sm text-ink-faint">Loading…</div>;
  }
  if (services.length === 0 && activeTokens.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line-strong py-14 text-center">
        <p className="text-sm font-medium text-ink-muted">No services yet</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-ink-faint">
          Create your first service to get a secret webhook URL you can POST to from CI, cron jobs,
          or anything else.
        </p>
      </div>
    );
  }

  const revokeToken = async (token: ApiTokenDto) => {
    const confirmed = await confirm({
      title: "Revoke agent connection",
      message: `Revoke “${token.name}”? Its token stops working immediately and the agent must sign in again.`,
      confirmLabel: "Revoke",
      destructive: true,
    });
    if (!confirmed) return;
    setBusyId(token.id);
    setTokenError(null);
    try {
      await api.revokeApiToken(token.id);
      onTokenRevoked(token.id);
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : "Could not revoke this connection");
    } finally {
      setBusyId(null);
    }
  };

  const rotate = async (svc: ServiceDto) => {
    const confirmed = await confirm({
      title: "Rotate webhook token",
      message: `Rotate the webhook token for “${svc.title}”? The old URL stops working immediately.`,
      confirmLabel: "Rotate token",
    });
    if (!confirmed) return;
    setBusyId(svc.id);
    try {
      onRotated(await api.rotateServiceToken(svc.id));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (svc: ServiceDto) => {
    const confirmed = await confirm({
      title: "Delete service",
      message: `Delete “${svc.title}”? Its webhook URL stops working immediately and its activity history is removed.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    setBusyId(svc.id);
    try {
      await api.deleteService(svc.id);
      onDeleted();
    } finally {
      setBusyId(null);
    }
  };

  const copy = async (svc: ServiceDto) => {
    if (!svc.webhookUrl) return;
    try {
      await navigator.clipboard.writeText(svc.webhookUrl);
      setCopiedId(svc.id);
      window.setTimeout(
        () => setCopiedId((current) => (current === svc.id ? null : current)),
        1600,
      );
    } catch {
      // Clipboard access can be unavailable outside a secure context.
    }
  };

  return (
    <>
      <ul className="divide-y divide-line border-y border-line">
        {services.map((svc) => (
          <li key={svc.id} className="flex items-center gap-3 py-3">
            {svc.imageUrl ? (
              <img
                src={svc.imageUrl}
                alt=""
                className="border-media-line size-8 shrink-0 rounded-full border object-cover"
              />
            ) : (
              <div className="bg-accent flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-on-accent">
                {svc.title.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{svc.title}</p>
              <p className="truncate text-xs text-ink-faint">
                {svc.url ?? "No destination URL"} · created{" "}
                {new Date(svc.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={!svc.webhookUrl}
                title={
                  svc.webhookUrl
                    ? "Copy webhook URL"
                    : "Rotate this legacy token once to make its URL copyable"
                }
                onClick={() => void copy(svc)}
                className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:text-ink-disabled"
              >
                {copiedId === svc.id ? "Copied" : "Copy webhook"}
              </button>
              <button
                type="button"
                disabled={busyId === svc.id}
                onClick={() => onEdit(svc)}
                className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-surface-hover disabled:opacity-50"
              >
                Edit
              </button>
              <button
                type="button"
                disabled={busyId === svc.id}
                onClick={() => void rotate(svc)}
                className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-surface-hover disabled:opacity-50"
              >
                Rotate token
              </button>
              <button
                type="button"
                disabled={busyId === svc.id}
                onClick={() => void remove(svc)}
                className="rounded-full border border-danger-line px-3 py-1.5 text-xs font-medium text-danger transition hover:bg-danger-soft disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
        {activeTokens.map((token) => (
          <li key={token.id} className="flex items-center gap-3 py-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface-muted font-mono text-[11px] font-semibold text-accent-text">
              ❯_
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <span className="truncate">{token.name}</span>
                <span className="shrink-0 rounded-full border border-line bg-surface-muted px-2 py-0.5 text-[10px] font-medium leading-4 text-ink-muted">
                  Agent
                </span>
              </p>
              <p className="truncate text-xs text-ink-faint" title={token.scopes.join(", ")}>
                {token.prefix}… · {token.scopes.length}{" "}
                {token.scopes.length === 1 ? "scope" : "scopes"} · last used{" "}
                {token.lastUsedAt ? relativeTime(token.lastUsedAt) : "never"}
                {token.expiresAt
                  ? ` · expires ${new Date(token.expiresAt).toLocaleDateString()}`
                  : ""}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={busyId === token.id}
                onClick={() => void revokeToken(token)}
                className="rounded-full border border-danger-line px-3 py-1.5 text-xs font-medium text-danger transition hover:bg-danger-soft disabled:opacity-50"
              >
                Revoke
              </button>
            </div>
          </li>
        ))}
      </ul>
      {tokenError ? <p className="mt-3 text-xs text-danger">{tokenError}</p> : null}
      {dialog}
    </>
  );
}
