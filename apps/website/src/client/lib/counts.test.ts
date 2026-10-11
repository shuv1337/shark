import type { InboxItemDto, InboxPageDto } from "@hark/contracts";
import { describe, expect, it } from "vitest";
import { inboxAttentionCount } from "./counts";

const item: InboxItemDto = {
  id: "ibox:event:1",
  kind: "notification",
  sourceName: "Deploy Agent",
  sourceImageUrl: null,
  title: "Deploy finished",
  body: "Synthetic body",
  imageUrl: null,
  url: null,
  status: "accepted",
  result: "Accepted",
  accepted: 1,
  failed: 0,
  needsAction: false,
  readAt: "2026-07-30T19:00:00.000Z",
  occurredAt: "2026-07-30T19:00:00.000Z",
  updatedAt: "2026-07-30T19:00:00.000Z",
  action: null,
};

const page = (items: InboxItemDto[], unresolvedCount = 0): InboxPageDto => ({
  items,
  nextCursor: null,
  unresolvedCount,
});

describe("inbox badge count", () => {
  it("is zero when everything is read and nothing needs an answer", () => {
    expect(inboxAttentionCount(page([item, item]))).toBe(0);
  });

  it("counts unread items", () => {
    expect(inboxAttentionCount(page([{ ...item, readAt: null }, item]))).toBe(1);
  });

  it("counts an item that needs action even once it has been read", () => {
    expect(inboxAttentionCount(page([{ ...item, needsAction: true }]))).toBe(1);
  });

  /** A request can be older than the page the inbox just read. */
  it("never drops below the server's unresolved count", () => {
    expect(inboxAttentionCount(page([item], 4))).toBe(4);
  });

  it("does not double-count an unread item that also needs action", () => {
    expect(inboxAttentionCount(page([{ ...item, readAt: null, needsAction: true }], 1))).toBe(1);
  });
});
