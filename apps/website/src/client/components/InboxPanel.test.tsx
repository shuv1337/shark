import type { InboxDetailDto, InboxItemDto } from "@hark/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import {
  InboxDetailContent,
  InboxPanel,
  InboxRow,
  inboxItemPath,
  inboxKindLabel,
  inboxStateDot,
  inboxStateLabel,
} from "./InboxPanel";

/** The panel and its rows link, so they need a router even to render. */
function markup(node: React.ReactNode): string {
  return renderToStaticMarkup(<MemoryRouter initialEntries={["/inbox"]}>{node}</MemoryRouter>);
}

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
    const html = markup(<InboxPanel />);
    expect(html).toContain("Inbox");
    expect(html).toContain("Complete notification, interaction, and Live Activity history.");
    expect(html).toContain("Needs action");
    expect(html).toContain("Notifications");
    // Activity is a filter of the inbox, not a page of its own.
    expect(html).toContain("Activity");
  });

  /**
   * The UA stylesheet gives `fieldset` a `min-inline-size: min-content`, which
   * `overflow-x-auto` does not clear on its own. Without `min-w-0` the filter
   * chips set a min-content floor on the whole document: at 320px the page laid
   * out at 370px and the fixed tab bar overhung the screen.
   */
  it("lets the filter row scroll instead of widening the page", () => {
    const fieldset = /<fieldset class="([^"]*)"/.exec(markup(<InboxPanel />))?.[1];
    expect(fieldset).toBeDefined();
    expect(fieldset).toContain("overflow-x-auto");
    expect(fieldset).toContain("min-w-0");
  });

  it("renders unread rows with source, body, kind, and state", () => {
    const html = markup(<InboxRow item={item} to={inboxItemPath(item.id)} />);
    expect(html).toContain("Production approval");
    expect(html).toContain("Approve the reviewed release");
    expect(html).toContain("Deploy Agent");
    expect(html).toContain("Interaction");
    expect(html).toContain("Needs action");
    expect(html).toContain("Unread");
    // The row is a link, so an item is deep-linkable and opens in a new tab.
    expect(html).toContain('href="/inbox/ibox%3Ainteraction%3Aint_1"');
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
    const html = markup(<InboxDetailContent detail={detail} />);
    expect(html).toContain("Production approval");
    expect(html).toContain("Open link");
    expect(html).toContain("registered iPhone or the macOS menu bar app");
    expect(html).toContain("Timeline");
    expect(html).toContain("Accepted by one device.");
  });

  it("uses stable reader-facing labels", () => {
    expect(inboxKindLabel("live_activity")).toBe("Live Activity");
    expect(inboxStateLabel(item)).toBe("Needs action");
    expect(inboxStateLabel({ ...item, needsAction: false, result: "Approved" })).toBe("Approved");
  });

  it("renders partial notifications as terminal failures and partial activities as active", () => {
    expect(
      inboxStateDot({ ...item, kind: "notification", status: "partial", needsAction: false }),
    ).toBe("bg-danger-strong");
    expect(
      inboxStateDot({ ...item, kind: "live_activity", status: "partial", needsAction: false }),
    ).toBe("bg-info");
  });
});
