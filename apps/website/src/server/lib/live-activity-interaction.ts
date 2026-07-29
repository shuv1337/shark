import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env";

interface CredentialInput {
  interactionId: string;
  deliveryId: string;
  deviceId: string;
  actionDigest: string;
  expiresAt: Date;
}

function interactionCredential(input: CredentialInput): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update("hark:live-activity-interaction:v1\0", "utf8")
    .update(input.interactionId, "utf8")
    .update("\0", "utf8")
    .update(input.deliveryId, "utf8")
    .update("\0", "utf8")
    .update(input.deviceId, "utf8")
    .update("\0", "utf8")
    .update(input.actionDigest, "utf8")
    .update("\0", "utf8")
    .update(String(input.expiresAt.getTime()), "utf8")
    .digest("base64url");
}

export function createLiveActivityInteractionCredential(input: CredentialInput): string {
  return interactionCredential(input);
}

export function verifyLiveActivityInteractionCredential(
  supplied: string,
  input: CredentialInput,
): boolean {
  const expected = interactionCredential(input);
  const suppliedBytes = Buffer.from(supplied, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes)
  );
}
