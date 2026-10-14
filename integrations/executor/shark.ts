/** Small SHark agent API client. No framework imports so it can be unit-tested directly. */

export const SHARK_ORIGIN = "https://shark.shuv.dev";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Production origin, unless `override` or `SHARK_ORIGIN` names another http(s)
 * origin. HTTP is limited to loopback so a local test server can be used
 * without sending the bearer token to an arbitrary cleartext host.
 */
export function resolveSharkOrigin(override?: string): string {
  const raw = (override ?? process.env.SHARK_ORIGIN)?.trim();
  if (!raw) return SHARK_ORIGIN;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SharkError(
      "SHARK_ORIGIN must be an http(s) origin with no path, query, or credentials",
      400,
      "invalid_input",
    );
  }
  const leftover = url.pathname !== "/" || url.search !== "" || url.hash !== "";
  if (url.username || url.password || leftover) {
    throw new SharkError(
      "SHARK_ORIGIN must be an http(s) origin with no path, query, or credentials",
      400,
      "invalid_input",
    );
  }
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) return url.origin;
  throw new SharkError("SHARK_ORIGIN must be https, or http on localhost", 400, "invalid_input");
}
export const TERMINAL_STATUSES = [
  "approved",
  "denied",
  "yes",
  "no",
  "replied",
  "canceled",
  "expired",
] as const;
export const ASK_KINDS = ["approval", "yes_no", "reply"] as const;
export const ACTIVITY_STYLES = ["standard", "ring", "hero", "terminal", "steps"] as const;
/** SHark's /wait endpoint holds a request for at most 25 seconds. */
export const MAX_WAIT_SECONDS = 25;
export const DEFAULT_WAIT_SECONDS = 20;
export const MAX_POLL_SECONDS = 20;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class SharkError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "SharkError";
    this.status = status;
    this.code = code;
  }
}

export interface SharkCall {
  readonly token: string;
  readonly path: string;
  readonly method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
  readonly fetch: FetchLike;
  readonly origin?: string;
}

const hint = (status: number): string => {
  if (status === 401)
    return " (SHark token missing, expired or revoked: reconnect the SHark account)";
  if (status === 403) return " (SHark token lacks the scope for this tool)";
  if (status === 429) return " (SHark rate limit: retry later with the same idempotency key)";
  return "";
};

/** Calls SHark and returns parsed JSON. Errors never include the token or raw response bodies. */
export async function sharkRequest(call: SharkCall): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${call.token}`,
    accept: "application/json",
  };
  if (call.body !== undefined) headers["content-type"] = "application/json";
  if (call.idempotencyKey !== undefined) headers["Idempotency-Key"] = call.idempotencyKey;
  let response: Response;
  try {
    response = await call.fetch(`${resolveSharkOrigin(call.origin)}${call.path}`, {
      method: call.method ?? "GET",
      headers,
      ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
      ...(call.signal === undefined ? {} : { signal: call.signal }),
    });
  } catch (error) {
    if (call.signal?.aborted) throw error;
    throw new SharkError("Network request to SHark failed", 0);
  }
  const parsed: unknown = await response.json().catch(() => undefined);
  const body =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  if (!response.ok) {
    const code =
      typeof body?.code === "string" && /^[A-Z_]{1,80}$/.test(body.code) ? body.code : undefined;
    const details: string[] = [];
    const serverError =
      typeof body?.error === "string" ? safeServerText(body.error, call.token) : undefined;
    if (code === "ACTIVE_ACTIVITY_CONFLICT") {
      if (
        typeof body?.activityId === "string" &&
        /^act_[a-zA-Z0-9_-]{1,100}$/.test(body.activityId)
      )
        details.push(`activityId=${body.activityId}`);
      if (typeof body?.ownedByRequester === "boolean")
        details.push(`ownedByRequester=${body.ownedByRequester}`);
      details.push(
        "The slot is device-wide; list/get are token-scoped. Wait, or explicitly choose replace=true. Never automatically replace.",
      );
    }
    if (response.status === 403) {
      const required = requiredScopes(body?.required);
      if (required) details.push(`required: ${required}`);
    }
    const retry = retryAfter(response, body);
    if (response.status === 429 && retry) details.push(`Retry-After: ${retry}`);
    const issues = sanitizeIssues(body?.issues, call.token);
    for (const issue of issues) details.push(`${issue.path}: ${issue.message}`);
    const headline = [`SHark request failed (${response.status})`, code, serverError]
      .filter((part) => part !== undefined)
      .join(": ");
    throw new SharkError(
      `${headline}${hint(response.status)}${details.length ? `\n${details.join("\n")}` : ""}`,
      response.status,
      code,
    );
  }
  if (body === undefined)
    throw new SharkError("SHark returned a non-object response", response.status);
  return body;
}

const SECRET_PATTERNS = [
  /\bhark_[A-Za-z0-9_-]{40,}/,
  /\/hooks\/whk_[A-Za-z0-9_-]{10,}/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/,
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/,
  /\bxox[abpres]-[A-Za-z0-9-]{10,}/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{32,}=*/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
];

export function looksLikeSecret(value: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

/** One line of server text, or undefined when it could carry a secret or the token. */
export function safeServerText(value: string, token: string): string | undefined {
  let collapsed = "";
  let skippingControls = false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) {
      skippingControls = true;
      continue;
    }
    if (skippingControls) {
      collapsed += " ";
      skippingControls = false;
    }
    collapsed += character;
  }
  const line = collapsed.trim();
  if (!line || line.length > 180) return undefined;
  if (token.length >= 8 && line.includes(token)) return undefined;
  if (looksLikeSecret(line)) return undefined;
  return line;
}

function requiredScopes(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const scopes = value.filter(
    (item): item is string => typeof item === "string" && /^[a-z]+:[a-z]+$/.test(item),
  );
  return scopes.length > 0 ? scopes.join(", ") : undefined;
}

function retryAfter(
  response: Response,
  body: Record<string, unknown> | undefined,
): string | undefined {
  const header = response.headers.get("retry-after")?.trim();
  if (header && /^\d{1,6}$/.test(header)) return header;
  const seconds = body?.retryAfterSeconds;
  if (
    typeof seconds === "number" &&
    Number.isInteger(seconds) &&
    seconds >= 0 &&
    seconds <= 86_400
  ) {
    return String(seconds);
  }
  return undefined;
}

function issuePath(path: unknown): string | undefined {
  if (!Array.isArray(path) || path.length === 0 || path.length > 6) return undefined;
  const parts: string[] = [];
  for (const segment of path) {
    if (typeof segment === "number" && Number.isInteger(segment) && segment >= 0 && segment < 100) {
      parts.push(String(segment));
      continue;
    }
    if (typeof segment === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(segment)) {
      parts.push(segment);
      continue;
    }
    return undefined;
  }
  return parts.join(".");
}

function sanitizeIssues(value: unknown, token: string): Array<{ path: string; message: string }> {
  if (!Array.isArray(value)) return [];
  const issues: Array<{ path: string; message: string }> = [];
  for (const issue of value.slice(0, 8)) {
    if (!issue || typeof issue !== "object") continue;
    const path = issuePath((issue as { path?: unknown }).path);
    const raw = (issue as { message?: unknown }).message;
    const message = typeof raw === "string" ? safeServerText(raw, token) : undefined;
    if (!path) continue;
    issues.push({
      path,
      message: message ?? "check the tool schema's allowed values and limits",
    });
  }
  return issues;
}

/** A per-bot name the server will accept: 1–60 characters, one line, no format characters. */
export function normalizeAgentDisplay(value: string): string {
  const trimmed = value.trim();
  const singleLine =
    trimmed.length >= 1 &&
    trimmed.length <= 60 &&
    ![...trimmed].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    }) &&
    !/\p{Cf}/u.test(trimmed);
  if (!singleLine) {
    throw new SharkError(
      "agentDisplay must be 1 to 60 characters on one line",
      400,
      "invalid_input",
    );
  }
  if (looksLikeSecret(trimmed)) {
    throw new SharkError(
      "Refusing to send content that looks like a credential",
      422,
      "invalid_input",
    );
  }
  return trimmed;
}

export function screenText(value: string | undefined): void {
  if (value !== undefined && looksLikeSecret(value)) {
    throw new SharkError(
      "Refusing to send content that looks like a credential",
      422,
      "invalid_input",
    );
  }
}

export const BODY_FORMATS = ["text", "markdown"] as const;

export function notificationPayload(input: {
  body: string;
  title?: string;
  imageUrl?: string;
  url?: string;
  deviceIds?: string[];
  project?: string;
  summary?: string;
  bodyFormat?: string;
  appId?: string;
  oncall?: string;
  agentDisplay?: string;
}): Record<string, unknown> {
  if (input.oncall !== undefined && input.deviceIds !== undefined && input.deviceIds.length > 0) {
    throw new SharkError("oncall cannot be combined with deviceIds", 400, "invalid_input");
  }
  if (
    input.bodyFormat !== undefined &&
    !(BODY_FORMATS as readonly string[]).includes(input.bodyFormat)
  ) {
    throw new SharkError("bodyFormat must be text or markdown", 400, "invalid_input");
  }
  screenText(input.body);
  screenText(input.title);
  screenText(input.summary);
  screenText(input.project);
  const agentDisplay =
    input.agentDisplay === undefined ? undefined : normalizeAgentDisplay(input.agentDisplay);
  return compact({
    body: input.body,
    title: input.title,
    imageUrl: input.imageUrl,
    url: input.url,
    deviceIds: input.deviceIds,
    project: input.project,
    summary: input.summary,
    bodyFormat: input.bodyFormat,
    appId: input.appId,
    oncall: input.oncall,
    agentDisplay,
  });
}

/** Drops undefined values so optional tool inputs are not sent as nulls. */
export function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function clampSeconds(
  value: number | undefined,
  fallback: number,
  max: number,
  min = 0,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function isTerminal(status: unknown): boolean {
  return typeof status === "string" && (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function oneOf<T extends string>(value: string, allowed: readonly T[], name: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new SharkError(`${name} must be one of: ${allowed.join(", ")}`, 400, "invalid_input");
  }
  return value as T;
}

export function checkProgress(value: number | undefined): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) {
    throw new SharkError("progress must be a number from 0 to 1", 400, "invalid_input");
  }
}

export function checkAccent(value: string | undefined): void {
  if (value !== undefined && !/^#[0-9A-Fa-f]{6}$/.test(value)) {
    throw new SharkError("accentColor must be #RRGGBB", 400, "invalid_input");
  }
}

export const segment = (value: string): string => encodeURIComponent(value);

/** One bounded long-poll. A timeout is not terminal: the interaction stays answerable until it expires. */
export async function waitOnce(
  base: Omit<SharkCall, "path" | "method" | "body" | "idempotencyKey">,
  id: string,
  seconds: number,
): Promise<{
  interaction: Record<string, unknown>;
  status: string;
  terminal: boolean;
  timedOut: boolean;
}> {
  const timeout = clampSeconds(seconds, DEFAULT_WAIT_SECONDS, MAX_WAIT_SECONDS, 1);
  const body = await sharkRequest({
    ...base,
    path: `/api/agent/interactions/${segment(id)}/wait?timeout=${timeout}`,
  });
  return summarize(body);
}

export function summarize(body: Record<string, unknown>) {
  const interaction = (body.interaction ?? body) as Record<string, unknown>;
  const status = typeof interaction.status === "string" ? interaction.status : "unknown";
  const terminal = isTerminal(status);
  return { interaction, status, terminal, timedOut: !terminal };
}
