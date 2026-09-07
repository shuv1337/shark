import { webhookRequestSchema } from "@hark/contracts";
import type { ExpoPushMessage } from "expo-server-sdk";
import { describe, expect, it } from "vitest";
import { buildInteractionPushMessages, buildPushMessages } from "./push";
import {
  EXPO_MESSAGE_BYTE_BUDGET,
  fitPushMessage,
  fitPushPreview,
  pushJsonBytes,
  truncatePushText,
} from "./push-preview";

const imageUrl = `https://example.com/${"i".repeat(2024)}.png`;
const url = `https://example.com/${"u".repeat(2028)}`;
const to = [`ExponentPushToken[${"t".repeat(380)}]`];
const title = "\u0000".repeat(80);
const body = '気\n"\\🚀'.repeat(300);

function messages() {
  const resolved = webhookRequestSchema.parse({ title, body, url, imageUrl });
  return [
    ...buildPushMessages({
      to,
      eventId: "event-synthetic",
      serviceId: "service-synthetic",
      resolved: { ...resolved, title },
    }),
    ...buildInteractionPushMessages({
      to,
      title,
      prompt: body,
      imageUrl,
      url,
      interactionId: "interaction-synthetic",
      eventId: "event-synthetic",
      kind: "approval",
      actionDigest: "a".repeat(64),
      responseToken: "synthetic-response-token",
      badge: 99,
    }),
  ];
}

describe("push preview text", () => {
  it("counts UTF-8 and JSON escaping while keeping whole graphemes", () => {
    const glyphs = ["a", "気", "é", "e\u0301", "👩‍👩‍👧‍👦", "\n", '"', "\\", "\u0000", "\ud83d"];
    for (const glyph of glyphs) {
      const value = glyph.repeat(50);
      for (let budget = 0; budget < 120; budget++) {
        const result = truncatePushText(value, budget);
        expect(pushJsonBytes(result) - 2).toBeLessThanOrEqual(budget);
        const prefix = result.endsWith("…") ? result.slice(0, -1) : result;
        expect(value.startsWith(prefix)).toBe(true);
        expect(prefix.length % glyph.length).toBe(0);
        if (result && result !== value) expect(result.endsWith("…")).toBe(true);
      }
    }
  });

  it("keeps exact-budget text and short messages unchanged", () => {
    expect(truncatePushText("気\n", 5)).toBe("気\n");
    const message: ExpoPushMessage = {
      to: "ExponentPushToken[synthetic]",
      title: "Title",
      body: "",
    };
    const exact = {
      ...message,
      body: "a".repeat(EXPO_MESSAGE_BYTE_BUDGET - pushJsonBytes(message)),
    };
    expect(pushJsonBytes(exact)).toBe(EXPO_MESSAGE_BYTE_BUDGET);
    expect(fitPushMessage(exact)).toBe(exact);
    expect(pushJsonBytes(fitPushMessage({ ...exact, body: `${exact.body}b` }))).toBeLessThanOrEqual(
      EXPO_MESSAGE_BYTE_BUDGET,
    );
  });
});

describe("Expo push previews", () => {
  it("fits actual ordinary and interaction builders without changing protected metadata or inputs", () => {
    for (const original of messages()) {
      const saved = structuredClone(original);
      const fitted = fitPushMessage(original);
      expect(pushJsonBytes(original)).toBeGreaterThan(EXPO_MESSAGE_BYTE_BUDGET);
      expect(pushJsonBytes(fitted)).toBeLessThanOrEqual(EXPO_MESSAGE_BYTE_BUDGET);
      expect(fitted).toMatchObject({
        to: original.to,
        title: original.title,
        priority: original.priority,
        mutableContent: original.mutableContent,
      });
      expect(fitted.badge).toBe(original.badge);
      expect(fitted.categoryId).toBe(original.categoryId);
      const expectedData = { ...original.data };
      delete expectedData.avatarUrl;
      delete expectedData.url;
      expect(fitted.data).toMatchObject(expectedData);
      expect(original.body?.startsWith(fitted.body?.replace(/…$/, "") ?? "")).toBe(true);
      expect(original).toEqual(saved);
    }
  });

  it("removes duplicate image, then avatar, then entire tap URL only when necessary", () => {
    const original: ExpoPushMessage = {
      to: "ExponentPushToken[synthetic]",
      title: "Title",
      body: "body".repeat(1000),
      richContent: { image: "https://example.com/a.png" },
      data: {
        avatarUrl: "https://example.com/a.png",
        url: "https://example.com/open",
        eventId: "event",
      },
    };
    const bodyOnly = fitPushMessage(original);
    expect(bodyOnly.richContent).toEqual(original.richContent);
    expect(bodyOnly.data).toEqual(original.data);
    expect(bodyOnly.body?.endsWith("…")).toBe(true);

    const duplicatedImage = {
      ...original,
      body: "body",
      richContent: { image: imageUrl },
      data: { ...original.data, avatarUrl: imageUrl },
    };
    const imageDropped = fitPushMessage(duplicatedImage);
    expect(imageDropped.richContent).toBeUndefined();
    expect(imageDropped.data?.avatarUrl).toBe(imageUrl);

    const bothImages = { ...duplicatedImage, data: { ...duplicatedImage.data, url } };
    const avatarDropped = fitPushMessage(bothImages);
    expect(avatarDropped.richContent).toBeUndefined();
    expect(avatarDropped.data?.avatarUrl).toBeUndefined();
    expect(avatarDropped.data?.url).toBe(url);

    // This URL is schema-valid in character count, but its UTF-8 form alone
    // exceeds the transport budget. Never slice it into a different destination.
    const unicodeUrl = `https://example.com/${"気".repeat(2028)}`;
    expect(webhookRequestSchema.safeParse({ body: "body", url: unicodeUrl }).success).toBe(true);
    const urlDropped = fitPushMessage({
      ...bothImages,
      data: { ...bothImages.data, url: unicodeUrl },
    });
    expect(urlDropped.data?.url).toBeUndefined();
    expect(urlDropped.data).toMatchObject({ eventId: "event" });
    expect(pushJsonBytes(urlDropped)).toBeLessThanOrEqual(EXPO_MESSAGE_BYTE_BUDGET);
  });

  it("leaves small silent commands intact and rejects oversized required metadata", () => {
    const command: ExpoPushMessage = {
      to: "ExponentPushToken[synthetic]",
      _contentAvailable: true,
      data: { v: 1, command: "notification.withdraw", eventId: "event-synthetic" },
    };
    expect(fitPushMessage(command)).toBe(command);
    expect(() =>
      fitPushMessage({
        ...command,
        data: { ...command.data, eventId: "sensitive".repeat(1000) },
      }),
    ).toThrow("Push payload metadata exceeds the 3328-byte budget");
    expect(() =>
      fitPushMessage({
        ...command,
        body: "body",
        data: { actionDigest: "sensitive".repeat(1000) },
      }),
    ).toThrow("Push payload metadata exceeds the 3328-byte budget");
  });

  it("never mutates the nested data shared between device messages", () => {
    const input = { title: "Title", body, imageUrl, url };
    const originals = buildPushMessages({
      to: ["ExponentPushToken[one]", "ExponentPushToken[two]"],
      eventId: "synthetic",
      serviceId: "synthetic",
      resolved: input,
    });
    const saved = structuredClone(originals);
    expect(originals[0]?.data).toBe(originals[1]?.data);
    for (const original of originals) fitPushMessage(original);
    expect(originals).toEqual(saved);
    expect(input).toEqual({ title: "Title", body, imageUrl, url });
  });

  it("checks the final measured envelope rather than returning an oversized fallback", () => {
    expect(() => fitPushPreview({ body: "body", id: "required" }, 1, [])).toThrow(
      "Push payload metadata exceeds the 1-byte budget",
    );
  });
});
