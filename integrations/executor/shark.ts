/** Small SHark agent API client. No framework imports so it can be unit-tested directly. */

export const SHARK_ORIGIN = "https://shark.shuv.dev";
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
  readonly method?: "GET" | "POST" | "PATCH";
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
    response = await call.fetch(`${call.origin ?? SHARK_ORIGIN}${call.path}`, {
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
    const allowed = new Set([
      "title",
      "status",
      "detail",
      "progress",
      "symbol",
      "privacyMode",
      "accentColor",
      "style",
      "deviceIds",
      "key",
      "replace",
      "expiresInSeconds",
      "staleAfterSeconds",
      "dismissAfterSeconds",
      "ifSequence",
    ]);
    if (Array.isArray(body?.issues)) {
      for (const issue of body.issues.slice(0, 10)) {
        if (
          issue &&
          typeof issue === "object" &&
          Array.isArray(issue.path) &&
          allowed.has(issue.path[0])
        ) {
          details.push(
            `Invalid ${issue.path[0]}: check the tool schema's allowed values and limits`,
          );
        }
      }
    }
    throw new SharkError(
      `SHark request failed (${response.status})${code ? `: ${code}` : ""}${hint(response.status)}${details.length ? `\n${details.join("\n")}` : ""}`,
      response.status,
      code,
    );
  }
  if (body === undefined)
    throw new SharkError("SHark returned a non-object response", response.status);
  return body;
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
