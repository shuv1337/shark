import { afterEach, describe, expect, it, vi } from "vitest";
import { attemptCallback } from "./callback-delivery";
import { outbound } from "./outbound";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("attemptCallback", () => {
  it("reports internal_error without connecting when the row has no callback", async () => {
    const resolve = vi.spyOn(outbound, "resolve");
    const request = vi.spyOn(outbound, "request");
    const payload = () => ({ type: "synthetic" });
    expect(
      await attemptCallback({ callbackUrl: null, callbackTokenCiphertext: "x", payload }),
    ).toEqual({ ok: false, error: "internal_error" });
    expect(
      await attemptCallback({
        callbackUrl: "https://callback.example.test/hook",
        callbackTokenCiphertext: null,
        payload,
      }),
    ).toEqual({ ok: false, error: "internal_error" });
    expect(resolve).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
});
