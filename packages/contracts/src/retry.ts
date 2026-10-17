/**
 * Bounded network calls: a per-attempt deadline owned by an AbortController
 * and a small, capped exponential backoff with full jitter that retries only
 * errors that are worth retrying. Use this instead of hand-rolled
 * setTimeout retry loops.
 */

/** A non-2xx response surfaced as an error so retry policy can see the status. */
export class HttpStatusError extends Error {
  readonly status: number;
  constructor(status: number, message = `HTTP ${status}`) {
    super(message);
    this.name = "HttpStatusError";
    this.status = status;
  }
}

export interface RetryOptions {
  /** Total attempts including the first. Default 3, clamped to 1..10. Non-finite values use the default. */
  attempts?: number;
  /** Deadline for each attempt in ms. Default 10_000. */
  timeoutMs?: number;
  /** First backoff ceiling in ms. Default 200. */
  baseDelayMs?: number;
  /** Largest backoff ceiling in ms. Default 2_000. */
  maxDelayMs?: number;
  /** Caller cancellation. Aborting it stops the current attempt and all retries. */
  signal?: AbortSignal;
  /** Which errors are retried. Default: isRetryableError. */
  isRetryable?: (error: unknown) => boolean;
  /** Injection points for tests. */
  random?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

// 429 is deliberately not retried: rate limits are surfaced to the caller.
const RETRYABLE_STATUS = new Set([408, 425, 500, 502, 503, 504]);

/** Timeouts, fetch transport failures, and 408/425/5xx (not 501). */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof HttpStatusError) return RETRYABLE_STATUS.has(error.status);
  if (error instanceof Error && error.name === "TimeoutError") return true;
  if (error instanceof TypeError) return isRetryableTypeError(error);
  return false;
}

/**
 * Node fetch rejects with TypeError "fetch failed". Browsers use "Failed to fetch".
 * Retry those only when there is no cause, or the cause is a network system code.
 * Node's internal and argument errors use ERR_* (ERR_INVALID_URL, and so on) and
 * are caller bugs. An unsupported scheme is "fetch failed" with a non-network cause.
 */
const NETWORK_CAUSE_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
]);

function causeCode(error: TypeError): string | undefined {
  const cause = error.cause;
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return undefined;
  return typeof cause.code === "string" && cause.code.length > 0 ? cause.code : undefined;
}

function isNetworkCauseCode(code: string): boolean {
  return code.startsWith("UND_ERR_") || NETWORK_CAUSE_CODES.has(code);
}

function isRetryableTypeError(error: TypeError): boolean {
  const code = causeCode(error);
  if (code?.startsWith("ERR_")) return false;
  if (code !== undefined && isNetworkCauseCode(code)) return true;
  if (error.cause != null) return false;
  return error.message === "fetch failed" || error.message === "Failed to fetch";
}

/** Full-jitter delay for a zero-based retry index, capped at maxDelayMs. */
export function backoffDelay(
  retry: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** retry);
  return Math.floor(random() * ceiling);
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal as AbortSignal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function startAttemptDeadline(
  timeoutMs: number,
  parent?: AbortSignal,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const onParentAbort = () => {
    controller.abort(abortError(parent as AbortSignal));
  };
  if (parent?.aborted) onParentAbort();
  else if (parent) parent.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => {
    controller.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
  }, timeoutMs);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    },
  };
}

/** Runs fn once with a deadline. fn must pass the signal to its I/O. */
export function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  return withRetry(fn, signal ? { attempts: 1, timeoutMs, signal } : { attempts: 1, timeoutMs });
}

/** Runs fn with a per-attempt deadline, retrying retryable failures. */
export async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const requestedAttempts = options.attempts ?? 3;
  const attempts = Math.min(
    10,
    Math.max(1, Math.floor(Number.isFinite(requestedAttempts) ? requestedAttempts : 3)),
  );
  const timeoutMs = options.timeoutMs ?? 10_000;
  const baseDelayMs = options.baseDelayMs ?? 200;
  const maxDelayMs = options.maxDelayMs ?? 2_000;
  const isRetryable = options.isRetryable ?? isRetryableError;
  const sleep = options.sleep ?? defaultSleep;
  const { signal } = options;

  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw abortError(signal);
    const deadline = startAttemptDeadline(timeoutMs, signal);
    try {
      return await fn(deadline.signal);
    } catch (error) {
      // A caller abort is never retried, whatever the error looks like.
      if (signal?.aborted) throw abortError(signal);
      if (attempt + 1 >= attempts || !isRetryable(error)) throw error;
    } finally {
      // Disarm once this attempt settles so a later body read is not aborted
      // and a parent abort does not keep a listener on a finished attempt.
      deadline.dispose();
    }
    await sleep(backoffDelay(attempt, baseDelayMs, maxDelayMs, options.random), signal);
  }
}
