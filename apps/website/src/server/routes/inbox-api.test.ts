import type {
  InboxNotificationDetailDto,
  InboxNotificationPageDto,
  InboxProjectsDto,
} from "@hark/contracts";
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

const authState = vi.hoisted(() => ({ userId: "user_a" as string | null }));

vi.mock("../auth", () => ({
  auth: {
    handler: () => new Response("not used"),
    api: {
      getSession: async () =>
        authState.userId
          ? {
              user: {
                id: authState.userId,
                name: "Inbox User",
                email: `${authState.userId}@example.com`,
                image: null,
              },
            }
          : null,
    },
  },
}));

let app: typeof import("../app")["app"];
let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");

const BASE = Date.parse("2026-08-01T12:00:00.000Z");
const LARGE_BODY = `start ${"気配り🚀 ".repeat(900)}end`;

async function get(path: string) {
  return app.request(path);
}

async function post(path: string, body?: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  const { runMigrations } = await import("../db/migrate");
  runMigrations();

  const now = new Date(BASE);
  await db.insert(schema.user).values([
    {
      id: "user_a",
      name: "A",
      email: "a@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "user_b",
      name: "B",
      email: "b@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.service).values([
    {
      id: "svc_a",
      userId: "user_a",
      title: "Monitor",
      imageUrl: "https://example.com/monitor.png",
      tokenHash: "hash-a",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "svc_b",
      userId: "user_b",
      title: "Foreign",
      tokenHash: "hash-b",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.apiToken).values([
    {
      id: "tok_a",
      userId: "user_a",
      name: "Release agent",
      tokenHash: "tok-hash-a",
      prefix: "hark_a",
      scopes: ["notifications:send"],
      createdAt: now,
    },
    {
      id: "tok_b",
      userId: "user_b",
      name: "Foreign agent",
      tokenHash: "tok-hash-b",
      prefix: "hark_b",
      scopes: ["notifications:send"],
      createdAt: now,
    },
  ]);
  await db.insert(schema.project).values([
    {
      id: "prj_app",
      userId: "user_a",
      name: "Acme App",
      normalizedName: "acme app",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "prj_empty",
      userId: "user_a",
      name: "Empty Project",
      normalizedName: "empty project",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "prj_foreign",
      userId: "user_b",
      name: "Foreign Project",
      normalizedName: "foreign project",
      createdAt: now,
      updatedAt: now,
    },
  ]);

  // user_a events: 6 in prj_app (3 unread), 2 unfiled (1 unread), all with
  // deliberately identical timestamps in one pair to exercise cursor ties.
  await db.insert(schema.event).values([
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `evt_app_${index}`,
      serviceId: "svc_a",
      title: `App event ${index}`,
      body: index === 0 ? LARGE_BODY : `App body ${index}`,
      summary: index === 0 ? "Large deploy digest" : null,
      status: "accepted",
      deliveredCount: 1,
      projectId: "prj_app",
      readAt: index < 3 ? null : new Date(BASE - 50),
      // Ties: events 2 and 3 share one timestamp.
      createdAt: new Date(BASE - (index === 3 ? 2 : index) * 1_000),
    })),
    {
      id: "evt_unfiled_read",
      serviceId: "svc_a",
      title: "Unfiled read",
      body: "Historical body",
      status: "accepted",
      deliveredCount: 1,
      readAt: new Date(BASE - 10_000),
      createdAt: new Date(BASE - 10_000),
    },
    {
      id: "evt_unfiled_unread",
      serviceId: "svc_a",
      title: "Unfiled unread",
      body: "Fresh unfiled body",
      status: "accepted",
      deliveredCount: 1,
      createdAt: new Date(BASE - 500),
    },
    {
      id: "evt_foreign",
      serviceId: "svc_b",
      title: "Foreign event",
      body: "Must never be visible",
      status: "accepted",
      deliveredCount: 1,
      projectId: "prj_foreign",
      createdAt: new Date(BASE),
    },
  ]);
  await db.insert(schema.agentNotification).values([
    {
      id: "anot_app",
      userId: "user_a",
      requesterTokenId: "tok_a",
      title: "Build passed",
      body: "All integration tests passed",
      projectId: "prj_app",
      acceptedCount: 1,
      createdAt: new Date(BASE - 250),
    },
    {
      id: "anot_foreign",
      userId: "user_b",
      requesterTokenId: "tok_b",
      title: "Foreign notification",
      body: "Must never be visible",
      acceptedCount: 1,
      createdAt: new Date(BASE),
    },
  ]);
});

describe("GET /api/inbox/projects", () => {
  it("requires a session", async () => {
    authState.userId = null;
    try {
      expect((await get("/api/inbox/projects")).status).toBe(401);
    } finally {
      authState.userId = "user_a";
    }
  });

  it("summarizes projects sorted by latest notification with an Unfiled bucket", async () => {
    const response = await get("/api/inbox/projects");
    expect(response.status).toBe(200);
    const body = (await response.json()) as InboxProjectsDto;

    expect(body.projects.map((summary) => summary.projectId)).toEqual([
      "prj_app",
      null,
      "prj_empty",
    ]);
    const [appProject, unfiled, empty] = body.projects;
    expect(appProject).toMatchObject({
      name: "Acme App",
      totalCount: 7,
      unreadCount: 4,
    });
    expect(appProject?.latestPreview).toContain("Large deploy digest");
    expect(appProject?.latestImageUrl).toBe("https://example.com/monitor.png");
    expect(unfiled).toMatchObject({
      projectId: null,
      name: "Other",
      totalCount: 2,
      unreadCount: 1,
      latestTitle: "Unfiled unread",
    });
    expect(empty).toMatchObject({ projectId: "prj_empty", totalCount: 0, unreadCount: 0 });
    expect(body.totalUnread).toBe(5);
    // Foreign account content never leaks into the summary payload.
    expect(JSON.stringify(body)).not.toContain("Foreign");
  });
});

describe("GET /api/inbox/notifications", () => {
  it("validates limit, filters, and cursors", async () => {
    expect((await get("/api/inbox/notifications?limit=0")).status).toBe(400);
    expect((await get("/api/inbox/notifications?limit=51")).status).toBe(400);
    expect((await get("/api/inbox/notifications?limit=nope")).status).toBe(400);
    expect((await get("/api/inbox/notifications?unread=maybe")).status).toBe(400);
    expect((await get("/api/inbox/notifications?cursor=%00%01")).status).toBe(400);
    expect((await get("/api/inbox/notifications?cursor=bm90LWEtY3Vyc29y")).status).toBe(400);
  });

  it("pages with a stable keyset cursor across timestamp ties, without dupes or skips", async () => {
    const collected: string[] = [];
    let cursor: string | null = null;
    for (let round = 0; round < 10; round += 1) {
      const query = cursor
        ? `/api/inbox/notifications?limit=3&cursor=${encodeURIComponent(cursor)}`
        : "/api/inbox/notifications?limit=3";
      const response = await get(query);
      expect(response.status).toBe(200);
      const body = (await response.json()) as InboxNotificationPageDto;
      collected.push(...body.items.map((item) => item.id));
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(collected).toHaveLength(9);
    expect(new Set(collected).size).toBe(9);
    expect(collected).not.toContain("event:evt_foreign");
    expect(collected).not.toContain("notification:anot_foreign");

    // Stability: re-reading the first page returns the same slice.
    const again = (await (
      await get("/api/inbox/notifications?limit=3")
    ).json()) as InboxNotificationPageDto;
    expect(again.items.map((item) => item.id)).toEqual(collected.slice(0, 3));
  });

  it("filters by project, unfiled, and unread", async () => {
    const project = (await (
      await get("/api/inbox/notifications?project=prj_app&limit=50")
    ).json()) as InboxNotificationPageDto;
    expect(project.items).toHaveLength(7);
    expect(project.items.every((item) => item.projectId === "prj_app")).toBe(true);
    expect(project.items.every((item) => item.projectName === "Acme App")).toBe(true);

    const unfiled = (await (
      await get("/api/inbox/notifications?project=unfiled&limit=50")
    ).json()) as InboxNotificationPageDto;
    expect(unfiled.items.map((item) => item.id).sort()).toEqual([
      "event:evt_unfiled_read",
      "event:evt_unfiled_unread",
    ]);

    const unread = (await (
      await get("/api/inbox/notifications?project=prj_app&unread=1&limit=50")
    ).json()) as InboxNotificationPageDto;
    expect(unread.items).toHaveLength(4);
    expect(unread.items.every((item) => item.readAt === null)).toBe(true);
  });

  it("issues an opaque read-through snapshot token with every page", async () => {
    const page = (await (
      await get("/api/inbox/notifications?limit=3")
    ).json()) as InboxNotificationPageDto;
    expect(page.readThroughToken).toMatch(/^[A-Za-z0-9_-]+$/);
    // Internal shape: versioned per-table rowid high-water marks.
    const decoded = Buffer.from(page.readThroughToken, "base64url").toString("utf8");
    expect(decoded).toMatch(/^rt1:\d+:\d+$/);

    // Later pages behind a cursor still carry a token.
    const withCursor = (await (
      await get(
        `/api/inbox/notifications?limit=3&cursor=${encodeURIComponent(page.nextCursor ?? "")}`,
      )
    ).json()) as InboxNotificationPageDto;
    expect(withCursor.readThroughToken).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns bounded previews, never the full large body", async () => {
    const page = (await (
      await get("/api/inbox/notifications?project=prj_app&limit=50")
    ).json()) as InboxNotificationPageDto;
    const large = page.items.find((item) => item.id === "event:evt_app_0");
    expect(large?.preview).toBe("Large deploy digest");
    for (const item of page.items) {
      expect(Array.from(item.preview).length).toBeLessThanOrEqual(240);
    }
    expect(JSON.stringify(page)).not.toContain("気配り🚀");
  });
});

describe("GET /api/inbox/notifications/:id", () => {
  it("returns the full body and metadata for both origins", async () => {
    const eventDetail = (await (await get("/api/inbox/notifications/event:evt_app_0")).json()) as {
      notification: InboxNotificationDetailDto;
    };
    expect(eventDetail.notification).toMatchObject({
      id: "event:evt_app_0",
      origin: "event",
      projectId: "prj_app",
      projectName: "Acme App",
      sourceName: "Monitor",
      summary: "Large deploy digest",
      status: "accepted",
      bodyFormat: "text",
    });
    expect(eventDetail.notification.body).toBe(LARGE_BODY);

    const agentDetail = (await (
      await get("/api/inbox/notifications/notification:anot_app")
    ).json()) as { notification: InboxNotificationDetailDto };
    expect(agentDetail.notification).toMatchObject({
      id: "notification:anot_app",
      origin: "notification",
      sourceName: "Release agent",
      status: null,
      body: "All integration tests passed",
    });
  });

  it("404s on malformed, unknown, and cross-account IDs without leaking existence", async () => {
    for (const id of [
      "event:evt_foreign",
      "notification:anot_foreign",
      "event:missing",
      "bogus:evt_app_0",
      "event:",
      "evt_app_0",
      `event:${"x".repeat(200)}`,
    ]) {
      const response = await get(`/api/inbox/notifications/${encodeURIComponent(id)}`);
      expect(response.status, id).toBe(404);
      // The structured `code` is what lets the app distinguish this modern
      // "confirmed absent" 404 from an old server without the route.
      expect(await response.json()).toEqual({
        error: "Notification not found",
        code: "not_found",
      });
    }
  });
});

describe("read state mutations", () => {
  it("marks read idempotently, keeping the first read time", async () => {
    const first = await post("/api/inbox/notifications/event:evt_app_1/read");
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { ok: boolean; readAt: string };
    expect(firstBody.ok).toBe(true);

    const second = await post("/api/inbox/notifications/event:evt_app_1/read");
    const secondBody = (await second.json()) as {
      ok: boolean;
      readAt: string;
      idempotent?: boolean;
    };
    expect(secondBody).toMatchObject({ ok: true, readAt: firstBody.readAt, idempotent: true });
  });

  it("marks unread with last-write-wins and account-global effect", async () => {
    const response = await post("/api/inbox/notifications/event:evt_app_1/unread");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, readAt: null });

    const detail = (await (await get("/api/inbox/notifications/event:evt_app_1")).json()) as {
      notification: InboxNotificationDetailDto;
    };
    expect(detail.notification.readAt).toBeNull();

    // Repeating unread is a no-op, and it works for agent notifications too.
    expect((await post("/api/inbox/notifications/event:evt_app_1/unread")).status).toBe(200);
    expect((await post("/api/inbox/notifications/notification:anot_app/read")).status).toBe(200);
    expect((await post("/api/inbox/notifications/notification:anot_app/unread")).status).toBe(200);
  });

  it("404s mutations for cross-account and malformed IDs", async () => {
    for (const id of ["event:evt_foreign", "notification:anot_foreign", "nope", "event:"]) {
      expect((await post(`/api/inbox/notifications/${encodeURIComponent(id)}/read`)).status).toBe(
        404,
      );
      expect((await post(`/api/inbox/notifications/${encodeURIComponent(id)}/unread`)).status).toBe(
        404,
      );
    }
    const foreignEvent = await db.query.event.findFirst({
      where: (table, { eq: whereEq }) => whereEq(table.id, "evt_foreign"),
    });
    expect(foreignEvent?.readAt).toBeNull();
  });

  it("rejects read-all requests without a valid read-through token", async () => {
    expect((await post("/api/inbox/notifications/read-all", {})).status).toBe(400);
    // The retired timestamp boundary is no longer a valid request shape.
    expect(
      (
        await post("/api/inbox/notifications/read-all", {
          before: new Date(BASE).toISOString(),
        })
      ).status,
    ).toBe(400);
    const forgeries = [
      "",
      "!!!not-base64url!!!",
      "x".repeat(300),
      Buffer.from("rt1:1:2:3", "utf8").toString("base64url"),
      Buffer.from("rt0:1:2", "utf8").toString("base64url"),
      Buffer.from("rt1:-1:2", "utf8").toString("base64url"),
      Buffer.from("rt1:1.5:2", "utf8").toString("base64url"),
      Buffer.from("rt1:abc:2", "utf8").toString("base64url"),
      Buffer.from("rt1:9999999999999999999:2", "utf8").toString("base64url"),
      Buffer.from("rt1:1", "utf8").toString("base64url"),
    ];
    for (const readThrough of forgeries) {
      const response = await post("/api/inbox/notifications/read-all", { readThrough });
      expect(response.status, JSON.stringify(readThrough)).toBe(400);
    }
  });

  it("read-all marks only rows covered by the snapshot, across both source tables", async () => {
    // The client's snapshot: the token issued with a project list response.
    const before = (await (
      await get("/api/inbox/notifications?project=prj_app&limit=1")
    ).json()) as InboxNotificationPageDto;

    // Concurrent arrivals in BOTH tables sharing the newest row's exact
    // millisecond — the case a createdAt boundary cannot distinguish.
    await db.insert(schema.event).values({
      id: "evt_concurrent",
      serviceId: "svc_a",
      title: "Arrived during tap",
      body: "Concurrent event arrival",
      status: "accepted",
      deliveredCount: 1,
      projectId: "prj_app",
      createdAt: new Date(BASE),
    });
    await db.insert(schema.agentNotification).values({
      id: "anot_concurrent",
      userId: "user_a",
      requesterTokenId: "tok_a",
      title: "Arrived during tap",
      body: "Concurrent agent arrival",
      projectId: "prj_app",
      acceptedCount: 1,
      createdAt: new Date(BASE),
    });

    const response = await post("/api/inbox/notifications/read-all", {
      readThrough: before.readThroughToken,
      project: "prj_app",
    });
    expect(response.status).toBe(200);
    // Exactly the unread rows the snapshot covered: evt_app_0, evt_app_1,
    // evt_app_2, and the agent notification anot_app.
    expect(await response.json()).toEqual({ ok: true, updated: 4 });

    // Only the same-millisecond concurrent arrivals stay unread, while
    // evt_app_0 — created in that same millisecond but covered by the
    // snapshot — is now read.
    const page = (await (
      await get("/api/inbox/notifications?project=prj_app&unread=1&limit=50")
    ).json()) as InboxNotificationPageDto;
    expect(page.items.map((item) => item.id).sort()).toEqual([
      "event:evt_concurrent",
      "notification:anot_concurrent",
    ]);

    // The unfiled unread notification was outside the project filter.
    const unfiled = (await (
      await get("/api/inbox/notifications?project=unfiled&unread=1&limit=50")
    ).json()) as InboxNotificationPageDto;
    expect(unfiled.items.map((item) => item.id)).toEqual(["event:evt_unfiled_unread"]);
  });

  it("never lets a token reach rows outside the caller's account", async () => {
    // A deliberately forged token with huge rowid bounds, submitted without
    // a project filter: scope still comes from the session, so it can only
    // mark the caller's own remaining rows.
    const forged = Buffer.from("rt1:999999999999999:999999999999999", "utf8").toString("base64url");
    const response = await post("/api/inbox/notifications/read-all", { readThrough: forged });
    expect(response.status).toBe(200);
    // evt_concurrent, anot_concurrent, and evt_unfiled_unread.
    expect(await response.json()).toEqual({ ok: true, updated: 3 });

    const foreignEvent = await db.query.event.findFirst({
      where: (table, { eq: whereEq }) => whereEq(table.id, "evt_foreign"),
    });
    expect(foreignEvent?.readAt).toBeNull();
    const foreignNotification = await db.query.agentNotification.findFirst({
      where: (table, { eq: whereEq }) => whereEq(table.id, "anot_foreign"),
    });
    expect(foreignNotification?.readAt).toBeNull();
  });
});

describe("legacy activity feed bounding", () => {
  it("bounds jumbo bodies with coalesce(summary, 2000-char preview)", async () => {
    const response = await get("/api/activity-feed?filter=notification");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: Array<{ id: string; detail: string | null }>;
    };
    const large = body.items.find((item) => item.id === "event:evt_app_0");
    expect(large?.detail).toBe("Large deploy digest");
    const short = body.items.find((item) => item.id === "event:evt_app_1");
    expect(short?.detail).toBe("App body 1");
    for (const item of body.items) {
      expect(item.detail === null || Array.from(item.detail).length <= 2_000).toBe(true);
    }
  });

  it("passes a summary-less jumbo body as a 2,000-character preview", async () => {
    await db.insert(schema.event).values({
      id: "evt_jumbo_nosummary",
      serviceId: "svc_a",
      title: "Jumbo",
      body: "x".repeat(7_999),
      status: "accepted",
      deliveredCount: 1,
      createdAt: new Date(BASE + 1_000),
    });
    const response = await get("/api/activity-feed?filter=notification");
    const body = (await response.json()) as {
      items: Array<{ id: string; detail: string | null }>;
    };
    const jumbo = body.items.find((item) => item.id === "event:evt_jumbo_nosummary");
    expect(jumbo?.detail).toBe("x".repeat(2_000));
  });
});
