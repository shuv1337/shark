import { describe, expect, it } from "vitest";
import {
  createLiveActivityInteractionCredential,
  verifyLiveActivityInteractionCredential,
} from "./live-activity-interaction";

describe("Live Activity interaction credentials", () => {
  it("binds the credential to one interaction delivery, device, digest, and expiry", () => {
    const input = {
      interactionId: "int_1",
      deliveryId: "lad_1",
      deviceId: "dev_1",
      actionDigest: "a".repeat(64),
      expiresAt: new Date("2026-07-28T12:00:00.000Z"),
    };
    const credential = createLiveActivityInteractionCredential(input);
    expect(credential).toMatch(/^[a-zA-Z0-9_-]{43}$/);
    expect(verifyLiveActivityInteractionCredential(credential, input)).toBe(true);
    expect(
      verifyLiveActivityInteractionCredential(credential, { ...input, deviceId: "dev_2" }),
    ).toBe(false);
    expect(
      verifyLiveActivityInteractionCredential(credential, {
        ...input,
        expiresAt: new Date(input.expiresAt.getTime() + 1),
      }),
    ).toBe(false);
  });
});
