import { describe, expect, it } from "vitest";
import { sshuvHandoffRoute } from "./sshuv-handoff";

describe("SSHuv universal-link handoff", () => {
  const reference = "A".repeat(75);

  it("associates only the approved SSHuv app and namespace without redirecting", async () => {
    const response = await sshuvHandoffRoute.request("/.well-known/apple-app-site-association");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("location")).toBeNull();
    expect(await response.json()).toEqual({
      applinks: {
        details: [
          {
            appIDs: ["7H54B326YZ.dev.shuv.sshuv"],
            components: [{ "/": "/conversation/v1/*" }],
          },
        ],
      },
    });
  });

  it("serves a private fallback without echoing the reference or performing a redirect", async () => {
    const response = await sshuvHandoffRoute.request(`/conversation/v1/${reference}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    const body = await response.text();
    expect(body).toContain("Open this conversation in SSHuv");
    expect(body).not.toContain(reference);
    expect(body).not.toContain("<script");
    expect(body).not.toContain("<form");
  });

  it.each([
    `/conversation/v1/${reference}?command=approve`,
    `/conversation/v1/${reference}/extra`,
    `/conversation/v2/${reference}`,
    "/conversation/v1/raw-native-id",
    `/conversation/v1/${reference}=`,
  ])("rejects malformed destinations: %s", async (path) => {
    expect((await sshuvHandoffRoute.request(path)).status).toBe(404);
  });
});
