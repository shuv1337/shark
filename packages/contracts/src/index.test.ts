import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  API_TOKEN_SCOPE_DESCRIPTIONS,
  API_TOKEN_SCOPES,
  agentNotificationCreateSchema,
  appCreateSchema,
  appIdSchema,
  appleNativeTokenExchangeSchema,
  appOrigin,
  appUrlSchema,
  boardAskUpsertSchema,
  deviceRegisterSchema,
  findBoardSecret,
  inboxMarkAllReadSchema,
  interactionCreateSchema,
  interactionResponseSchema,
  isInboxItemActive,
  isInboxItemDeliveryFailure,
  isInboxItemWithdrawn,
  LIVE_ACTIVITY_END_FIELDS,
  LIVE_ACTIVITY_SCHEMA_VERSION,
  LIVE_ACTIVITY_UPDATE_FIELDS,
  liveActivityBackgroundTokenSchema,
  liveActivityEndSchema,
  liveActivityPropsSchema,
  liveActivityRequestDiagnostic,
  liveActivityStartSchema,
  liveActivityStateDiagnostic,
  liveActivityUpdateSchema,
  macosDeviceRegisterSchema,
  macosInteractionResponseSchema,
  NATIVE_COMPANION_SCOPES,
  NOTIFICATION_BODY_MAX_CHARS,
  normalizeProjectName,
  OAUTH_DEFAULT_SCOPES,
  OAUTH_HIGH_IMPACT_SCOPES,
  OAUTH_SCOPES,
  pushDataSchema,
  serviceCreateSchema,
  truncateToUtf8Bytes,
  utf8ByteLength,
  webhookRequestSchema,
  webPushSubscriptionRegisterSchema,
} from "./index";

describe("inbox lifecycle semantics", () => {
  it("distinguishes active partial activities from terminal partial notifications", () => {
    expect(isInboxItemActive({ kind: "live_activity", status: "partial" })).toBe(true);
    expect(isInboxItemDeliveryFailure({ kind: "live_activity", status: "partial" })).toBe(false);
    expect(isInboxItemActive({ kind: "notification", status: "partial" })).toBe(false);
    expect(isInboxItemDeliveryFailure({ kind: "notification", status: "partial" })).toBe(true);
    expect(isInboxItemActive({ kind: "notification", status: "withdrawn" })).toBe(false);
    expect(isInboxItemActive({ kind: "notification", status: "withdraw_partial" })).toBe(false);
    expect(isInboxItemDeliveryFailure({ kind: "notification", status: "withdrawn" })).toBe(false);
    expect(isInboxItemDeliveryFailure({ kind: "notification", status: "withdraw_partial" })).toBe(
      false,
    );
    expect(isInboxItemWithdrawn({ status: "withdrawn" })).toBe(true);
    expect(isInboxItemWithdrawn({ status: "withdraw_partial" })).toBe(true);
    expect(isInboxItemWithdrawn({ status: "partial" })).toBe(false);
  });
});

describe("appleNativeTokenExchangeSchema", () => {
  it("requires both bounded Apple credentials", () => {
    expect(
      appleNativeTokenExchangeSchema.safeParse({
        authorizationCode: "single-use-code",
        identityToken: "identity-token",
      }).success,
    ).toBe(true);
    expect(appleNativeTokenExchangeSchema.safeParse({ authorizationCode: "code" }).success).toBe(
      false,
    );
    expect(
      appleNativeTokenExchangeSchema.safeParse({
        authorizationCode: "x".repeat(4097),
        identityToken: "token",
      }).success,
    ).toBe(false);
  });
});

describe("webhookRequestSchema", () => {
  it("accepts a minimal payload", () => {
    const result = webhookRequestSchema.safeParse({ body: "Deploy finished" });
    expect(result.success).toBe(true);
  });

  it("rejects a missing body", () => {
    expect(webhookRequestSchema.safeParse({}).success).toBe(false);
    expect(webhookRequestSchema.safeParse({ body: "" }).success).toBe(false);
    expect(webhookRequestSchema.safeParse({ body: "   " }).success).toBe(false);
  });

  it("rejects invalid URLs", () => {
    expect(webhookRequestSchema.safeParse({ body: "x", imageUrl: "not-a-url" }).success).toBe(
      false,
    );
    expect(webhookRequestSchema.safeParse({ body: "x", url: "also nope" }).success).toBe(false);
  });

  it("only accepts public HTTPS image URLs", () => {
    expect(
      webhookRequestSchema.safeParse({ body: "x", imageUrl: "http://example.com/a.png" }).success,
    ).toBe(false);
    expect(
      webhookRequestSchema.safeParse({ body: "x", imageUrl: "https://127.0.0.1/a.png" }).success,
    ).toBe(false);
    expect(
      webhookRequestSchema.safeParse({ body: "x", imageUrl: "https://192.168.1.8/a.png" }).success,
    ).toBe(false);
    expect(
      webhookRequestSchema.safeParse({ body: "x", imageUrl: "https://example.com/a.png" }).success,
    ).toBe(true);
  });

  it("only accepts http and https tap destinations", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      "hark://open",
    ]) {
      expect(webhookRequestSchema.safeParse({ body: "x", url }).success).toBe(false);
    }
    expect(webhookRequestSchema.safeParse({ body: "x", url: "http://example.com" }).success).toBe(
      true,
    );
    expect(webhookRequestSchema.safeParse({ body: "x", url: "https://example.com" }).success).toBe(
      true,
    );
  });

  it("rejects image URLs on mapped and carrier-grade private ranges", () => {
    for (const imageUrl of [
      "https://[::ffff:127.0.0.1]/a.png",
      "https://100.64.0.1/a.png",
      "https://192.0.0.1/a.png",
      "https://198.18.0.1/a.png",
    ]) {
      expect(webhookRequestSchema.safeParse({ body: "x", imageUrl }).success).toBe(false);
    }
  });

  it("accepts full overrides", () => {
    const result = webhookRequestSchema.safeParse({
      body: "3 new sign-ups",
      title: "Acme CRM",
      imageUrl: "https://example.com/logo.png",
      url: "https://example.com/dashboard",
    });
    expect(result.success).toBe(true);
  });

  it("normalizes device routing targets for stable idempotency", () => {
    const result = webhookRequestSchema.safeParse({
      body: "Targeted",
      deviceIds: ["dev_b", "dev_a", "dev_b"],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.deviceIds).toEqual(["dev_a", "dev_b"]);
  });

  it("rejects an empty device routing list", () => {
    expect(webhookRequestSchema.safeParse({ body: "Targeted", deviceIds: [] }).success).toBe(false);
  });

  it("accepts the raised body capacity while enforcing the UTF-8 byte cap", () => {
    expect(
      webhookRequestSchema.safeParse({ body: "x".repeat(NOTIFICATION_BODY_MAX_CHARS) }).success,
    ).toBe(true);
    expect(
      webhookRequestSchema.safeParse({ body: "x".repeat(NOTIFICATION_BODY_MAX_CHARS + 1) }).success,
    ).toBe(false);
    // 6,000 characters of a 3-byte glyph is 18,000 bytes: over the byte cap.
    expect(webhookRequestSchema.safeParse({ body: "気".repeat(6_000) }).success).toBe(false);
    expect(webhookRequestSchema.safeParse({ body: "気".repeat(5_000) }).success).toBe(true);
  });

  it("keeps interactive bodies within the unchanged prompt limit", () => {
    const long = "x".repeat(2_001);
    expect(webhookRequestSchema.safeParse({ body: long }).success).toBe(true);
    expect(
      webhookRequestSchema.safeParse({ body: long, response: { type: "approval" } }).success,
    ).toBe(false);
    expect(
      webhookRequestSchema.safeParse({
        body: "x".repeat(2_000),
        response: { type: "approval" },
      }).success,
    ).toBe(true);
  });

  it("accepts optional project, summary, and bodyFormat metadata", () => {
    const result = webhookRequestSchema.safeParse({
      body: "Deploy finished",
      project: "Acme App",
      summary: "Deploy finished",
      bodyFormat: "markdown",
    });
    expect(result.success).toBe(true);
    expect(webhookRequestSchema.safeParse({ body: "x", bodyFormat: "html" }).success).toBe(false);
    expect(webhookRequestSchema.safeParse({ body: "x", project: "" }).success).toBe(false);
    expect(webhookRequestSchema.safeParse({ body: "x", project: "a\nb" }).success).toBe(false);
    expect(webhookRequestSchema.safeParse({ body: "x", project: "p".repeat(81) }).success).toBe(
      false,
    );
    expect(webhookRequestSchema.safeParse({ body: "x", summary: "s".repeat(501) }).success).toBe(
      false,
    );
  });

  it("accepts fixed interactive response types and validates callbacks", () => {
    expect(
      webhookRequestSchema.parse({
        body: "Deploy?",
        response: {
          type: "approval",
          callback: { url: "https://ci.example.com/hark", token: "x".repeat(32) },
        },
      }).response,
    ).toMatchObject({ type: "approval", expiresInSeconds: 900 });
    expect(
      webhookRequestSchema.safeParse({ body: "Reply?", response: { type: "text" } }).success,
    ).toBe(true);
    expect(
      webhookRequestSchema.safeParse({ body: "No", response: { type: "custom" } }).success,
    ).toBe(false);
    expect(
      webhookRequestSchema.safeParse({
        body: "No",
        response: {
          type: "yes_no",
          callback: { url: "http://localhost/callback", token: "x".repeat(32) },
        },
      }).success,
    ).toBe(false);
  });
});

describe("agentNotificationCreateSchema", () => {
  it("defaults the title and normalizes device targets", () => {
    const result = agentNotificationCreateSchema.safeParse({
      body: "Deploy finished",
      deviceIds: ["dev_b", "dev_a", "dev_b"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("SHark");
      expect(result.data.deviceIds).toEqual(["dev_a", "dev_b"]);
    }
  });

  it("only accepts public HTTPS image URLs and web tap URLs", () => {
    expect(agentNotificationCreateSchema.safeParse({ body: "" }).success).toBe(false);
    expect(
      agentNotificationCreateSchema.safeParse({ body: "x", imageUrl: "http://example.com/a.png" })
        .success,
    ).toBe(false);
    expect(
      agentNotificationCreateSchema.safeParse({ body: "x", imageUrl: "https://localhost/a.png" })
        .success,
    ).toBe(false);
    expect(
      agentNotificationCreateSchema.safeParse({ body: "x", url: "javascript:alert(1)" }).success,
    ).toBe(false);
    expect(
      agentNotificationCreateSchema.safeParse({
        body: "x",
        imageUrl: "https://example.com/a.png",
        url: "https://example.com/run",
      }).success,
    ).toBe(true);
  });
});

describe("interaction schemas", () => {
  it("normalizes targets and supplies a conservative expiry", () => {
    const result = interactionCreateSchema.safeParse({
      title: "Release",
      prompt: "Deploy?",
      kind: "approval",
      deviceIds: ["dev_b", "dev_a", "dev_b"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deviceIds).toEqual(["dev_a", "dev_b"]);
      expect(result.data.expiresInSeconds).toBe(900);
      expect(result.data.presentation).toBeUndefined();
    }
  });

  it("validates interactive Live Activity requests and cosmetic labels", () => {
    const valid = interactionCreateSchema.safeParse({
      title: "Release",
      prompt: "Send the prepared release email?",
      kind: "approval",
      presentation: "live_activity",
      primaryLabel: "Send",
      secondaryLabel: "Deny",
      expiresInSeconds: 900,
    });
    expect(valid.success).toBe(true);
    for (const invalid of [
      {
        title: "Reply",
        prompt: "Type a response",
        kind: "reply",
        presentation: "live_activity",
      },
      {
        title: "Release",
        prompt: "Deploy?",
        kind: "approval",
        primaryLabel: "Deploy",
      },
      {
        title: "Release",
        prompt: "Deploy?",
        kind: "approval",
        presentation: "live_activity",
        expiresInSeconds: 28_801,
      },
      {
        title: "Release",
        prompt: "x".repeat(241),
        kind: "approval",
        presentation: "live_activity",
      },
      {
        title: "Release",
        prompt: "Deploy?",
        kind: "approval",
        presentation: "live_activity",
        primaryLabel: "Deploy\nnow",
      },
    ]) {
      expect(interactionCreateSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("accepts only public HTTPS interaction images", () => {
    expect(
      interactionCreateSchema.safeParse({
        title: "Release",
        prompt: "Deploy?",
        kind: "approval",
        imageUrl: "https://example.com/avatar.png",
      }).success,
    ).toBe(true);
    expect(
      interactionCreateSchema.safeParse({
        title: "Release",
        prompt: "Deploy?",
        kind: "approval",
        imageUrl: "https://10.0.0.2/avatar.png",
      }).success,
    ).toBe(false);
  });

  it("requires text only for reply actions", () => {
    const actionDigest = "a".repeat(64);
    expect(
      interactionResponseSchema.safeParse({ action: "approve", deviceId: "dev_1", actionDigest })
        .success,
    ).toBe(true);
    expect(
      interactionResponseSchema.safeParse({
        action: "reply",
        response: "",
        deviceId: "dev_1",
        actionDigest,
      }).success,
    ).toBe(false);
    expect(
      interactionResponseSchema.safeParse({
        action: "reply",
        response: "Ship tomorrow",
        deviceId: "dev_1",
        actionDigest,
      }).success,
    ).toBe(true);
  });
});

describe("Live Activity schemas", () => {
  it("accepts the fixed compatibility schema and bounds progress", () => {
    const props = {
      schemaVersion: LIVE_ACTIVITY_SCHEMA_VERSION,
      activityId: "act_1",
      title: "Build release",
      status: "Running tests",
      detail: "Workspace checks",
      progress: 0.42,
      updatedAt: new Date().toISOString(),
      symbol: "build",
      privacyMode: "standard",
    };
    expect(liveActivityPropsSchema.safeParse(props).success).toBe(true);
    expect(liveActivityPropsSchema.safeParse({ ...props, progress: 1.01 }).success).toBe(false);
    expect(liveActivityPropsSchema.safeParse({ ...props, schemaVersion: 2 }).success).toBe(false);
  });

  it("keeps style optional in props but defaulted on start", () => {
    const props = {
      schemaVersion: LIVE_ACTIVITY_SCHEMA_VERSION,
      activityId: "act_1",
      title: "Build release",
      status: "Running tests",
      updatedAt: new Date().toISOString(),
      symbol: "build",
      privacyMode: "standard",
    };
    // Payloads written before the field existed must keep validating.
    expect(liveActivityPropsSchema.safeParse(props).success).toBe(true);
    expect(liveActivityPropsSchema.safeParse({ ...props, style: "ring" }).success).toBe(true);
    expect(liveActivityPropsSchema.safeParse({ ...props, style: "neon" }).success).toBe(false);
    expect(liveActivityPropsSchema.safeParse({ ...props, style: "approval" }).success).toBe(false);
    expect(
      liveActivityPropsSchema.safeParse({
        ...props,
        style: "approval",
        interaction: {
          id: "int_1",
          kind: "approval",
          prompt: "Deploy?",
          primaryLabel: "Deploy",
          secondaryLabel: "Deny",
          primaryAction: "approve",
          secondaryAction: "deny",
          state: "pending",
        },
      }).success,
    ).toBe(true);
    expect(
      liveActivityPropsSchema.safeParse({
        ...props,
        style: "approval",
        interaction: {
          id: "int_1",
          kind: "approval",
          prompt: "Deploy?",
          primaryLabel: "Deploy",
          secondaryLabel: "Deny",
          primaryAction: "yes",
          secondaryAction: "no",
          state: "pending",
        },
      }).success,
    ).toBe(false);

    expect(liveActivityStartSchema.parse({ title: "Task", status: "Starting" }).style).toBe(
      "standard",
    );
    expect(
      liveActivityStartSchema.parse({ title: "Task", status: "Starting", style: "hero" }).style,
    ).toBe("hero");
    expect(
      liveActivityStartSchema.safeParse({ title: "Task", status: "Starting", style: "neon" })
        .success,
    ).toBe(false);

    // Updates accept a style change and it counts as a meaningful field.
    expect(liveActivityUpdateSchema.safeParse({ style: "steps" }).success).toBe(true);
    expect(liveActivityUpdateSchema.safeParse({ style: "approval" }).success).toBe(false);
    expect(liveActivityUpdateSchema.safeParse({ style: "neon" }).success).toBe(false);
    expect(liveActivityUpdateSchema.parse({ style: "terminal" }).style).toBe("terminal");
  });

  it("normalizes start targets and requires a meaningful update", () => {
    const start = liveActivityStartSchema.parse({
      title: "Task",
      status: "Starting",
      deviceIds: ["dev_b", "dev_a", "dev_b"],
    });
    expect(start.deviceIds).toEqual(["dev_a", "dev_b"]);
    expect(start).toMatchObject({
      accentColor: "#D35C46",
      expiresInSeconds: 28_800,
      staleAfterSeconds: 14_400,
      replace: false,
    });
    expect(
      liveActivityStartSchema.safeParse({
        title: "Task",
        status: "Starting",
        accentColor: "#aBc123",
      }).success,
    ).toBe(true);
    for (const accentColor of ["D35C46", "#fff", "#D35C46CC", "#GGGGGG"]) {
      expect(
        liveActivityStartSchema.safeParse({ title: "Task", status: "Starting", accentColor })
          .success,
      ).toBe(false);
    }
    expect(liveActivityUpdateSchema.safeParse({ ifSequence: 0 }).success).toBe(false);
    expect(liveActivityUpdateSchema.safeParse({ status: "Testing" }).success).toBe(true);
    expect(liveActivityUpdateSchema.safeParse({ progress: null, ifSequence: 2 }).success).toBe(
      true,
    );
    const progress = liveActivityUpdateSchema.safeParse({
      progress: "0.7",
      activity: { status: "partial" },
    });
    expect(progress.success).toBe(false);
    if (!progress.success) {
      expect(
        liveActivityRequestDiagnostic(
          progress.error.issues,
          { progress: "0.7", activity: { status: "partial" } },
          LIVE_ACTIVITY_UPDATE_FIELDS,
        ),
      ).toBe(
        "rejected field progress: Invalid input: expected number, received string; rejected field activity: unrecognized",
      );
    }
    const empty = liveActivityUpdateSchema.safeParse({});
    expect(empty.success).toBe(false);
    if (!empty.success) {
      expect(
        liveActivityRequestDiagnostic(empty.error.issues, {}, LIVE_ACTIVITY_UPDATE_FIELDS),
      ).toContain("status");
    }
    expect(LIVE_ACTIVITY_UPDATE_FIELDS).toContain("status");
    expect(LIVE_ACTIVITY_END_FIELDS).toContain("dismissAfterSeconds");
    expect(liveActivityStateDiagnostic("ended")).toBe("rejected state: ended");
    expect(liveActivityStateDiagnostic("partial")).toBe("rejected state: partial");
    expect(liveActivityEndSchema.parse({}).dismissAfterSeconds).toBe(0);
  });

  it("validates background update-token registration", () => {
    const input = {
      deliveryId: "lad_1",
      registrationToken: "a".repeat(43),
      nativeActivityId: "native_1",
      updateToken: "ab".repeat(32),
    };
    expect(liveActivityBackgroundTokenSchema.safeParse(input).success).toBe(true);
    expect(
      liveActivityBackgroundTokenSchema.safeParse({ ...input, registrationToken: "short" }).success,
    ).toBe(false);
  });
});

describe("serviceCreateSchema", () => {
  it("requires a title", () => {
    expect(serviceCreateSchema.safeParse({}).success).toBe(false);
    expect(serviceCreateSchema.safeParse({ title: "CI Alerts" }).success).toBe(true);
  });

  it("allows nullable optional fields", () => {
    const result = serviceCreateSchema.safeParse({ title: "CI", imageUrl: null, url: null });
    expect(result.success).toBe(true);
  });
});

describe("deviceRegisterSchema", () => {
  it("constrains platform to ios", () => {
    expect(
      deviceRegisterSchema.safeParse({ expoPushToken: "ExponentPushToken[x]", platform: "ios" })
        .success,
    ).toBe(true);
    expect(
      deviceRegisterSchema.safeParse({
        expoPushToken: "ExponentPushToken[x]",
        platform: "android",
      }).success,
    ).toBe(false);
  });
});

describe("macOS companion contracts", () => {
  it("accepts variable-length APNs registrations and rejects malformed tokens", () => {
    expect(
      macosDeviceRegisterSchema.safeParse({
        apnsToken: "ab".repeat(32),
        environment: "sandbox",
        deviceName: "Shuvbot",
      }).success,
    ).toBe(true);
    expect(
      macosDeviceRegisterSchema.safeParse({
        apnsToken: "cd".repeat(40),
        environment: "production",
      }).success,
    ).toBe(true);
    expect(
      macosDeviceRegisterSchema.safeParse({
        apnsToken: "not-a-token",
        environment: "production",
      }).success,
    ).toBe(false);
    expect(
      macosDeviceRegisterSchema.safeParse({
        apnsToken: "abc",
        environment: "production",
      }).success,
    ).toBe(false);
  });

  it("supports native approval, yes/no, and bounded text replies", () => {
    const digest = "a".repeat(64);
    expect(
      macosInteractionResponseSchema.safeParse({ action: "approve", actionDigest: digest }).success,
    ).toBe(true);
    expect(
      macosInteractionResponseSchema.safeParse({
        action: "reply",
        actionDigest: digest,
        response: "Ship it",
      }).success,
    ).toBe(true);
    expect(
      macosInteractionResponseSchema.safeParse({
        action: "reply",
        actionDigest: digest,
        response: " ",
      }).success,
    ).toBe(false);
  });
});

describe("webPushSubscriptionRegisterSchema", () => {
  it("requires an endpoint and both browser subscription keys", () => {
    expect(
      webPushSubscriptionRegisterSchema.safeParse({
        subscription: {
          endpoint: "https://push.example.com/send/abc",
          expirationTime: null,
          keys: { p256dh: "public-key", auth: "auth-secret" },
        },
        deviceName: "Linux Firefox",
      }).success,
    ).toBe(true);
    expect(
      webPushSubscriptionRegisterSchema.safeParse({
        subscription: {
          endpoint: "https://push.example.com/send/abc",
          keys: { p256dh: "public-key" },
        },
      }).success,
    ).toBe(false);
  });
});

describe("pushDataSchema", () => {
  it("round-trips a full payload", () => {
    const result = pushDataSchema.safeParse({
      v: 1,
      eventId: "evt_1",
      serviceId: "svc_1",
      sourceId: "svc_1",
      sourceName: "Acme CRM",
      avatarUrl: "https://example.com/a.png",
      url: "https://example.com",
      conversationId: "hark-svc_1",
    });
    expect(result.success).toBe(true);
  });

  it("round-trips an interaction payload", () => {
    const result = pushDataSchema.safeParse({
      v: 1,
      interactionId: "int_1",
      eventId: "evt_1",
      interactionKind: "approval",
      sourceName: "Acme CRM",
      conversationId: "hark-svc_1",
      categoryId: "HARK_APPROVAL_V1",
      actionDigest: "a".repeat(64),
    });
    expect(result.success).toBe(true);
  });

  it("accepts only versioned notification withdrawal commands", () => {
    expect(
      pushDataSchema.safeParse({
        v: 1,
        command: "notification.withdraw",
        eventId: "evt_1",
      }).success,
    ).toBe(true);
    expect(
      pushDataSchema.safeParse({
        v: 2,
        command: "notification.withdraw",
        eventId: "evt_1",
      }).success,
    ).toBe(false);
    expect(
      pushDataSchema.safeParse({
        v: 1,
        command: "notification.withdraw",
        eventId: "",
      }).success,
    ).toBe(false);
    expect(
      pushDataSchema.safeParse({
        v: 1,
        command: "notification.withdraw",
      }).success,
    ).toBe(false);
    expect(
      pushDataSchema.safeParse({
        v: 1,
        command: "notification.unknown",
        eventId: "evt_1",
      }).success,
    ).toBe(false);
  });
});

describe("web app contracts", () => {
  it("accepts HTTPS launch URLs and loopback HTTP only", () => {
    expect(appUrlSchema.safeParse("https://board.example.com/board").success).toBe(true);
    expect(appUrlSchema.safeParse("https://host.tail1234.ts.net/").success).toBe(true);
    expect(appUrlSchema.safeParse("http://localhost:5173/board").success).toBe(true);
    expect(appUrlSchema.safeParse("http://127.0.0.1:8787/").success).toBe(true);
    expect(appUrlSchema.safeParse("http://board.example.com/").success).toBe(false);
    expect(appUrlSchema.safeParse("https://user:pw@board.example.com/").success).toBe(false);
    expect(appUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(appOrigin("https://Board.Example.com:443/x?y=1")).toBe("https://board.example.com");
  });

  it("requires a single-line name and an app id prefix", () => {
    expect(
      appCreateSchema.safeParse({ name: "Sharkboard", url: "https://b.example" }).success,
    ).toBe(true);
    expect(
      appCreateSchema.safeParse({ name: "two\nlines", url: "https://b.example" }).success,
    ).toBe(false);
    expect(appCreateSchema.safeParse({ name: "", url: "https://b.example" }).success).toBe(false);
    expect(appIdSchema.safeParse("app_abcdefgh").success).toBe(true);
    expect(appIdSchema.safeParse("anot_abcdefgh").success).toBe(false);
  });

  it("exposes app scopes and carries appId through notification payloads", () => {
    expect(API_TOKEN_SCOPES).toContain("apps:read");
    expect(API_TOKEN_SCOPES).toContain("apps:write");
    expect(
      agentNotificationCreateSchema.safeParse({ body: "Open", appId: "app_abcdefgh" }).success,
    ).toBe(true);
    expect(webhookRequestSchema.safeParse({ body: "Open", appId: "app_abcdefgh" }).success).toBe(
      true,
    );
    expect(webhookRequestSchema.safeParse({ body: "Open", appId: "nope" }).success).toBe(false);
    const push = pushDataSchema.safeParse({
      v: 1,
      eventId: "evt_1",
      serviceId: "svc_1",
      sourceId: "svc_1",
      sourceName: "Board",
      conversationId: "hark-svc_1",
      appId: "app_abcdefgh",
    });
    expect(push.success).toBe(true);
  });
});

describe("board schemas", () => {
  it("accepts only public HTTPS callbacks", () => {
    const base = { key: "fm:x", title: "Ship?", options: [{ id: "ok", label: "OK" }] };
    const token = "k".repeat(32);
    expect(
      boardAskUpsertSchema.safeParse({
        ...base,
        callback: { url: "https://hooks.example/routine", token },
      }).success,
    ).toBe(true);
    for (const url of [
      "https://127.0.0.1/hook",
      "https://10.0.0.5/hook",
      "https://192.168.1.2/hook",
      "https://169.254.169.254/latest",
      "https://[::1]/hook",
      "https://box.local/hook",
      "http://hooks.example/routine",
    ]) {
      expect(boardAskUpsertSchema.safeParse({ ...base, callback: { url, token } }).success).toBe(
        false,
      );
    }
  });

  it("rejects format characters that would hide a secret from the screener", () => {
    const base = { key: "fm:x", options: [{ id: "ok", label: "OK" }] };
    expect(boardAskUpsertSchema.safeParse({ ...base, title: "Plain title" }).success).toBe(true);
    expect(boardAskUpsertSchema.safeParse({ ...base, title: "hark_\u200bsecret" }).success).toBe(
      false,
    );
    expect(
      boardAskUpsertSchema.safeParse({ ...base, title: "T", body: "line\u2060break" }).success,
    ).toBe(false);
    expect(findBoardSecret(`hark_${"a".repeat(43)}`)).toBe("SHark API token");
  });
});

describe("UTF-8 helpers", () => {
  it("counts bytes exactly like UTF-8 encoding", () => {
    for (const sample of [
      "",
      "plain ascii",
      "naïve café",
      "気配りのできる",
      "🚀🔥👩‍👩‍👧‍👦",
      "a".repeat(9000),
    ]) {
      expect(utf8ByteLength(sample)).toBe(Buffer.byteLength(sample, "utf8"));
    }
  });

  it("truncates on code-point boundaries without splitting surrogate pairs", () => {
    expect(truncateToUtf8Bytes("abc", 10)).toBe("abc");
    expect(truncateToUtf8Bytes("abcdef", 3)).toBe("abc");
    expect(truncateToUtf8Bytes("🚀🚀", 5)).toBe("🚀");
    expect(truncateToUtf8Bytes("🚀🚀", 3)).toBe("");
    expect(truncateToUtf8Bytes("気配り", 7)).toBe("気配");
    expect(truncateToUtf8Bytes("anything", 0)).toBe("");
    // Every truncation is itself valid UTF-8 of bounded size.
    for (let budget = 0; budget <= 12; budget += 1) {
      const cut = truncateToUtf8Bytes("aé気🚀aé気🚀", budget);
      expect(Buffer.byteLength(cut, "utf8")).toBeLessThanOrEqual(budget);
      expect(cut.includes("\uFFFD")).toBe(false);
    }
  });
});

describe("project name normalization", () => {
  it("is case-insensitive and NFC-normalized", () => {
    expect(normalizeProjectName("Acme App")).toBe("acme app");
    // U+0065 U+0301 (e + combining acute) folds into U+00E9 (é).
    expect(normalizeProjectName("Cafe\u0301")).toBe(normalizeProjectName("Café"));
    expect(normalizeProjectName("ÄPFEL")).toBe("äpfel");
  });
});

describe("inboxMarkAllReadSchema", () => {
  it("requires an opaque read-through token and accepts an optional project filter", () => {
    expect(inboxMarkAllReadSchema.safeParse({}).success).toBe(false);
    expect(inboxMarkAllReadSchema.safeParse({ readThrough: "" }).success).toBe(false);
    expect(inboxMarkAllReadSchema.safeParse({ readThrough: "x".repeat(201) }).success).toBe(false);
    // The retired timestamp boundary alone is no longer a valid request.
    expect(inboxMarkAllReadSchema.safeParse({ before: "2026-08-09T12:00:00.000Z" }).success).toBe(
      false,
    );
    const parsed = inboxMarkAllReadSchema.safeParse({
      readThrough: "cnQxOjQyOjc",
      project: "unfiled",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("cross-deploy request-hash stability", () => {
  function hash(payload: unknown): string {
    return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  }

  it("keeps parsed webhook payloads and hashes identical to the pre-project schema", () => {
    // Serialized forms produced by the schema that shipped before projects
    // existed. If any fixture changes, replayed Idempotency-Key requests from
    // an old deploy would 409 against rows written by a new deploy.
    const fixtures: Array<{ input: unknown; expected: string }> = [
      { input: { body: "Deploy finished" }, expected: '{"body":"Deploy finished"}' },
      {
        input: { title: "CI", body: "Build failed", url: "https://example.com/build/1" },
        expected: '{"body":"Build failed","title":"CI","url":"https://example.com/build/1"}',
      },
      {
        input: { body: "Targeted", deviceIds: ["dev_b", "dev_a", "dev_b"] },
        expected: '{"body":"Targeted","deviceIds":["dev_a","dev_b"]}',
      },
      {
        input: { body: "Deploy?", response: { type: "approval", correlationId: "deploy-1" } },
        expected:
          '{"body":"Deploy?","response":{"type":"approval","expiresInSeconds":900,"correlationId":"deploy-1"}}',
      },
    ];
    for (const fixture of fixtures) {
      const parsed = webhookRequestSchema.parse(fixture.input);
      expect(JSON.stringify(parsed)).toBe(fixture.expected);
      expect(hash(parsed)).toBe(hash(JSON.parse(fixture.expected)));
    }
  });

  it("keeps parsed agent notification payloads identical to the pre-project schema", () => {
    const fixtures: Array<{ input: unknown; expected: string }> = [
      { input: { body: "Done" }, expected: '{"body":"Done","title":"SHark"}' },
      {
        input: { body: "Done", title: "Deploybot", imageUrl: "https://example.com/a.png" },
        expected: '{"body":"Done","title":"Deploybot","imageUrl":"https://example.com/a.png"}',
      },
    ];
    for (const fixture of fixtures) {
      const parsed = agentNotificationCreateSchema.parse(fixture.input);
      expect(JSON.stringify(parsed)).toBe(fixture.expected);
    }
  });

  it("appends new optional fields after every legacy key", () => {
    const parsed = webhookRequestSchema.parse({
      project: "Acme",
      body: "x",
      title: "T",
      summary: "s",
    });
    expect(JSON.stringify(parsed)).toBe('{"body":"x","title":"T","project":"Acme","summary":"s"}');
  });
});

describe("OAuth scopes", () => {
  it("map 1:1 to API token scopes, minus companion scopes, plus offline_access", () => {
    expect(OAUTH_SCOPES).toEqual([
      ...API_TOKEN_SCOPES.filter((scope) => !/^(watch|macos):/.test(scope)),
      "offline_access",
    ]);
    for (const scope of NATIVE_COMPANION_SCOPES) expect(OAUTH_SCOPES).not.toContain(scope);
    expect(Object.keys(API_TOKEN_SCOPE_DESCRIPTIONS).sort()).toEqual([...API_TOKEN_SCOPES].sort());
  });

  it("default to everything except tokens:manage", () => {
    expect(OAUTH_DEFAULT_SCOPES).not.toContain("tokens:manage");
    expect(OAUTH_DEFAULT_SCOPES).toContain("offline_access");
    expect(OAUTH_DEFAULT_SCOPES).toHaveLength(OAUTH_SCOPES.length - 1);
  });

  it("mark scopes that reach people or remove setup as high impact", () => {
    for (const scope of OAUTH_HIGH_IMPACT_SCOPES) expect(OAUTH_SCOPES).toContain(scope);
    expect([...OAUTH_HIGH_IMPACT_SCOPES].sort()).toEqual([
      "apps:write",
      "devices:write",
      "oncall:write",
      "services:write",
      "teams:write",
      "tokens:manage",
    ]);
  });
});
