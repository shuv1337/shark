import { getTestInstance } from "better-auth/test";
import { afterEach, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

const { env } = await import("../env");
const { CLIENT_IP_HEADER, trustedClientIp } = await import("./client-ip");
const { beginAppleWebSignIn } = await import("./web-sign-in");

afterEach(() => {
  env.TRUSTED_CLIENT_IP_HEADER = undefined;
  env.TRUSTED_FORWARDED_FOR_HOPS = 0;
});

describe("Apple web sign-in bootstrap", () => {
  it("returns an empty redirect while preserving Better Auth state cookies", async () => {
    const handler = vi.fn(
      async (_request: Request): Promise<Response> =>
        Response.json(
          {
            url: "https://appleid.apple.com/auth/authorize?client_id=dev.shuv.shark.web",
            redirect: true,
          },
          { headers: { "Set-Cookie": "better-auth.state=opaque; HttpOnly; Secure" } },
        ),
    );

    const response = await beginAppleWebSignIn(handler, "https://shark.shuv.dev");

    expect(handler).toHaveBeenCalledOnce();
    const request = handler.mock.calls[0]?.[0];
    expect(request?.method).toBe("POST");
    expect(request?.headers.get("origin")).toBe("https://shark.shuv.dev");
    expect(request?.headers.get(CLIENT_IP_HEADER)).toBeNull();
    expect(await request?.json()).toEqual({
      provider: "apple",
      callbackURL: "/dashboard",
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("https://appleid.apple.com/auth/authorize");
    expect(response.headers.get("set-cookie")).toContain("better-auth.state=opaque");
    expect(await response.text()).toBe("");
  });

  it("forwards the trusted client IP to Better Auth", async () => {
    const handler = vi.fn(async (_request: Request) => new Response(null, { status: 500 }));
    await beginAppleWebSignIn(handler, "https://shark.shuv.dev", "/dashboard", "198.51.100.4");
    expect(handler.mock.calls[0]?.[0].headers.get(CLIENT_IP_HEADER)).toBe("198.51.100.4");
  });

  it("gives each trusted client its own /sign-in rate-limit bucket", async () => {
    env.TRUSTED_FORWARDED_FOR_HOPS = 1;
    const { auth } = await getTestInstance({
      rateLimit: {
        enabled: true,
        window: 60,
        max: 100,
        customRules: { "/sign-in/social": { window: 60, max: 2 } },
      },
      advanced: { ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] } },
    });
    const statuses: number[] = [];
    const recording = async (request: Request) => {
      const response = await auth.handler(request);
      statuses.push(response.status);
      return response;
    };
    // What GET /login does with the incoming request's headers.
    const login = async (forwardedFor: string) => {
      const incoming = new Headers({ "x-forwarded-for": forwardedFor });
      await beginAppleWebSignIn(
        recording,
        "http://localhost:3000",
        "/dashboard",
        trustedClientIp((name) => incoming.get(name)),
      );
      return statuses.at(-1);
    };

    // A client rotating a forged leftmost entry stays in its own bucket.
    expect(await login("6.6.6.1, 198.51.100.1")).not.toBe(429);
    expect(await login("6.6.6.2, 198.51.100.1")).not.toBe(429);
    expect(await login("6.6.6.3, 198.51.100.1")).toBe(429);
    // Another client forging the same leftmost value is unaffected.
    expect(await login("6.6.6.3, 198.51.100.2")).not.toBe(429);
  });

  it("fails closed without anonymous content for invalid provider responses", async () => {
    for (const providerResponse of [
      Response.json({ url: "https://example.com/phish" }),
      Response.json({ redirect: true }),
      Response.json({ error: "unavailable" }, { status: 500 }),
    ]) {
      const response = await beginAppleWebSignIn(
        async () => providerResponse.clone(),
        "https://shark.shuv.dev",
      );
      expect(response.status).toBe(503);
      expect(await response.text()).toBe("");
    }
  });
});
