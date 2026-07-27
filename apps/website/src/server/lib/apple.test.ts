import { symmetricEncrypt } from "better-auth/crypto";
import { decodeJwt, decodeProtectedHeader, exportPKCS8, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

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
