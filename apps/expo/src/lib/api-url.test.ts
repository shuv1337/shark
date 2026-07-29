import { describe, expect, it } from "vitest";
import { resolveApiUrl } from "./api-url";

describe("resolveApiUrl", () => {
  it("uses an explicitly configured API URL", () => {
    expect(resolveApiUrl(" https://example.test ", false)).toBe("https://example.test");
  });

  it("uses localhost only for development builds", () => {
    expect(resolveApiUrl(undefined, true)).toBe("http://localhost:8787");
  });

  it("uses production for release builds without EAS environment variables", () => {
    expect(resolveApiUrl(undefined, false)).toBe("https://shark.shuv.dev");
  });
});
