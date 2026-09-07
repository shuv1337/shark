import { generateKeyPairSync, verify } from "node:crypto";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  connect: vi.fn(),
  env: {
    APNS_KEY_ID: "KEY123",
    APPLE_TEAM_ID: "TEAM123",
    APNS_PRIVATE_KEY: "",
    APNS_SANDBOX_KEY_ID: "DEVKEY123",
    APNS_SANDBOX_PRIVATE_KEY: "",
    APNS_BUNDLE_ID: "dev.shuv.shark",
    APNS_ENVIRONMENT: "sandbox" as const,
    BETTER_AUTH_SECRET: "synthetic-secret".repeat(3),
  },
}));

vi.mock("node:http2", () => ({ connect: transport.connect }));
vi.mock("../env", () => ({ env: transport.env }));

import {
  apnsHost,
  backgroundNotificationHeaders,
  buildLiveActivityPayload,
  buildNotificationPayload,
  buildSilentNotificationPayload,
  createApnsProviderJwt,
  encodeLiveActivityPayload,
  isInvalidApnsTokenReason,
  liveActivityHeaders,
  normalizeApnsPrivateKey,
  notificationHeaders,
  sendLiveActivityPush,
  sendNotificationPush,
  sendSilentNotificationPush,
} from "./apns";
import { sendMacosPushNotifications } from "./macos-push";
import { APNS_PAYLOAD_BYTE_LIMIT, pushJsonBytes } from "./push-preview";
import { encryptMacosApnsToken } from "./token";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
transport.env.APNS_PRIVATE_KEY = pem;
transport.env.APNS_SANDBOX_PRIVATE_KEY = pem;
const props = {
  schemaVersion: 1 as const,
  activityId: "act_1",
  title: "Release",
  status: "Building",
  progress: 0.5,
  updatedAt: "2026-07-23T12:00:00.000Z",
  symbol: "build" as const,
  privacyMode: "standard" as const,
};

describe("APNs provider authentication", () => {
  it("creates a verifiable ES256 JWT with a 64-byte JOSE signature", () => {
    const jwt = createApnsProviderJwt(
      { keyId: "KEY123", teamId: "TEAM123", privateKey: pem },
      1234,
    );
    const [header, claims, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header ?? "", "base64url").toString())).toEqual({
      alg: "ES256",
      kid: "KEY123",
    });
    expect(JSON.parse(Buffer.from(claims ?? "", "base64url").toString())).toEqual({
      iss: "TEAM123",
      iat: 1234,
    });
    expect(Buffer.from(signature ?? "", "base64url")).toHaveLength(64);
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${claims}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature ?? "", "base64url"),
      ),
    ).toBe(true);
    expect(normalizeApnsPrivateKey(Buffer.from(pem).toString("base64"))).toBe(pem.trim());
  });

  it("selects the correct host, topic, push type, and priority", () => {
    expect(apnsHost("sandbox")).toBe("https://api.sandbox.push.apple.com");
    expect(apnsHost("production")).toBe("https://api.push.apple.com");
    expect(liveActivityHeaders({ bundleId: "dev.shuv.shark" }, "abc", "jwt", 5)).toMatchObject({
      ":path": "/3/device/abc",
      "apns-push-type": "liveactivity",
      "apns-topic": "dev.shuv.shark.push-type.liveactivity",
      "apns-priority": "5",
    });
  });
});

describe("Live Activity APNs payloads", () => {
  it("builds the expo-widgets start content state exactly", () => {
    const payload = buildLiveActivityPayload({
      event: "start",
      props,
      timestamp: 100,
      staleDate: 200,
    });
    expect(payload).toEqual({
      aps: {
        timestamp: 100,
        event: "start",
        "content-state": { name: "HarkAgentActivity", props: JSON.stringify(props) },
        "attributes-type": "LiveActivityAttributes",
        attributes: {},
        alert: { title: "Release", body: "Building" },
        "input-push-token": 1,
        "stale-date": 200,
      },
    });
  });

  it("includes background token registration attributes on remote starts", () => {
    const attributes = {
      tokenRegistrationURL: "https://hark.example/api/live-activity/update-token",
      tokenRegistrationToken: "x".repeat(43),
      deliveryId: "lad_1",
    };
    expect(
      buildLiveActivityPayload({ event: "start", props, timestamp: 100, attributes }),
    ).toMatchObject({ aps: { event: "start", attributes } });
  });

  it("adds dismissal only to terminal payloads and enforces APNs size", () => {
    const end = buildLiveActivityPayload({
      event: "end",
      props,
      timestamp: 100,
      dismissalDate: 120,
    });
    expect(end).toMatchObject({ aps: { event: "end", "dismissal-date": 120 } });
    expect(() =>
      encodeLiveActivityPayload({
        event: "update",
        props: { ...props, detail: "x".repeat(5000) },
        timestamp: 100,
      }),
    ).toThrow(/4096/);
    expect(isInvalidApnsTokenReason("Unregistered")).toBe(true);
    expect(isInvalidApnsTokenReason("TooManyRequests")).toBe(false);
  });

  it("uses the token environment and cleans up the HTTP/2 client on timeout", async () => {
    const request = new EventEmitter() as EventEmitter & {
      close: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
    };
    request.close = vi.fn();
    request.end = vi.fn();
    const client = new EventEmitter() as EventEmitter & {
      close: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
      request: ReturnType<typeof vi.fn>;
      setTimeout: ReturnType<typeof vi.fn>;
    };
    let timeout: (() => void) | undefined;
    client.close = vi.fn();
    client.destroy = vi.fn();
    client.request = vi.fn(() => request);
    client.setTimeout = vi.fn((_milliseconds: number, callback: () => void) => {
      timeout = callback;
      return client;
    });
    transport.connect.mockReturnValue(client);

    const pending = sendLiveActivityPush(
      "aa".repeat(32),
      "production",
      {
        event: "update",
        props,
        timestamp: 100,
      },
      5,
    );
    expect(transport.connect).toHaveBeenCalledWith("https://api.push.apple.com");
    timeout?.();

    await expect(pending).resolves.toMatchObject({ accepted: false, reason: "Timeout" });
    expect(request.close).toHaveBeenCalledOnce();
    expect(client.close).toHaveBeenCalledOnce();
    expect(client.destroy).toHaveBeenCalledOnce();
  });

  it("signs sandbox delivery with the environment-scoped key", async () => {
    const request = new EventEmitter() as EventEmitter & {
      close: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
    };
    request.close = vi.fn();
    request.end = vi.fn();
    const client = new EventEmitter() as EventEmitter & {
      close: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
      request: ReturnType<typeof vi.fn>;
      setTimeout: ReturnType<typeof vi.fn>;
    };
    client.close = vi.fn();
    client.destroy = vi.fn();
    client.request = vi.fn(() => request);
    client.setTimeout = vi.fn(() => client);
    transport.connect.mockReturnValue(client);

    void sendLiveActivityPush(
      "aa".repeat(32),
      "sandbox",
      { event: "update", props, timestamp: 100 },
      5,
    );
    expect(transport.connect).toHaveBeenCalledWith("https://api.sandbox.push.apple.com");
    const headers = client.request.mock.calls.at(-1)?.[0] as Record<string, string>;
    const jwtHeader = headers.authorization?.slice("bearer ".length).split(".")[0] ?? "";
    expect(JSON.parse(Buffer.from(jwtHeader, "base64url").toString())).toMatchObject({
      kid: "DEVKEY123",
    });
  });
});

describe("macOS notification APNs payloads", () => {
  function captureTransport() {
    const payloads: Buffer[] = [];
    transport.connect.mockReset().mockImplementation(() => {
      const request = Object.assign(new EventEmitter(), {
        close: vi.fn(),
        end: (payload: Buffer) => {
          payloads.push(payload);
          queueMicrotask(() => {
            request.emit("response", { ":status": 200 });
            request.emit("end");
          });
        },
      });
      return Object.assign(new EventEmitter(), {
        close: vi.fn(),
        destroy: vi.fn(),
        setTimeout: vi.fn(),
        request: () => request,
      });
    });
    return payloads;
  }

  function macosRow(id: string, privacyMode: "private" | "standard") {
    return {
      id,
      userId: "synthetic-user",
      apnsTokenHash: `${id}-hash`,
      apnsTokenCiphertext: encryptMacosApnsToken("a".repeat(64)),
      environment: "sandbox",
      privacyMode,
      deviceName: "Mac",
      active: true,
      createdAt: new Date(),
      lastSeenAt: new Date(),
    };
  }

  it("builds a normal alert with native interaction metadata", () => {
    expect(
      buildNotificationPayload({
        title: "Deploy approval",
        body: "Ship release 42?",
        category: "HARK_APPROVAL_V1",
        threadId: "agent-release",
        badge: 2,
        data: {
          interactionId: "int_1",
          kind: "approval",
          actionDigest: "a".repeat(64),
        },
      }),
    ).toEqual({
      aps: {
        alert: { title: "Deploy approval", body: "Ship release 42?" },
        sound: "default",
        category: "HARK_APPROVAL_V1",
        "thread-id": "agent-release",
        badge: 2,
      },
      hark: {
        interactionId: "int_1",
        kind: "approval",
        actionDigest: "a".repeat(64),
      },
    });
  });

  it("uses the macOS bundle topic and alert push type", () => {
    expect(notificationHeaders({ bundleId: "dev.shuv.shark.macos" }, "abc", "jwt")).toMatchObject({
      ":path": "/3/device/abc",
      "apns-push-type": "alert",
      "apns-topic": "dev.shuv.shark.macos",
      "apns-priority": "10",
    });
  });

  it("builds a silent background withdrawal payload without an alert", () => {
    expect(
      buildSilentNotificationPayload({
        data: { v: 1, command: "notification.withdraw", eventId: "evt_1" },
      }),
    ).toEqual({
      aps: { "content-available": 1 },
      hark: { v: 1, command: "notification.withdraw", eventId: "evt_1" },
    });
    expect(
      backgroundNotificationHeaders({ bundleId: "dev.shuv.shark.macos" }, "abc", "jwt"),
    ).toMatchObject({
      "apns-push-type": "background",
      "apns-priority": "5",
    });
  });

  it("bounds the actual APNs envelope after per-device privacy redaction", async () => {
    const payloads = captureTransport();
    const input = {
      title: "\u0000".repeat(80),
      body: "気".repeat(2000),
      category: "HARK_APPROVAL_V1",
      threadId: "interaction-synthetic",
      badge: 3,
      data: {
        interactionId: "interaction-synthetic",
        eventId: "event-synthetic",
        kind: "approval",
        actionDigest: "a".repeat(64),
        url: `https://example.com/${"u".repeat(2028)}`,
      },
    };
    const saved = structuredClone(input);
    const result = await sendMacosPushNotifications(
      [macosRow("standard", "standard"), macosRow("private", "private")],
      input,
    );
    expect(result).toEqual({ accepted: 2, errors: [], staleMacosDeviceIds: [] });
    expect(payloads).toHaveLength(2);
    for (const payload of payloads)
      expect(payload.byteLength).toBeLessThanOrEqual(APNS_PAYLOAD_BYTE_LIMIT);
    const [standard, privatePreview] = payloads.map((payload) =>
      JSON.parse(payload.toString("utf8")),
    );
    expect(standard.aps.alert.title).toBe(input.title);
    expect(standard.aps.alert.body.endsWith("…")).toBe(true);
    expect(standard.aps).toMatchObject({
      category: input.category,
      "thread-id": input.threadId,
      badge: 3,
    });
    expect(standard.hark).toEqual(input.data);
    expect(privatePreview.aps.alert).toEqual({
      title: "SHark alert",
      body: "Open SHark to view details.",
    });
    expect(privatePreview.aps.category).toBeUndefined();
    expect(privatePreview.hark).toEqual(input.data);
    expect(input).toEqual(saved);
  });

  it("keeps an exact-limit APNs payload and drops an oversized optional URL whole", async () => {
    const payloads = captureTransport();
    const base = { title: "Title", body: "", data: { eventId: "event-synthetic" } };
    const exact = {
      ...base,
      body: "a".repeat(APNS_PAYLOAD_BYTE_LIMIT - pushJsonBytes(buildNotificationPayload(base))),
    };
    expect((await sendNotificationPush("a".repeat(64), "sandbox", exact)).accepted).toBe(true);
    expect(payloads[0]?.byteLength).toBe(APNS_PAYLOAD_BYTE_LIMIT);
    expect(JSON.parse(payloads[0]?.toString() ?? "{}")).toEqual(buildNotificationPayload(exact));

    const hugeUrl = {
      ...base,
      body: "Body",
      data: { ...base.data, url: `https://example.com/${"気".repeat(2028)}` },
    };
    await sendNotificationPush("a".repeat(64), "sandbox", hugeUrl);
    expect(JSON.parse(payloads[1]?.toString() ?? "{}")).toEqual({
      aps: { alert: { title: "Title", body: "Body" }, sound: "default" },
      hark: base.data,
    });
  });

  it("rejects oversized required metadata without network calls or stale-device classification", async () => {
    captureTransport();
    const result = await sendMacosPushNotifications([macosRow("synthetic", "standard")], {
      title: "Title",
      body: "Body",
      data: { actionDigest: "private".repeat(1000) },
    });
    expect(result).toEqual({
      accepted: 0,
      errors: ["Push payload metadata exceeds the 4096-byte budget"],
      staleMacosDeviceIds: [],
    });
    expect(transport.connect).not.toHaveBeenCalled();

    // Data-only lifecycle commands retain their existing strict encoder.
    const silent = await sendSilentNotificationPush("a".repeat(64), "sandbox", {
      data: { v: 1, command: "notification.withdraw", eventId: "private".repeat(1000) },
    });
    expect(silent).toMatchObject({
      accepted: false,
      reason: "Notification APNs payload exceeds 4096 bytes",
    });
    expect(transport.connect).not.toHaveBeenCalled();
  });
});
