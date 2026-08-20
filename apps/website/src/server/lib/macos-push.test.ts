import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.BETTER_AUTH_SECRET = "m".repeat(32);

const apns = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("./apns", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./apns")>()),
  sendNotificationPush: apns.send,
}));

import { sendMacosPushNotifications } from "./macos-push";
import { encryptMacosApnsToken } from "./token";

function row(id: string, token: string, environment: "sandbox" | "production") {
  return {
    id,
    userId: "user_1",
    apnsTokenHash: id.repeat(64).slice(0, 64),
    apnsTokenCiphertext: encryptMacosApnsToken(token),
    environment,
    deviceName: "Mac",
    privacyMode: "standard",
    active: true,
    createdAt: new Date(),
    lastSeenAt: new Date(),
  };
}

describe("macOS APNs fanout", () => {
  beforeEach(() => apns.send.mockReset());

  it("decrypts per-device tokens and counts accepted and stale results", async () => {
    apns.send
      .mockResolvedValueOnce({ accepted: true, status: 200, reason: null, apnsId: "one" })
      .mockResolvedValueOnce({
        accepted: false,
        status: 410,
        reason: "Unregistered",
        apnsId: "two",
      });
    const result = await sendMacosPushNotifications(
      [row("a", "ab".repeat(32), "sandbox"), row("b", "cd".repeat(32), "production")],
      { title: "Build", body: "Finished", data: { eventId: "evt_1" } },
    );
    expect(apns.send).toHaveBeenNthCalledWith(
      1,
      "ab".repeat(32),
      "sandbox",
      expect.objectContaining({ title: "Build" }),
    );
    expect(result).toEqual({
      accepted: 1,
      errors: ["Unregistered"],
      staleMacosDeviceIds: ["b"],
    });
  });

  it("redacts private banners and removes quick actions", async () => {
    apns.send.mockResolvedValue({ accepted: true, status: 200, reason: null, apnsId: "one" });
    const privateDevice = { ...row("c", "ef".repeat(32), "sandbox"), privacyMode: "private" };

    await sendMacosPushNotifications([privateDevice], {
      title: "Secret deploy",
      body: "Approve production rollout?",
      category: "HARK_APPROVAL_V1",
      data: { interactionId: "int_1", actionDigest: "a".repeat(64) },
    });

    expect(apns.send).toHaveBeenCalledWith(
      "ef".repeat(32),
      "sandbox",
      expect.objectContaining({
        title: "SHark alert",
        body: "Open SHark to view details.",
      }),
    );
    expect(apns.send.mock.calls[0]?.[2]).not.toHaveProperty("category");
  });
});
