import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

vi.mock("../auth", () => ({
  auth: {
    handler: () => new Response("not used"),
    api: {
      getSession: async () => ({
        user: {
          id: "inbox_user",
          name: "Inbox User",
          email: "inbox@example.com",
          image: null,
        },
      }),
    },
  },
}));

let app: typeof import("../app")["app"];
let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  const { runMigrations } = await import("../db/migrate");
  runMigrations();
  const now = new Date();
  await db.insert(schema.user).values({
    id: "inbox_user",
    name: "Inbox User",
    email: "inbox@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.user).values({
    id: "other_user",
    name: "Other User",
    email: "other@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
});

beforeEach(async () => {
  await db.delete(schema.inboxItem);
  await db.delete(schema.interaction);
  await db.delete(schema.agentNotification);
  await db.delete(schema.event);
  await db.delete(schema.apiToken);
  await db.delete(schema.service);

  const now = new Date("2026-07-30T12:00:00.000Z");
  await db.insert(schema.service).values({
    id: "svc_inbox",
    userId: "inbox_user",
    title: "Build service",
    imageUrl: "https://example.com/service.png",
    tokenHash: "a".repeat(64),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.service).values({
    id: "svc_other",
    userId: "other_user",
    title: "Private other service",
    tokenHash: "d".repeat(64),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.apiToken).values({
    id: "tok_inbox",
    userId: "inbox_user",
    name: "Release agent",
    tokenHash: "b".repeat(64),
    prefix: "hark_test",
    scopes: ["notifications:send"],
    createdAt: now,
  });
  await db.insert(schema.event).values({
    id: "evt_inbox",
    serviceId: "svc_inbox",
    title: "Build finished",
    body: "The production build succeeded.",
    status: "accepted",
    deliveredCount: 1,
    createdAt: new Date(now.getTime() + 1_000),
  });
  await db.insert(schema.event).values({
    id: "evt_other",
    serviceId: "svc_other",
    title: "Must stay private",
    body: "Another account's notification.",
    status: "accepted",
    deliveredCount: 1,
    createdAt: new Date(now.getTime() + 4_000),
  });
  await db.insert(schema.agentNotification).values({
    id: "anot_inbox",
    userId: "inbox_user",
    requesterTokenId: "tok_inbox",
    title: "Deployment queued",
    body: "Waiting for approval.",
    acceptedCount: 1,
    createdAt: new Date(now.getTime() + 2_000),
  });
  await db.insert(schema.interaction).values({
    id: "int_inbox",
    userId: "inbox_user",
    requesterTokenId: "tok_inbox",
    title: "Deploy production",
    prompt: "Approve version 2.0?",
    kind: "approval",
    status: "pending",
    choices: ["approve", "deny"],
    actionDigest: "c".repeat(64),
    acceptedCount: 1,
    expiresAt: new Date(Date.now() + 10 * 60_000),
    createdAt: new Date(now.getTime() + 3_000),
  });
});

describe("durable inbox", () => {
  it("merges sources, exposes actions, and paginates with stable cursors", async () => {
    const first = await app.request("/api/inbox?limit=2");
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      items: Array<{ id: string; needsAction: boolean; action: { interactionId: string } | null }>;
      nextCursor: string | null;
      unresolvedCount: number;
    };
    expect(firstBody.items.map((item) => item.id)).toEqual([
      "ibox:interaction:int_inbox",
      "ibox:agent_notification:anot_inbox",
    ]);
    expect(firstBody.items[0]).toMatchObject({
      needsAction: true,
      action: { interactionId: "int_inbox" },
    });
    expect(firstBody.unresolvedCount).toBe(1);
    expect(firstBody.nextCursor).toBeTruthy();

    const second = await app.request(
      `/api/inbox?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor ?? "")}`,
    );
    const secondBody = (await second.json()) as { items: Array<{ id: string }> };
    expect(secondBody.items.map((item) => item.id)).toEqual(["ibox:event:evt_inbox"]);

    const invalid = await app.request(
      `/api/inbox?cursor=${Buffer.from(JSON.stringify([Number.MAX_VALUE, "item"])).toString("base64url")}`,
    );
    expect(invalid.status).toBe(400);
  });

  it("syncs read state account-wide and returns the lifecycle detail", async () => {
    await app.request("/api/inbox");
    const marked = await app.request("/api/inbox/ibox%3Aevent%3Aevt_inbox/read", {
      method: "POST",
    });
    expect(marked.status).toBe(200);
    const detail = await app.request("/api/inbox/ibox%3Aevent%3Aevt_inbox");
    const body = (await detail.json()) as {
      item: { readAt: string | null };
      events: Array<{ kind: string }>;
    };
    expect(body.item.readAt).toBeTruthy();
    expect(body.events).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "created" })]),
    );

    const markedAll = await app.request("/api/inbox/read-all", { method: "POST" });
    expect(markedAll.status).toBe(200);
    const list = (await (await app.request("/api/inbox")).json()) as {
      items: Array<{ readAt: string | null }>;
    };
    expect(list.items.every((item) => item.readAt)).toBe(true);
  });

  it("preserves send-time source metadata after rename and deletion", async () => {
    const now = new Date();
    await db.insert(schema.interaction).values({
      id: "int_service_pending",
      userId: "inbox_user",
      requesterServiceId: "svc_inbox",
      title: "Approve from service",
      prompt: "This action must not survive source deletion.",
      kind: "approval",
      status: "pending",
      choices: ["approve", "deny"],
      actionDigest: "e".repeat(64),
      acceptedCount: 1,
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
    });
    await app.request("/api/services/svc_inbox", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Renamed service" }),
    });
    const deleted = await app.request("/api/services/svc_inbox", { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const detail = await app.request("/api/inbox/ibox%3Aevent%3Aevt_inbox");
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      item: {
        sourceName: "Build service",
        title: "Build finished",
        body: "The production build succeeded.",
      },
    });
    const orphaned = await app.request("/api/inbox/ibox%3Ainteraction%3Aint_service_pending");
    expect(orphaned.status).toBe(200);
    expect(await orphaned.json()).toMatchObject({
      item: {
        sourceName: "Build service",
        status: "canceled",
        result: "Source deleted",
        needsAction: false,
        action: null,
      },
      events: expect.arrayContaining([
        expect.objectContaining({ kind: "source_deleted", result: "Source deleted" }),
      ]),
    });
  });

  it("filters actionable, failed, and notification activity", async () => {
    const actionable = (await (await app.request("/api/inbox?filter=needs_action")).json()) as {
      items: Array<{ id: string }>;
    };
    expect(actionable.items.map((item) => item.id)).toEqual(["ibox:interaction:int_inbox"]);

    const notifications = (await (await app.request("/api/inbox?filter=notifications")).json()) as {
      items: Array<{ kind: string }>;
    };
    expect(notifications.items).toHaveLength(2);
    expect(notifications.items.every((item) => item.kind === "notification")).toBe(true);

    const failed = (await (await app.request("/api/inbox?filter=failed")).json()) as {
      items: unknown[];
    };
    expect(failed.items).toEqual([]);
  });

  it("only includes ongoing Live Activities in the active filter", async () => {
    await db.update(schema.agentNotification).set({
      status: "partial",
      acceptedCount: 1,
      failedCount: 1,
      error: "SyntheticFailure",
    });
    await db.insert(schema.liveActivity).values({
      id: "act_partial",
      userId: "inbox_user",
      requesterTokenId: "tok_inbox",
      schemaVersion: 1,
      props: { title: "Release build", detail: "Still running" },
      status: "partial",
      acceptedCount: 1,
      failedCount: 1,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const active = (await (await app.request("/api/inbox?filter=active")).json()) as {
      items: Array<{ id: string; kind: string; status: string }>;
    };
    expect(active.items).toEqual([
      expect.objectContaining({
        id: "ibox:live_activity:act_partial",
        kind: "live_activity",
        status: "partial",
      }),
    ]);

    const failed = (await (await app.request("/api/inbox?filter=failed")).json()) as {
      items: Array<{ id: string }>;
    };
    expect(failed.items.map((entry) => entry.id)).toContain("ibox:agent_notification:anot_inbox");
  });

  it("persists Live Activity expiry while reconciling the inbox", async () => {
    await db.insert(schema.liveActivity).values({
      id: "act_expired",
      userId: "inbox_user",
      requesterTokenId: "tok_inbox",
      schemaVersion: 1,
      props: { title: "Old build", detail: "No longer running" },
      status: "active",
      acceptedCount: 1,
      expiresAt: new Date(Date.now() - 1_000),
      createdAt: new Date(Date.now() - 120_000),
      updatedAt: new Date(Date.now() - 60_000),
    });

    const response = (await (await app.request("/api/inbox")).json()) as {
      items: Array<{ id: string; status: string; result: string | null }>;
    };
    expect(response.items).toContainEqual(
      expect.objectContaining({
        id: "ibox:live_activity:act_expired",
        status: "expired",
        result: "Expired",
      }),
    );

    const source = (await db.select().from(schema.liveActivity)).find(
      (activity) => activity.id === "act_expired",
    );
    expect(source).toMatchObject({ status: "expired" });
    expect(source?.endedAt).toBeInstanceOf(Date);

    const detail = (await (
      await app.request("/api/inbox/ibox%3Alive_activity%3Aact_expired")
    ).json()) as { events: Array<{ kind: string; result: string | null }> };
    expect(detail.events).toContainEqual(
      expect.objectContaining({ kind: "expired", result: "Expired" }),
    );
  });

  it("keeps withdrawn notifications in history instead of active or failed", async () => {
    await db
      .update(schema.event)
      .set({ status: "withdrawn" })
      .where(eq(schema.event.id, "evt_inbox"));
    await db.insert(schema.event).values({
      id: "evt_withdraw_partial",
      serviceId: "svc_inbox",
      title: "Partial withdraw",
      body: "Some devices missed the silent command.",
      status: "withdraw_partial",
      deliveredCount: 1,
      createdAt: new Date("2026-07-30T12:00:06.000Z"),
    });

    const all = (await (await app.request("/api/inbox")).json()) as {
      items: Array<{ id: string; status: string; result: string | null }>;
    };
    expect(all.items).toContainEqual(
      expect.objectContaining({
        id: "ibox:event:evt_inbox",
        status: "withdrawn",
        result: "Withdrawn",
      }),
    );
    expect(all.items).toContainEqual(
      expect.objectContaining({
        id: "ibox:event:evt_withdraw_partial",
        status: "withdraw_partial",
        result: "Partially withdrawn",
      }),
    );

    const active = (await (await app.request("/api/inbox?filter=active")).json()) as {
      items: Array<{ id: string }>;
    };
    expect(active.items.map((item) => item.id)).not.toContain("ibox:event:evt_inbox");
    expect(active.items.map((item) => item.id)).not.toContain("ibox:event:evt_withdraw_partial");

    const failed = (await (await app.request("/api/inbox?filter=failed")).json()) as {
      items: Array<{ id: string }>;
    };
    expect(failed.items.map((item) => item.id)).not.toContain("ibox:event:evt_inbox");
    expect(failed.items.map((item) => item.id)).not.toContain("ibox:event:evt_withdraw_partial");

    const detail = (await (await app.request("/api/inbox/ibox%3Aevent%3Aevt_inbox")).json()) as {
      events: Array<{ kind: string; result: string | null }>;
    };
    expect(detail.events.filter((entry) => entry.kind === "withdrawal")).toEqual([
      expect.objectContaining({ kind: "withdrawal", result: "Withdrawn" }),
    ]);
  });
});
