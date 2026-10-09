import { getTestInstance } from "better-auth/test";
import { afterEach, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

const { env } = await import("../env");
const { CLIENT_IP_HEADER, trustedClientIp, withTrustedClientIp } = await import("./client-ip");

const headers = (values: Record<string, string>) => (name: string) =>
  values[name.toLowerCase()] ?? null;

afterEach(() => {
  env.TRUSTED_CLIENT_IP_HEADER = undefined;
  env.TRUSTED_FORWARDED_FOR_HOPS = 0;
});

describe("trusted client IP", () => {
  it("trusts nothing forwarded by default", () => {
    expect(trustedClientIp(headers({ "x-forwarded-for": "203.0.113.7" }))).toBeNull();
  });

  it("takes the entry the exe.dev hop appended, not a forged leftmost value", () => {
    const exeDev = { TRUSTED_CLIENT_IP_HEADER: undefined, TRUSTED_FORWARDED_FOR_HOPS: 1 };
    expect(trustedClientIp(headers({ "x-forwarded-for": "198.51.100.4" }), exeDev)).toBe(
      "198.51.100.4",
    );
    expect(
      trustedClientIp(headers({ "x-forwarded-for": "6.6.6.6, 10.0.0.1 ,198.51.100.4" }), exeDev),
    ).toBe("198.51.100.4");
    expect(trustedClientIp(headers({ "x-forwarded-for": "not-an-ip" }), exeDev)).toBeNull();
    expect(trustedClientIp(headers({}), exeDev)).toBeNull();
    expect(
      trustedClientIp(headers({ "x-forwarded-for": "198.51.100.4" }), {
        ...exeDev,
        TRUSTED_FORWARDED_FOR_HOPS: 2,
      }),
    ).toBeNull();
  });

  it("reads an overwriting edge header when one is configured", () => {
    expect(
      trustedClientIp(
        headers({ "cf-connecting-ip": "2001:db8::1", "x-forwarded-for": "6.6.6.6" }),
        {
          TRUSTED_CLIENT_IP_HEADER: "cf-connecting-ip",
          TRUSTED_FORWARDED_FOR_HOPS: 1,
        },
      ),
    ).toBe("2001:db8::1");
  });

  it("replaces a client-sent internal header and keeps the request body", async () => {
    const spoofed = new Request("http://localhost/api/auth/oauth2/register", {
      method: "POST",
      headers: { [CLIENT_IP_HEADER]: "6.6.6.6", "x-forwarded-for": "6.6.6.6, 198.51.100.4" },
      body: JSON.stringify({ client_name: "Synthetic" }),
    });
    const untrusted = withTrustedClientIp(spoofed.clone());
    expect(untrusted.headers.get(CLIENT_IP_HEADER)).toBeNull();
    expect(await untrusted.json()).toEqual({ client_name: "Synthetic" });

    env.TRUSTED_FORWARDED_FOR_HOPS = 1;
    expect(withTrustedClientIp(spoofed).headers.get(CLIENT_IP_HEADER)).toBe("198.51.100.4");
  });

  it("gives each exe.dev client its own Better Auth rate-limit bucket", async () => {
    env.TRUSTED_FORWARDED_FOR_HOPS = 1;
    const { auth } = await getTestInstance({
      rateLimit: {
        enabled: true,
        window: 60,
        max: 2,
        customRules: { "/sign-in/email": { window: 60, max: 2 } },
      },
      advanced: { ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] } },
    });
    const viaExeDev = (client: string) =>
      auth.handler(
        withTrustedClientIp(
          new Request("http://localhost:3000/api/auth/sign-in/email", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              // Each caller forges the same leftmost value; exe.dev appends the real peer.
              "x-forwarded-for": `6.6.6.6, ${client}`,
            },
            body: JSON.stringify({ email: "nobody@example.com", password: "synthetic-password" }),
          }),
        ),
      );
    const first = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      first.push((await viaExeDev("198.51.100.1")).status);
    }
    expect(first.at(-1)).toBe(429);
    expect((await viaExeDev("198.51.100.2")).status).not.toBe(429);
  });
});
