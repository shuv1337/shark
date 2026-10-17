import { describe, expect, it, vi } from "vitest";
import { backoffDelay, HttpStatusError, isRetryableError, withRetry, withTimeout } from "./retry";

const noSleep = vi.fn(async () => {});

describe("isRetryableError", () => {
  it("retries timeouts, network errors and transient statuses only", () => {
    expect(isRetryableError(new DOMException("t", "TimeoutError"))).toBe(true);
    expect(isRetryableError(new TypeError("fetch failed"))).toBe(true);
    for (const status of [408, 425, 500, 502, 503, 504]) {
      expect(isRetryableError(new HttpStatusError(status))).toBe(true);
    }
    for (const status of [400, 401, 403, 404, 409, 422, 429, 501]) {
      expect(isRetryableError(new HttpStatusError(status))).toBe(false);
    }
    expect(isRetryableError(new DOMException("a", "AbortError"))).toBe(false);
    expect(isRetryableError(new Error("boom"))).toBe(false);
  });
});

describe("backoffDelay", () => {
  it("grows exponentially, is capped, and jitters within the ceiling", () => {
    expect(backoffDelay(0, 100, 1000, () => 0.999)).toBe(99);
    expect(backoffDelay(3, 100, 1000, () => 0.999)).toBe(799);
    expect(backoffDelay(10, 100, 1000, () => 0.999)).toBe(999);
    expect(backoffDelay(5, 100, 1000, () => 0)).toBe(0);
  });
});

describe("withRetry", () => {
  it("returns the first success", async () => {
    const fn = vi.fn(async () => "ok");
    await expect(withRetry(fn, { sleep: noSleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries retryable errors up to the attempt bound", async () => {
    const fn = vi.fn(async () => {
      throw new HttpStatusError(503);
    });
    await expect(withRetry(fn, { attempts: 3, sleep: noSleep })).rejects.toMatchObject({
      status: 503,
    });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("recovers after a transient failure", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls === 1) throw new TypeError("fetch failed");
        return calls;
      },
      { sleep: noSleep },
    );
    expect(result).toBe(2);
  });

  it("does not retry non-retryable errors", async () => {
    const fn = vi.fn(async () => {
      throw new HttpStatusError(400);
    });
    await expect(withRetry(fn, { attempts: 5, sleep: noSleep })).rejects.toBeInstanceOf(
      HttpStatusError,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("aborts a hung attempt at the per-attempt deadline", async () => {
    const hang = (signal: AbortSignal) =>
      new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    await expect(withTimeout(hang, 20)).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("stops retrying once the caller aborts", async () => {
    const controller = new AbortController();
    const fn = vi.fn(async () => {
      controller.abort(new Error("caller gave up"));
      throw new TypeError("fetch failed");
    });
    await expect(
      withRetry(fn, { attempts: 5, signal: controller.signal, sleep: noSleep }),
    ).rejects.toThrow("caller gave up");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("clamps attempts to at least one", async () => {
    const fn = vi.fn(async () => {
      throw new TypeError("x");
    });
    await expect(withRetry(fn, { attempts: 0, sleep: noSleep })).rejects.toThrow("x");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
