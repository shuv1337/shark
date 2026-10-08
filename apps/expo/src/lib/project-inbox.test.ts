import type { InboxNotificationSummaryDto, InboxProjectSummaryDto } from "@hark/contracts";
import { describe, expect, it } from "vitest";
import {
  canMarkAllRead,
  loadedUnreadCount,
  markLoadedItemsRead,
  normalizeReadThroughToken,
  projectSummaryUnread,
} from "./project-inbox";

function summary(projectId: string | null, unreadCount: number): InboxProjectSummaryDto {
  return {
    projectId,
    name: projectId ?? "Other",
    unreadCount,
    totalCount: unreadCount + 5,
    latestTitle: null,
    latestPreview: null,
    latestAt: null,
  };
}

function item(id: string, readAt: string | null): InboxNotificationSummaryDto {
  return {
    id,
    origin: "event",
    projectId: "prj_1",
    projectName: "Acme",
    sourceName: "Monitor",
    sourceImageUrl: null,
    title: id,
    preview: "p",
    url: null,
    bodyFormat: "text",
    readAt,
    createdAt: "2026-08-09T12:00:00.000Z",
  };
}

describe("projectSummaryUnread", () => {
  const projects = [summary("prj_1", 42), summary(null, 3), summary("prj_2", 0)];

  it("matches a real project by ID and the unfiled bucket by null", () => {
    expect(projectSummaryUnread(projects, "prj_1")).toBe(42);
    expect(projectSummaryUnread(projects, "prj_2")).toBe(0);
    expect(projectSummaryUnread(projects, "unfiled")).toBe(3);
  });

  it("returns null when the summary does not know the project", () => {
    expect(projectSummaryUnread(projects, "prj_missing")).toBeNull();
    expect(projectSummaryUnread([], "unfiled")).toBeNull();
  });
});

describe("canMarkAllRead", () => {
  const token = "cnQxOjQyOjc";

  it("stays available when the summary reports unread beyond the loaded page", () => {
    // First page holds 30 read rows; 12 older unread rows exist beyond it.
    expect(canMarkAllRead(0, 12, token)).toBe(true);
  });

  it("stays available from the loaded page alone when the summary is missing", () => {
    expect(canMarkAllRead(2, null, token)).toBe(true);
  });

  it("disables when both sources agree there is nothing unread", () => {
    expect(canMarkAllRead(0, 0, token)).toBe(false);
    expect(canMarkAllRead(0, null, token)).toBe(false);
  });

  it("disables without a read-through token, since there is no safe boundary", () => {
    expect(canMarkAllRead(5, 12, null)).toBe(false);
  });
});

describe("normalizeReadThroughToken", () => {
  it("passes a server-issued token through", () => {
    expect(normalizeReadThroughToken("cnQxOjQyOjc")).toBe("cnQxOjQyOjc");
  });

  it("normalizes missing or empty tokens (older server mid-rollout) to null", () => {
    expect(normalizeReadThroughToken(undefined)).toBeNull();
    expect(normalizeReadThroughToken(null)).toBeNull();
    expect(normalizeReadThroughToken("")).toBeNull();
  });
});

describe("loadedUnreadCount", () => {
  it("counts only null readAt rows", () => {
    expect(
      loadedUnreadCount([item("a", null), item("b", "2026-08-09T11:00:00.000Z"), item("c", null)]),
    ).toBe(2);
    expect(loadedUnreadCount([])).toBe(0);
  });
});

describe("markLoadedItemsRead", () => {
  it("marks unread rows with the new timestamp and keeps original read times", () => {
    const readAt = "2026-08-09T14:00:00.000Z";
    const items = [item("a", null), item("b", "2026-08-09T11:00:00.000Z")];
    const marked = markLoadedItemsRead(items, readAt);
    expect(marked.map((entry) => entry.readAt)).toEqual([readAt, "2026-08-09T11:00:00.000Z"]);
    // Source rows are never mutated.
    expect(items[0]?.readAt).toBeNull();
  });
});
