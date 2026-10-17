import type { ApiTokenDto, DeviceDto, ServiceCreatedResponse, ServiceDto } from "@hark/contracts";
import { useEffect, useState } from "react";
import { ApiRequestError, api } from "../lib/api";
import { offlineProps, useOffline } from "../lib/connection";
import {
  changedServiceFields,
  type ServiceFieldErrors,
  type ServiceFormValues,
  serviceFieldErrors,
} from "../lib/service-form";
import { useConfirm } from "./ConfirmDialog";
import { CopyField } from "./CopyField";
import {
  EmptyState,
  ErrorText,
  errorMessage,
  Field,
  INPUT,
  Modal,
  relativeTime,
  SECTION,
  SectionHeading,
  SkeletonList,
} from "./DashboardKit";
import { primaryButtonSmall, quietButton, rowButton, rowDangerButton, secondaryButton } from "./ui";

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

/**
 * Services and agent tokens: the two ways something outside SHark can send you
 * a notification. They share one list because they answer one question — what
 * currently has permission to reach my devices?
 */
export function ServicesSection({
  services,
  tokens,
  devices,
  onChanged,
  onTokenRevoked,
}: {
  services: ServiceDto[] | null;
  tokens: ApiTokenDto[] | null;
  devices: DeviceDto[] | null;
  onChanged: () => void;
  onTokenRevoked: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ServiceDto | null>(null);
  // Creating a service is a write; copying an existing webhook is not.
  const offline = useOffline();
  const [reveal, setReveal] = useState<
    (ServiceCreatedResponse & { kind: "created" | "rotated" }) | null
  >(null);
  const activeDevices = devices?.filter((device) => device.active) ?? [];
  const deliveryCount = devices === null ? null : activeDevices.length;

  return (
    <section aria-labelledby="services-heading" className={`${SECTION} scroll-mt-24`} id="services">
      <SectionHeading
        id="services-heading"
        title="Services and API tokens"
        description={
          deliveryCount === null
            ? "Each service gets a secret webhook URL."
            : deliveryCount === 0
              ? "No devices registered yet — enable this browser above, or sign in inside the SHark app."
              : `Delivering to ${deliveryCount} registered ${deliveryCount === 1 ? "device" : "devices"}.`
        }
        action={
          <button
            className={rowButton}
            onClick={() => setCreating(true)}
            type="button"
            {...offlineProps(offline)}
          >
            New service
          </button>
        }
      />

      {reveal ? (
        <WebhookReveal devices={activeDevices} onDismiss={() => setReveal(null)} reveal={reveal} />
      ) : null}

      {creating ? (
        <ServiceModal
          onCancel={() => setCreating(false)}
          onCreated={(response) => {
            setCreating(false);
            setReveal({ ...response, kind: "created" });
            onChanged();
          }}
        />
      ) : null}

      {editing ? (
        <ServiceModal
          onCancel={() => setEditing(null)}
          onUpdated={() => {
            setEditing(null);
            onChanged();
          }}
          service={editing}
        />
      ) : null}

      <ServiceList
        onDeleted={onChanged}
        onEdit={setEditing}
        onRotated={(response) => {
          setReveal({ ...response, kind: "rotated" });
          onChanged();
        }}
        onTokenRevoked={onTokenRevoked}
        services={services}
        tokens={tokens}
      />
    </section>
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
    <div className="mb-8 rounded-2xl border border-line bg-accent-wash px-5 py-4">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-accent-text">
          {reveal.kind === "created"
            ? `“${reveal.service.title}” is ready`
            : `New webhook URL for “${reveal.service.title}”`}
        </h3>
        <button className={`${quietButton} text-accent-text`} onClick={onDismiss} type="button">
          Done
        </button>
      </div>
      <p className="mb-4 text-xs text-accent-text">
        This URL is encrypted at rest and remains available from your service's copy button.
      </p>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1">
          <CopyField label="Webhook URL" value={reveal.webhookUrl} />
        </div>
        <button
          className={`${primaryButtonSmall} shrink-0 self-start sm:self-auto`}
          onClick={() => void copyAgentPrompt()}
          type="button"
        >
          {agentPromptCopied ? "Agent prompt copied" : "Copy agent prompt"}
        </button>
      </div>
    </div>
  );
}

function FieldError({ children }: { children?: string }) {
  if (!children) return null;
  return (
    <p className="mt-1.5 text-[13px] text-danger" role="alert">
      {children}
    </p>
  );
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
  const [fieldErrors, setFieldErrors] = useState<ServiceFieldErrors>({});
  const offline = useOffline();

  // Catches its own errors; the form fires and forgets it.
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const values: ServiceFormValues = { title, imageUrl, url };
      if (service) {
        const input = changedServiceFields(service, values);
        if (Object.keys(input).length === 0) {
          onCancel();
          return;
        }
        const response = await api.updateService(service.id, input);
        onUpdated?.(response.service);
      } else {
        const response = await api.createService({
          title: title.trim(),
          imageUrl: imageUrl.trim() || null,
          url: url.trim() || null,
        });
        onCreated?.(response);
      }
    } catch (err) {
      const nextFieldErrors =
        err instanceof ApiRequestError && err.status === 400 ? serviceFieldErrors(err.issues) : {};
      setFieldErrors(nextFieldErrors);
      setError(
        Object.keys(nextFieldErrors).length > 0
          ? "Please fix the errors below."
          : errorMessage(err, `Could not ${service ? "update" : "create"} service`),
      );
      setBusy(false);
    }
  };

  return (
    <Modal
      busy={busy}
      description={
        service ? "Update this webhook's defaults." : "Set the defaults for this webhook."
      }
      onClose={onCancel}
      onSubmit={(event) => void submit(event)}
      title={service ? "Edit service" : "New service"}
    >
      <div className="space-y-4">
        <div>
          <Field label="Title (sender name)">
            <input
              className={INPUT}
              data-autofocus
              maxLength={80}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Acme CRM"
              required
              value={title}
            />
          </Field>
          <FieldError>{fieldErrors.title}</FieldError>
        </div>
        <div>
          <Field
            label={
              <>
                Avatar image URL <span className="text-ink-faint">(optional)</span>
              </>
            }
          >
            <input
              className={INPUT}
              onChange={(event) => setImageUrl(event.target.value)}
              placeholder="https://example.com/logo.png"
              type="url"
              value={imageUrl}
            />
          </Field>
          <FieldError>{fieldErrors.imageUrl}</FieldError>
        </div>
        <div>
          <Field
            label={
              <>
                Destination URL <span className="text-ink-faint">(optional, opened on tap)</span>
              </>
            }
          >
            <input
              className={INPUT}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/inbox"
              type="url"
              value={url}
            />
          </Field>
          <FieldError>{fieldErrors.url}</FieldError>
        </div>
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="mt-6 flex justify-end gap-2">
        <button className={secondaryButton} disabled={busy} onClick={onCancel} type="button">
          Cancel
        </button>
        <button
          className={primaryButtonSmall}
          disabled={busy || title.trim().length === 0}
          type="submit"
          {...offlineProps(offline)}
        >
          {busy ? (service ? "Saving…" : "Creating…") : service ? "Save changes" : "Create service"}
        </button>
      </div>
    </Modal>
  );
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
  // Every control here writes to the server; none of them has an offline form.
  const offline = useOffline();

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const activeTokens = tokens?.filter((token) => token.revokedAt === null) ?? [];

  if (services === null) {
    return <SkeletonList label="Loading services" rowClassName="h-14" rows={3} />;
  }
  if (services.length === 0 && activeTokens.length === 0) {
    return (
      <EmptyState title="No services yet">
        A service is one sender: it gets a secret webhook URL you can POST to from CI, cron, or an
        agent, and its title and avatar become the notification's sender. Create your first one
        above.
      </EmptyState>
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
    setError(null);
    try {
      await api.revokeApiToken(token.id);
      onTokenRevoked(token.id);
    } catch (err) {
      setError(errorMessage(err, "Could not revoke this connection"));
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
    setError(null);
    try {
      onRotated(await api.rotateServiceToken(svc.id));
    } catch (err) {
      setError(errorMessage(err, "Could not rotate this token"));
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
    setError(null);
    try {
      await api.deleteService(svc.id);
      onDeleted();
    } catch (err) {
      setError(errorMessage(err, "Could not delete this service"));
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
          <li className="flex flex-wrap items-center gap-x-3 gap-y-2.5 py-3" key={svc.id}>
            {svc.imageUrl ? (
              <img
                alt=""
                className="border-media-line size-8 shrink-0 rounded-full border object-cover"
                src={svc.imageUrl}
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
                className={rowButton}
                disabled={!svc.webhookUrl}
                onClick={() => void copy(svc)}
                title={
                  svc.webhookUrl
                    ? "Copy webhook URL"
                    : "Rotate this legacy token once to make its URL copyable"
                }
                type="button"
              >
                {copiedId === svc.id ? "Copied" : "Copy webhook"}
              </button>
              <button
                className={rowButton}
                disabled={busyId === svc.id}
                onClick={() => onEdit(svc)}
                type="button"
                {...offlineProps(offline)}
              >
                Edit
              </button>
              <button
                className={rowButton}
                disabled={busyId === svc.id}
                onClick={() => void rotate(svc)}
                type="button"
                {...offlineProps(offline)}
              >
                Rotate token
              </button>
              <button
                className={rowDangerButton}
                disabled={busyId === svc.id}
                onClick={() => void remove(svc)}
                type="button"
                {...offlineProps(offline)}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
        {activeTokens.map((token) => (
          <li className="flex flex-wrap items-center gap-x-3 gap-y-2.5 py-3" key={token.id}>
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface-muted font-mono text-[11px] font-semibold text-accent-text">
              ❯_
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <span className="truncate">{token.name}</span>
                <span className="shrink-0 rounded-full border border-line bg-surface-muted px-2 py-0.5 text-[10px] leading-4 font-medium text-ink-muted">
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
                className={rowDangerButton}
                disabled={busyId === token.id}
                onClick={() => void revokeToken(token)}
                type="button"
                {...offlineProps(offline)}
              >
                Revoke
              </button>
            </div>
          </li>
        ))}
      </ul>
      <ErrorText>{error}</ErrorText>
      {dialog}
    </>
  );
}
