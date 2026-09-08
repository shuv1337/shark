import {
  cancelInteraction,
  createInteraction,
  createNotification,
  getAuthStatus,
  getInteraction,
  listDevices,
} from "sharkctl/client";
import { BrokerError } from "./errors.mjs";

export const REQUIRED_SCOPES = [
  "notifications:send",
  "interactions:create",
  "interactions:read",
  "devices:read",
];
export function sharkClient(config, { timeout = 10_000 } = {}) {
  const options = () => ({ signal: AbortSignal.timeout(timeout) });
  return {
    auth: () => getAuthStatus(config, options()),
    devices: () => listDevices(config, options()),
    create: (kind, payload, key) =>
      (kind === "notification" ? createNotification : createInteraction)(config, payload, {
        ...options(),
        idempotencyKey: key,
      }),
    get: (id) => getInteraction(config, id, options()),
    cancel: (id) => cancelInteraction(config, id, options()),
  };
}
export function authIdentity(body) {
  if (
    body?.authenticated !== true ||
    typeof body.token?.id !== "string" ||
    !body.token.id ||
    body.token.id.length > 512 ||
    !Array.isArray(body.token.scopes) ||
    !REQUIRED_SCOPES.every((scope) => body.token.scopes.includes(scope))
  )
    throw new BrokerError(3, "broker_auth_or_scopes_unavailable");
  return body.token.id;
}
export function createFailure(error) {
  const status = error?.status;
  if (status === 401 || status === 403)
    return { state: "auth_blocked", code: 3, diagnostic: "shark_auth_rejected" };
  if (status === 409)
    return { state: "conflict", code: 1, diagnostic: "shark_idempotency_conflict" };
  if (status === 400 && error.body?.error === "Invalid device selection")
    return {
      state: "rejected",
      code: 1,
      diagnostic: "invalid_device_selection",
      replaceDevices: true,
    };
  if (status >= 400 && status < 500 && status !== 429)
    return { state: "rejected", code: 1, diagnostic: "shark_create_rejected" };
  return { state: "creating", code: 6, diagnostic: "shark_create_unknown" };
}
export function interaction(body, expectedID) {
  const value = body?.interaction;
  if (
    !value ||
    typeof value.id !== "string" ||
    !value.id ||
    (expectedID && value.id !== expectedID) ||
    !["pending", "replied", "approved", "denied", "yes", "no", "canceled", "expired"].includes(
      value.status,
    ) ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    !Number.isSafeInteger(value.accepted) ||
    value.accepted < 0 ||
    (value.status === "replied" &&
      (typeof value.response !== "string" || !value.response || value.response.length > 4000))
  )
    throw new BrokerError(6, "shark_response_invalid");
  return value;
}
