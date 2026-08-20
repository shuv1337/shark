import { createPrivateKey, sign } from "node:crypto";
import { connect } from "node:http2";
import type { LiveActivityProps } from "@hark/contracts";
import { LIVE_ACTIVITY_NAME } from "@hark/contracts";
import { env } from "../env";

const MAX_APNS_PAYLOAD_BYTES = 4096;
const JWT_TTL_SECONDS = 50 * 60;

export interface ApnsProviderConfig {
  keyId: string;
  teamId: string;
  privateKey: string;
  bundleId: string;
}

export type LiveActivityApnsEvent = "start" | "update" | "end";

export interface LiveActivityPayloadInput {
  event: LiveActivityApnsEvent;
  props: LiveActivityProps;
  timestamp: number;
  staleDate?: number;
  dismissalDate?: number;
  attributes?: {
    tokenRegistrationURL: string;
    tokenRegistrationToken: string;
    deliveryId: string;
    harkInteractionId?: string;
    harkInteractionCredential?: string;
    harkInteractionDeviceId?: string;
  };
}

export interface ApnsResult {
  status: number;
  apnsId: string | null;
  reason: string | null;
  accepted: boolean;
}

export interface NotificationPayloadInput {
  title: string;
  body: string;
  category?: string;
  threadId?: string;
  badge?: number;
  data?: Record<string, string>;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function normalizeApnsPrivateKey(value: string): string {
  const normalized = value.replace(/\\n/g, "\n").trim();
  if (normalized.includes("BEGIN PRIVATE KEY")) return normalized;
  const decoded = Buffer.from(normalized, "base64").toString("utf8").trim();
  if (!decoded.includes("BEGIN PRIVATE KEY")) {
    throw new Error("APNS_PRIVATE_KEY must be a PEM key or base64-encoded PEM key");
  }
  return decoded;
}

export function createApnsProviderJwt(
  config: Pick<ApnsProviderConfig, "keyId" | "teamId" | "privateKey">,
  issuedAt: number,
): string {
  const header = base64UrlJson({ alg: "ES256", kid: config.keyId });
  const claims = base64UrlJson({ iss: config.teamId, iat: issuedAt });
  const unsigned = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(unsigned), {
    key: createPrivateKey(normalizeApnsPrivateKey(config.privateKey)),
    dsaEncoding: "ieee-p1363",
  });
  return `${unsigned}.${signature.toString("base64url")}`;
}

export function buildLiveActivityPayload(input: LiveActivityPayloadInput): Record<string, unknown> {
  const aps: Record<string, unknown> = {
    timestamp: input.timestamp,
    event: input.event,
    "content-state": {
      name: LIVE_ACTIVITY_NAME,
      props: JSON.stringify(input.props),
    },
  };
  if (input.event === "start") {
    aps["attributes-type"] = "LiveActivityAttributes";
    aps.attributes = input.attributes ?? {};
    aps.alert = {
      title: input.props.privacyMode === "private" ? "Agent task started" : input.props.title,
      body:
        input.props.privacyMode === "private" ? "Open SHark to view progress." : input.props.status,
    };
    aps["input-push-token"] = 1;
  }
  if (input.staleDate !== undefined) aps["stale-date"] = input.staleDate;
  if (input.event === "end" && input.dismissalDate !== undefined) {
    aps["dismissal-date"] = input.dismissalDate;
  }
  return { aps };
}

export function encodeLiveActivityPayload(input: LiveActivityPayloadInput): Buffer {
  const payload = Buffer.from(JSON.stringify(buildLiveActivityPayload(input)));
  if (payload.byteLength > MAX_APNS_PAYLOAD_BYTES) {
    throw new Error(`Live Activity APNs payload exceeds ${MAX_APNS_PAYLOAD_BYTES} bytes`);
  }
  return payload;
}

export function buildNotificationPayload(input: NotificationPayloadInput): Record<string, unknown> {
  const aps: Record<string, unknown> = {
    alert: { title: input.title, body: input.body },
    sound: "default",
  };
  if (input.category) aps.category = input.category;
  if (input.threadId) aps["thread-id"] = input.threadId;
  if (input.badge !== undefined) aps.badge = input.badge;
  return { aps, ...(input.data ? { hark: input.data } : {}) };
}

function encodeNotificationPayload(input: NotificationPayloadInput): Buffer {
  const payload = Buffer.from(JSON.stringify(buildNotificationPayload(input)));
  if (payload.byteLength > MAX_APNS_PAYLOAD_BYTES) {
    throw new Error(`Notification APNs payload exceeds ${MAX_APNS_PAYLOAD_BYTES} bytes`);
  }
  return payload;
}

export function apnsHost(environment: "sandbox" | "production"): string {
  return environment === "production"
    ? "https://api.push.apple.com"
    : "https://api.sandbox.push.apple.com";
}

export function liveActivityHeaders(
  config: Pick<ApnsProviderConfig, "bundleId">,
  token: string,
  jwt: string,
  priority: 5 | 10,
): Record<string, string> {
  return {
    ":method": "POST",
    ":path": `/3/device/${token}`,
    authorization: `bearer ${jwt}`,
    "apns-push-type": "liveactivity",
    "apns-topic": `${config.bundleId}.push-type.liveactivity`,
    "apns-priority": String(priority),
  };
}

export function notificationHeaders(
  config: Pick<ApnsProviderConfig, "bundleId">,
  token: string,
  jwt: string,
): Record<string, string> {
  return {
    ":method": "POST",
    ":path": `/3/device/${token}`,
    authorization: `bearer ${jwt}`,
    "apns-push-type": "alert",
    "apns-topic": config.bundleId,
    "apns-priority": "10",
  };
}

export function isInvalidApnsTokenReason(reason: string | null): boolean {
  return (
    reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic" || reason === "Unregistered"
  );
}

const cachedJwts = new Map<string, { value: string; issuedAt: number }>();

function providerConfig(environment: "sandbox" | "production"): ApnsProviderConfig | null {
  const keyId = environment === "sandbox" ? env.APNS_SANDBOX_KEY_ID : env.APNS_KEY_ID;
  const privateKey =
    environment === "sandbox" ? env.APNS_SANDBOX_PRIVATE_KEY : env.APNS_PRIVATE_KEY;
  if (!keyId || !env.APPLE_TEAM_ID || !privateKey) return null;
  return {
    keyId,
    teamId: env.APPLE_TEAM_ID,
    privateKey,
    bundleId: env.APNS_BUNDLE_ID,
  };
}

function providerJwt(config: ApnsProviderConfig): string {
  const now = Math.floor(Date.now() / 1000);
  const cached = cachedJwts.get(config.keyId);
  if (cached && now - cached.issuedAt < JWT_TTL_SECONDS) return cached.value;
  const value = createApnsProviderJwt(config, now);
  cachedJwts.set(config.keyId, { value, issuedAt: now });
  return value;
}

async function sendApnsPayload(
  environment: "sandbox" | "production",
  headers: Record<string, string>,
  payload: Buffer,
): Promise<ApnsResult> {
  return new Promise<ApnsResult>((resolve) => {
    const client = connect(apnsHost(environment));
    let request: ReturnType<typeof client.request> | null = null;
    let settled = false;
    const finish = (result: ApnsResult) => {
      if (settled) return;
      settled = true;
      request?.close();
      client.close();
      client.destroy();
      resolve(result);
    };
    client.setTimeout(10_000, () =>
      finish({ status: 0, apnsId: null, reason: "Timeout", accepted: false }),
    );
    client.on("error", (error) =>
      finish({ status: 0, apnsId: null, reason: error.message, accepted: false }),
    );

    request = client.request(headers);
    let status = 0;
    let apnsId: string | null = null;
    const chunks: Buffer[] = [];
    request.on("response", (responseHeaders) => {
      status = Number(responseHeaders[":status"] ?? 0);
      apnsId = typeof responseHeaders["apns-id"] === "string" ? responseHeaders["apns-id"] : null;
    });
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", (error) =>
      finish({ status: 0, apnsId, reason: error.message, accepted: false }),
    );
    request.on("end", () => {
      let reason: string | null = null;
      if (chunks.length > 0) {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { reason?: unknown };
          if (typeof body.reason === "string") reason = body.reason;
        } catch {
          reason = "InvalidApnsResponse";
        }
      }
      finish({ status, apnsId, reason, accepted: status === 200 });
    });
    request.end(payload);
  });
}

export async function sendNotificationPush(
  token: string,
  tokenEnvironment: "sandbox" | "production",
  input: NotificationPayloadInput,
): Promise<ApnsResult> {
  const baseConfig = providerConfig(tokenEnvironment);
  if (!baseConfig) {
    return { status: 0, apnsId: null, reason: "ProviderNotConfigured", accepted: false };
  }
  const config = {
    ...baseConfig,
    bundleId: env.APNS_MACOS_BUNDLE_ID ?? "dev.shuv.shark.macos",
  };
  try {
    const jwt = providerJwt(config);
    return await sendApnsPayload(
      tokenEnvironment,
      notificationHeaders(config, token, jwt),
      encodeNotificationPayload(input),
    );
  } catch (error) {
    return {
      status: 0,
      apnsId: null,
      reason: error instanceof Error ? error.message : "InvalidProviderConfiguration",
      accepted: false,
    };
  }
}

export async function sendLiveActivityPush(
  token: string,
  tokenEnvironment: "sandbox" | "production",
  input: LiveActivityPayloadInput,
  priority: 5 | 10,
): Promise<ApnsResult> {
  const config = providerConfig(tokenEnvironment);
  if (!config) {
    return { status: 0, apnsId: null, reason: "ProviderNotConfigured", accepted: false };
  }
  let payload: Buffer;
  let jwt: string;
  try {
    payload = encodeLiveActivityPayload(input);
    jwt = providerJwt(config);
  } catch (error) {
    return {
      status: 0,
      apnsId: null,
      reason: error instanceof Error ? error.message : "InvalidProviderConfiguration",
      accepted: false,
    };
  }

  // Topic-specific APNs keys can be environment-scoped. Route both the
  // endpoint and provider credential from the signed device environment.
  return sendApnsPayload(
    tokenEnvironment,
    liveActivityHeaders(config, token, jwt, priority),
    payload,
  );
}
