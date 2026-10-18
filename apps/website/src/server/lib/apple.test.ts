import { createServer } from "node:http";
import { symmetricEncrypt } from "better-auth/crypto";
import { decodeJwt, decodeProtectedHeader, exportPKCS8, generateKeyPair } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

let privateKey: string;
let apple: typeof import("./apple");

beforeAll(async () => {
  const keys = await generateKeyPair("ES256", { extractable: true });
  privateKey = await exportPKCS8(keys.privateKey);
  apple = await import("./apple");
});

describe("Apple client secrets", () => {
  it("generates a short-lived ES256 assertion for the exact client", async () => {
    const now = 1_800_000_000;
    const token = await apple.generateAppleClientSecret(
      "dev.shuv.shark.web",
      { teamId: "TEAM123", keyId: "KEY123", privateKey },
      now,
    );

    expect(decodeProtectedHeader(token)).toEqual({ alg: "ES256", kid: "KEY123" });
    expect(decodeJwt(token)).toMatchObject({
      iss: "TEAM123",
      sub: "dev.shuv.shark.web",
      aud: "https://appleid.apple.com",
      iat: now,
      exp: now + 300,
    });
  });

  it("accepts escaped and base64-encoded PEM without changing key material", () => {
    expect(apple.normalizeApplePrivateKey(privateKey.replace(/\n/g, "\\n"))).toBe(
      privateKey.trim(),
    );
    expect(apple.normalizeApplePrivateKey(Buffer.from(privateKey).toString("base64"))).toBe(
      privateKey.trim(),
    );
  });

  it("supports Apple's 180-day provider secret and rejects longer assertions", async () => {
    const now = 1_800_000_000;
    const config = { teamId: "TEAM123", keyId: "KEY123", privateKey };
    const token = await apple.generateAppleClientSecret(
      "dev.shuv.shark.web",
      config,
      now,
      180 * 24 * 60 * 60,
    );
    expect(decodeJwt(token).exp).toBe(now + 180 * 24 * 60 * 60);
    await expect(
      apple.generateAppleClientSecret("dev.shuv.shark.web", config, now, 180 * 24 * 60 * 60 + 1),
    ).rejects.toThrow("180 days");
  });

  it("decrypts Better Auth OAuth tokens while preserving migration-era plaintext", async () => {
    const { env } = await import("../env");
    const encrypted = await symmetricEncrypt({
      key: env.BETTER_AUTH_SECRET,
      data: "refresh-token",
    });
    await expect(apple.decryptBetterAuthOAuthToken(encrypted)).resolves.toBe("refresh-token");
    await expect(apple.decryptBetterAuthOAuthToken("plain-refresh-token")).resolves.toBe(
      "plain-refresh-token",
    );
  });
});

describe("Apple authorization code exchange", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("times out when headers arrive immediately and the body arrives after the deadline", async () => {
    let bodyTimer: ReturnType<typeof setTimeout> | undefined;
    const server = createServer((request, response) => {
      request.on("error", () => {});
      response.on("error", () => {});
      request.resume();
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"refresh_token":"synthetic-refresh","id_token":"');
      bodyTimer = setTimeout(() => {
        response.end('synthetic"}');
      }, apple.APPLE_TIMEOUT_MS + 5_000);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Apple token test server did not bind a TCP port");
    }
    const port = address.port;
    const realFetch = globalThis.fetch;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      target.protocol = "http:";
      target.host = `127.0.0.1:${port}`;
      return realFetch(target, init);
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const error: unknown = await apple
        .exchangeAppleAuthorizationCode(
          "synthetic-auth-code",
          "dev.shuv.shark",
          "synthetic-subject",
          {
            teamId: "TEAM123",
            keyId: "KEY123",
            privateKey,
          },
        )
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(DOMException);
      expect(error).toMatchObject({ name: "TimeoutError" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      if (bodyTimer) clearTimeout(bodyTimer);
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  }, 20_000);
});
