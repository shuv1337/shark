import { describe, expect, it } from "vitest";
import {
  apiTokenPrefix,
  decryptAppleRefreshToken,
  decryptLiveActivityToken,
  decryptMacosApnsToken,
  decryptWebhookToken,
  encryptAppleRefreshToken,
  encryptLiveActivityToken,
  encryptMacosApnsToken,
  encryptWebhookToken,
  generateApiToken,
  generateWebhookToken,
  hashApiToken,
  hashWebhookToken,
} from "./token";

describe("generateWebhookToken", () => {
  it("uses the whk_ prefix and base64url alphabet", () => {
    const token = generateWebhookToken();
    expect(token).toMatch(/^whk_[A-Za-z0-9_-]{32}$/);
  });

  it("is unique across generations", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateWebhookToken()));
    expect(tokens.size).toBe(500);
  });
});

describe("API tokens", () => {
  it("generates a high-entropy identified secret and stores a deterministic hash", () => {
    const token = generateApiToken();
    expect(token).toMatch(/^hark_[A-Za-z0-9_-]{43}$/);
    expect(apiTokenPrefix(token)).toBe(token.slice(0, 13));
    expect(hashApiToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashApiToken(token)).toBe(hashApiToken(token));
    expect(hashApiToken(`${token}x`)).not.toBe(hashApiToken(token));
  });
});

describe("hashWebhookToken", () => {
  it("is deterministic", () => {
    const token = generateWebhookToken();
    expect(hashWebhookToken(token)).toBe(hashWebhookToken(token));
  });

  it("produces a 64-char hex sha256 digest that differs from the token", () => {
    const token = generateWebhookToken();
    const hash = hashWebhookToken(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(token);
  });

  it("differs for different tokens", () => {
    expect(hashWebhookToken("whk_a")).not.toBe(hashWebhookToken("whk_b"));
  });
});

describe("webhook token encryption", () => {
  it("round-trips without storing the plaintext", () => {
    const token = generateWebhookToken();
    const encrypted = encryptWebhookToken(token);
    expect(encrypted).not.toContain(token);
    expect(decryptWebhookToken(encrypted)).toBe(token);
  });

  it("rejects modified ciphertext", () => {
    const encrypted = encryptWebhookToken(generateWebhookToken());
    // Values are base64url, so swap to a character the original cannot already be.
    const replacement = encrypted.endsWith("A") ? "B" : "A";
    expect(() => decryptWebhookToken(`${encrypted.slice(0, -1)}${replacement}`)).toThrow();
  });
});

describe("Live Activity token encryption", () => {
  it("round-trips in a separate encryption domain", () => {
    const token = "ab".repeat(32);
    const encrypted = encryptLiveActivityToken(token);
    expect(encrypted).not.toContain(token);
    expect(decryptLiveActivityToken(encrypted)).toBe(token);
    expect(() => decryptWebhookToken(encrypted)).toThrow();
  });
});

describe("macOS APNs token encryption", () => {
  it("round-trips in a separate encryption domain", () => {
    const token = "ab".repeat(32);
    const encrypted = encryptMacosApnsToken(token);
    expect(encrypted).not.toContain(token);
    expect(decryptMacosApnsToken(encrypted)).toBe(token);
    expect(() => decryptLiveActivityToken(encrypted)).toThrow();
  });
});

describe("Apple refresh token encryption", () => {
  it("round-trips in a dedicated encryption domain", () => {
    const token = "apple-refresh-token";
    const encrypted = encryptAppleRefreshToken(token);
    expect(encrypted).not.toContain(token);
    expect(decryptAppleRefreshToken(encrypted)).toBe(token);
    expect(() => decryptWebhookToken(encrypted)).toThrow();
  });
});
