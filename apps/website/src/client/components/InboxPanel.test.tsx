import type { InboxDetailDto, InboxItemDto } from "@hark/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  InboxDetailContent,
  InboxPanel,
  InboxRow,
  inboxKindLabel,
  inboxStateLabel,
} from "./InboxPanel";

const item: InboxItemDto = {
  id: "ibox:interaction:int_1",
  kind: "interaction",
  sourceName: "Deploy Agent",
  sourceImageUrl: null,
  title: "Production approval",
  body: "Approve the reviewed release after the checks pass.",
  imageUrl: null,
  url: "https://example.com/release",
  status: "pending",
  result: null,
  accepted: 1,
  failed: 0,
  needsAction: true,
  readAt: null,
  occurredAt: "2026-07-30T19:00:00.000Z",
  updatedAt: "2026-07-30T19:00:00.000Z",
  action: {
    interactionId: "int_1",
    kind: "approval",
    choices: ["approve", "deny"],
    actionDigest: "a".repeat(64),
    primaryLabel: "Approve",
    secondaryLabel: "Deny",
    expiresAt: "2026-07-30T20:00:00.000Z",
  },
};

describe("web inbox", () => {
  it("renders the first-class inbox controls", () => {
    const html = renderToStaticMarkup(<InboxPanel />);
    expect(html).toContain("Inbox");
    expect(html).toContain("Complete notification, interaction, and Live Activity history.");
    expect(html).toContain("Needs action");
    expect(html).toContain("Notifications");
  });

  it("renders unread rows with source, body, kind, and state", () => {
    const html = renderToStaticMarkup(<InboxRow item={item} onOpen={() => {}} />);
    expect(html).toContain("Production approval");
    expect(html).toContain("Approve the reviewed release");
    expect(html).toContain("Deploy Agent");
    expect(html).toContain("Interaction");
    expect(html).toContain("Needs action");
    expect(html).toContain("Unread");
  });

  it("renders full detail, links, action guidance, and timeline", () => {
    const detail: InboxDetailDto = {
      item,
      events: [
        {
          id: "event_1",
          kind: "created",
          detail: "Accepted by one device.",
          result: "Pending",
          accepted: 1,
          failed: 0,
          occurredAt: item.occurredAt,
        },
      ],
    };
    const html = renderToStaticMarkup(<InboxDetailContent detail={detail} />);
    expect(html).toContain("Production approval");
    expect(html).toContain("Open link");
    expect(html).toContain("registered iPhone");
    expect(html).toContain("Timeline");
    expect(html).toContain("Accepted by one device.");
  });

  it("uses stable reader-facing labels", () => {
    expect(inboxKindLabel("live_activity")).toBe("Live Activity");
    expect(inboxStateLabel(item)).toBe("Needs action");
    expect(inboxStateLabel({ ...item, needsAction: false, result: "Approved" })).toBe("Approved");
  });
});
