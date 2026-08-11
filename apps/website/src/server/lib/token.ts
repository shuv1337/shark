import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../env";

const ENCRYPTION_VERSION = "v1";

type EncryptionPurpose =
  | "webhook-token"
  | "web-push-subscription"
  | "live-activity-token"
  | "callback-token"
  | "apple-refresh-token";

function encryptionKey(purpose: EncryptionPurpose): Buffer {
  return createHash("sha256")
    .update(`hark:${purpose}:v1\0`, "utf8")
    .update(env.BETTER_AUTH_SECRET, "utf8")
    .digest();
}

function encryptToken(token: string, purpose: EncryptionPurpose): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(purpose), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENCRYPTION_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function decryptToken(value: string, purpose: EncryptionPurpose): string {
  const [version, iv, tag, ciphertext, extra] = value.split(".");
  if (version !== ENCRYPTION_VERSION || !iv || !tag || !ciphertext || extra) {
    throw new Error("Invalid encrypted token");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(purpose),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Generates a webhook token with 192 bits of entropy. Its hash is the lookup
 * key; an encrypted copy allows the owner to recover the URL later.
 */
export function generateWebhookToken(): string {
  return `whk_${randomBytes(24).toString("base64url")}`;
}

/** Deterministic SHA-256 digest used as the stored lookup key for a token. */
export function hashWebhookToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Generates a non-recoverable agent token with 256 bits of entropy. */
export function generateApiToken(): string {
  return `hark_${randomBytes(32).toString("base64url")}`;
}

export function apiTokenPrefix(token: string): string {
  return token.slice(0, 13);
}

export function hashApiToken(token: string): string {
  return createHash("sha256").update("hark:api-token:v1\0", "utf8").update(token).digest("hex");
}

export const MAX_ACTIVE_API_TOKENS = 25;

/** Generates a 256-bit secret used only by a polling authorization client. */
export function generateDeviceCode(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDeviceCode(code: string): string {
  return createHash("sha256")
    .update("hark:device-authorization:v1\0", "utf8")
    .update(code, "utf8")
    .digest("hex");
}

/** Eight unambiguous base32 characters provide 40 bits for the short-lived human code. */
export function generateUserCode(): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = randomBytes(5);
  let bits = 0;
  let value = 0;
  let code = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      code += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return `${code.slice(0, 4)}-${code.slice(4, 8)}`;
}

/** Encrypts a token for owner-only recovery while keeping the hash as the lookup key. */
export function encryptWebhookToken(token: string): string {
  return encryptToken(token, "webhook-token");
}

/** Decrypts and authenticates a stored token. Throws if the value was modified. */
export function decryptWebhookToken(value: string): string {
  return decryptToken(value, "webhook-token");
}

export function hashWebPushEndpoint(endpoint: string): string {
  return createHash("sha256")
    .update("hark:web-push-endpoint:v1\0", "utf8")
    .update(endpoint, "utf8")
    .digest("hex");
}

export function encryptWebPushSubscription(subscription: string): string {
  return encryptToken(subscription, "web-push-subscription");
}

export function decryptWebPushSubscription(value: string): string {
  return decryptToken(value, "web-push-subscription");
}

/** Encrypts ActivityKit tokens separately from recoverable webhook secrets. */
export function encryptLiveActivityToken(token: string): string {
  return encryptToken(token, "live-activity-token");
}

export function decryptLiveActivityToken(value: string): string {
  return decryptToken(value, "live-activity-token");
}

export function encryptCallbackToken(token: string): string {
  return encryptToken(token, "callback-token");
}

export function decryptCallbackToken(value: string): string {
  return decryptToken(value, "callback-token");
}

export function encryptAppleRefreshToken(token: string): string {
  return encryptToken(token, "apple-refresh-token");
}

export function decryptAppleRefreshToken(value: string): string {
  return decryptToken(value, "apple-refresh-token");
}

export function hashAppleAuthorizationCode(code: string): string {
  return createHash("sha256")
    .update("hark:apple-authorization-code:v1\0", "utf8")
    .update(code, "utf8")
    .digest("hex");
}

export function generateInteractionResponseToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInteractionResponseToken(token: string): string {
  return createHash("sha256")
    .update("hark:interaction-response:v1\0", "utf8")
    .update(token, "utf8")
    .digest("hex");
}
