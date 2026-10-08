/**
 * API error semantics shared by the request layer and the screens. Pure and
 * React-Native-free so the classification logic is unit-testable.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /**
     * Machine-readable server code (e.g. `not_found`) when the response body
     * carried one. Old or self-hosted servers answer routes they lack with a
     * bare 404 and no structured body, so `code` stays undefined for them.
     */
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Builds the ApiError for a non-OK or unparsable response body. */
export function apiErrorFromBody(status: number, body: unknown): ApiError {
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const message = typeof record.error === "string" ? record.error : `Request failed (${status})`;
  const code = typeof record.code === "string" ? record.code : undefined;
  return new ApiError(message, status, code);
}

export type NotificationDetailFailure = "not_found" | "unsupported_server" | "transient";

/**
 * Distinguishes the three ways loading a notification detail can fail:
 *
 * - `not_found` — a modern server confirmed the notification is gone (404
 *   with the structured `not_found` code), so the deleted-item UX applies;
 * - `unsupported_server` — an older or self-hosted server without the inbox
 *   routes at all (a bare 404 with no code), so the caller should fall back
 *   to the legacy inbox instead of a dead-end "not found" screen;
 * - `transient` — anything else (network, 5xx, auth), worth retrying.
 */
export function classifyNotificationDetailFailure(error: unknown): NotificationDetailFailure {
  if (error instanceof ApiError && error.status === 404) {
    return error.code === "not_found" ? "not_found" : "unsupported_server";
  }
  return "transient";
}
