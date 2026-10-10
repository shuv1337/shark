import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

export class RequestError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const TERMINAL_LIVE_ACTIVITY_STATUSES = new Set(["failed", "ended", "expired"]);

function terminalLiveActivityStatus(body) {
  if (body?.error !== "Live Activity is already terminal") return undefined;
  const candidates = [body.activity?.status, body.status];
  return candidates.find(
    (status) => typeof status === "string" && TERMINAL_LIVE_ACTIVITY_STATUSES.has(status),
  );
}

function requestErrorMessage(body) {
  const message = body.error ?? "Request failed";
  const status = terminalLiveActivityStatus(body);
  return status ? `${message} (${status})` : message;
}

// Unlike the interactive CLI loader, service credentials never come from the
// environment. Read through one descriptor so validation covers the file used.
export async function loadFileConfig(path, env = process.env) {
  if (typeof path !== "string" || !isAbsolute(path)) {
    throw new RequestError("An absolute protected config path is required.", 401);
  }
  if (env.HARK_CONFIG && resolve(env.HARK_CONFIG) !== resolve(path)) {
    throw new RequestError("HARK_CONFIG conflicts with the explicit config path.", 401);
  }
  let file;
  let parsed;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await file.stat();
    if (!info.isFile() || (info.mode & 0o777) !== 0o600 || info.size > 65_536) {
      throw new Error("invalid protected file");
    }
    parsed = JSON.parse(await file.readFile("utf8"));
  } catch {
    throw new RequestError(
      "Cannot read protected config; expected valid JSON in a mode-0600 file.",
      401,
    );
  } finally {
    await file?.close();
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof parsed.token !== "string" ||
    !/^hark_[A-Za-z0-9_-]{43}$/.test(parsed.token) ||
    typeof parsed.apiUrl !== "string"
  ) {
    throw new RequestError("Protected config requires a SHark token and API origin.", 401);
  }
  let origin;
  try {
    const url = new URL(parsed.apiUrl);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      !(url.protocol === "https:" || (url.protocol === "http:" && loopback)) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error("invalid origin");
    }
    origin = url.origin;
  } catch {
    throw new RequestError(
      "Protected config requires an HTTPS API origin (HTTP is allowed only on loopback).",
      401,
    );
  }
  return {
    token: parsed.token,
    apiUrl: origin,
    tokenId: typeof parsed.tokenId === "string" ? parsed.tokenId : undefined,
    source: "file",
    path,
  };
}

export async function request(config, path, init = {}) {
  let response;
  try {
    response = await fetch(`${String(config.apiUrl).replace(/\/$/, "")}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });
  } catch (error) {
    throw new RequestError(error instanceof Error ? error.message : "Network request failed", 0);
  }
  const body = await response
    .json()
    .catch(() => ({ error: `Request failed (${response.status})` }));
  if (!response.ok) throw new RequestError(requestErrorMessage(body), response.status, body);
  return body;
}

export async function publicRequest(apiUrl, path, init = {}) {
  let response;
  try {
    response = await fetch(`${String(apiUrl).replace(/\/$/, "")}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init.headers },
    });
  } catch (error) {
    throw new RequestError(error instanceof Error ? error.message : "Network request failed", 0);
  }
  const body = await response
    .json()
    .catch(() => ({ error: `Request failed (${response.status})` }));
  if (!response.ok) throw new RequestError(requestErrorMessage(body), response.status, body);
  return body;
}

function create(config, path, input, { idempotencyKey, signal } = {}) {
  return request(config, path, {
    method: "POST",
    body: JSON.stringify(input),
    headers: idempotencyKey === undefined ? {} : { "Idempotency-Key": idempotencyKey },
    signal,
  });
}

export function getAuthStatus(config, { signal } = {}) {
  return request(config, "/api/agent/auth/status", { signal });
}

export function listDevices(config, { signal } = {}) {
  return request(config, "/api/agent/devices", { signal });
}

export function createNotification(config, input, options) {
  return create(config, "/api/agent/notifications", input, options);
}

export function createInteraction(config, input, options) {
  return create(config, "/api/agent/interactions", input, options);
}

export function getInteraction(config, id, { signal } = {}) {
  return request(config, `/api/agent/interactions/${encodeURIComponent(id)}`, { signal });
}

export function cancelInteraction(config, id, { signal } = {}) {
  return request(config, `/api/agent/interactions/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    signal,
  });
}

/** Like {@link request}, but a 403 names the scopes the route requires and how to grant them. */
export async function scopedRequest(config, path, init) {
  try {
    return await request(config, path, init);
  } catch (error) {
    const required = error instanceof RequestError ? error.body?.required : undefined;
    if (error instanceof RequestError && error.status === 403 && Array.isArray(required)) {
      throw new RequestError(
        `${error.message}. Run sharkctl auth login --scope ... to grant ${required.join(", ")}.`,
        error.status,
        error.body,
      );
    }
    throw error;
  }
}
