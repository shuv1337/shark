import type {
  OncallGroupDto,
  OncallPageCreateResponse,
  OncallPageDto,
  OncallShiftDto,
} from "@hark/contracts";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

const authState = vi.hoisted(() => ({ userId: "user_a" as string | null }));
const sent = vi.hoisted(() => [] as Array<Record<string, unknown>>);
/** Expo send outcomes: each queued gate settles one send; otherwise `fail` decides. */
const pushControl = vi.hoisted(() => ({
  fail: false,
  gates: [] as Array<Promise<"ok" | "fail">>,
}));
const NAMES: Record<string, string> = {
  user_a: "Ana",
  user_b: "Ben",
  user_c: "Cal",
  user_x: "Xan",
};

vi.mock("../auth", () => ({
  auth: {
    handler: () => new Response("not used"),
    api: {
      getSession: async () =>
        authState.userId
          ? {
              user: {
                id: authState.userId,
                name: NAMES[authState.userId] ?? authState.userId,
                email: `${authState.userId}@example.com`,
                image: null,
              },
            }
          : null,
    },
  },
}));

vi.mock("expo-server-sdk", () => {
  class Expo {
    chunkPushNotifications(messages: Array<Record<string, unknown>>) {
      return [messages];
    }
    async sendPushNotificationsAsync(messages: Array<Record<string, unknown>>) {
      sent.push(...messages);
      const gate = pushControl.gates.shift();
      const outcome = gate ? await gate : pushControl.fail ? "fail" : "ok";
      return messages.map(() =>
        outcome === "ok"
          ? { status: "ok", id: "ticket" }
          : { status: "error", message: "Synthetic push failure" },
      );
    }
  }
  return { Expo, default: Expo };
});

let app: typeof import("../app")["app"];
let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");
let oncall: typeof import("../lib/oncall");

const TEAM_ID = "team_oncalltest01";
const WRITER = `hark_${"w".repeat(43)}`;
const READER = `hark_${"r".repeat(43)}`;
const NOTIFIER = `hark_${"n".repeat(43)}`;
const WEBHOOK = "whk_oncall_webhook_token_000000000000";
const OUTSIDER_WEBHOOK = "whk_outsider_webhook_token_00000000000";

function as(userId: string | null) {
  authState.userId = userId;
}

async function call(method: string, path: string, body?: unknown, bearer?: string) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return app.request(path, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const pushesTo = (userId: string) =>
  sent.filter((message) => message.to === `ExponentPushToken[${userId}]`);
/** The lock-screen credential from the latest page push to `userId`. */
function responseTokenFor(userId: string): string {
  const data = pushesTo(userId).at(-1)?.data as { responseToken?: string } | undefined;
  if (!data?.responseToken) throw new Error(`No page push for ${userId}`);
  return data.responseToken;
}

afterEach(() => {
  sent.length = 0;
  pushControl.fail = false;
  pushControl.gates.length = 0;
  as("user_a");
});

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  oncall = await import("../lib/oncall");
  const { runMigrations } = await import("../db/migrate");
  const { hashApiToken, hashWebhookToken } = await import("../lib/token");
  runMigrations();
  const now = new Date();
  await db.insert(schema.user).values(
    Object.entries(NAMES).map(([id, name]) => ({
      id,
      name,
      email: `${id}@example.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })),
  );
  await db.insert(schema.device).values(
    Object.keys(NAMES).map((id) => ({
      id: `dev_${id}`,
      userId: id,
      expoPushToken: `ExponentPushToken[${id}]`,
      createdAt: now,
      lastSeenAt: now,
    })),
  );
  await db
    .insert(schema.team)
    .values({ id: TEAM_ID, name: "Infra", createdAt: now, updatedAt: now });
  await db.insert(schema.teamMember).values([
    { teamId: TEAM_ID, userId: "user_a", role: "owner", joinedAt: now },
    { teamId: TEAM_ID, userId: "user_b", role: "member", joinedAt: now },
    { teamId: TEAM_ID, userId: "user_c", role: "member", joinedAt: now },
  ]);
  await db.insert(schema.apiToken).values([
    {
      id: "tok_writer",
      userId: "user_a",
      name: "Monitor bot",
      tokenHash: hashApiToken(WRITER),
      prefix: "hark_wwwwwww",
      scopes: ["oncall:read", "oncall:write", "notifications:send"],
      createdAt: now,
    },
    {
      id: "tok_notifier",
      userId: "user_a",
      name: "Notify bot",
      tokenHash: hashApiToken(NOTIFIER),
      prefix: "hark_nnnnnnn",
      scopes: ["notifications:send"],
      createdAt: now,
    },
    {
      id: "tok_reader",
      userId: "user_a",
      name: "Reader bot",
      tokenHash: hashApiToken(READER),
      prefix: "hark_rrrrrrr",
      scopes: ["oncall:read"],
      createdAt: now,
    },
  ]);
  await db.insert(schema.service).values([
    {
      id: "svc_monitor",
      userId: "user_a",
      title: "Uptime",
      tokenHash: hashWebhookToken(WEBHOOK),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "svc_outsider",
      userId: "user_x",
      title: "Stranger",
      tokenHash: hashWebhookToken(OUTSIDER_WEBHOOK),
      createdAt: now,
      updatedAt: now,
    },
  ]);
});

async function createGroup(name: string, escalation?: unknown): Promise<OncallGroupDto> {
  as("user_a");
  const response = await call("POST", `/api/teams/${TEAM_ID}/oncall`, {
    name,
    rotation: {
      memberIds: ["user_a", "user_b", "user_c"],
      period: "daily",
      handoffAt: "09:00",
      timezone: "America/New_York",
    },
    ...(escalation ? { escalation } : {}),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { group: OncallGroupDto }).group;
}

async function page(groupId: string, body: unknown): Promise<Response> {
  return call("POST", `/api/oncall/${groupId}/pages`, body);
}

/** Moves a page's next escalation into the past and runs the worker. */
async function runDueEscalation(pageId: string) {
  const { eq } = await import("drizzle-orm");
  await db
    .update(schema.oncallPage)
    .set({ nextEscalationAt: new Date(Date.now() - 1000) })
    .where(eq(schema.oncallPage.id, pageId));
  await oncall.processDueEscalations();
}

describe("on-call groups", () => {
  it("lets admins create groups, puts the first rotation member on call, and supports overrides", async () => {
    as("user_b");
    const forbidden = await call("POST", `/api/teams/${TEAM_ID}/oncall`, {
      name: "Nope",
      rotation: { memberIds: ["user_b"], period: "daily", handoffAt: "09:00", timezone: "UTC" },
    });
    expect(forbidden.status).toBe(403);

    as("user_a");
    const invalid = await call("POST", `/api/teams/${TEAM_ID}/oncall`, {
      name: "Bad",
      rotation: { memberIds: ["user_x"], period: "daily", handoffAt: "09:00", timezone: "UTC" },
    });
    expect(invalid.status).toBe(400);

    const group = await createGroup("Primary");
    expect(group.current?.person.userId).toBe("user_a");
    expect(group.upcoming.map((shift) => shift.person.userId)).toEqual([
      "user_a",
      "user_b",
      "user_c",
      "user_a",
      "user_b",
    ]);
    expect(group.escalation).toEqual([
      { afterMinutes: 5, target: "next" },
      { afterMinutes: 10, target: "group" },
    ]);

    // A member cannot take over the current shift; an admin can put them on
    // call, and the override replaces the rotation.
    const start = new Date(Date.now() - 60_000).toISOString();
    const end = new Date(Date.now() + 3_600_000).toISOString();
    as("user_c");
    expect(
      (
        await call("POST", `/api/oncall/${group.id}/overrides`, {
          userId: "user_c",
          startsAt: start,
          endsAt: end,
        })
      ).status,
    ).toBe(403);
    as("user_a");
    const covered = await call("POST", `/api/oncall/${group.id}/overrides`, {
      userId: "user_c",
      startsAt: start,
      endsAt: end,
    });
    expect(covered.status).toBe(201);
    const coveredGroup = ((await covered.json()) as { group: OncallGroupDto }).group;
    expect(coveredGroup.current).toMatchObject({ person: { userId: "user_c" }, override: true });
    const overrideId = coveredGroup.overrides?.[0]?.id;
    expect(coveredGroup.current?.overrideId).toBe(overrideId);

    as("user_c");
    const me = (await (await call("GET", "/api/oncall/me")).json()) as {
      shifts: Array<OncallShiftDto & { groupId: string; teamName: string }>;
    };
    expect(me.shifts[0]).toMatchObject({ groupId: group.id, teamName: "Infra", override: true });

    const removed = await call("DELETE", `/api/oncall/${group.id}/overrides/${overrideId}`);
    expect(((await removed.json()) as { group: OncallGroupDto }).group.current?.person.userId).toBe(
      "user_a",
    );
  });
});

describe("override permissions", () => {
  const HOUR = 3_600_000;
  const HANDOFF_ONLY =
    "Members can only hand off time they are on call for; ask a team owner or admin to schedule other time";
  const override = (groupId: string, userId: string, startsAt: number, endsAt: number) =>
    call("POST", `/api/oncall/${groupId}/overrides`, {
      userId,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
    });
  /** Ben's rotation shift, the one after Ana's current shift. */
  function benShift(group: OncallGroupDto): [number, number] {
    const shift = group.upcoming[1];
    expect(shift?.person.userId).toBe("user_b");
    return [Date.parse(shift?.startsAt ?? ""), Date.parse(shift?.endsAt ?? "")];
  }
  const people = (group: OncallGroupDto) =>
    group.upcoming.map((shift) => [shift.person.userId, shift.override]);

  it("lets owners and admins schedule anyone over anyone's shift", async () => {
    const { eq, and } = await import("drizzle-orm");
    const group = await createGroup("Admin cover");
    const [benStart, benEnd] = benShift(group);
    as("user_a");
    const owner = await override(group.id, "user_c", benStart, benEnd + HOUR);
    expect(owner.status).toBe(201);
    expect(people(((await owner.json()) as { group: OncallGroupDto }).group).slice(0, 3)).toEqual([
      ["user_a", false],
      ["user_c", true],
      ["user_c", false],
    ]);

    const role = and(eq(schema.teamMember.teamId, TEAM_ID), eq(schema.teamMember.userId, "user_b"));
    await db.update(schema.teamMember).set({ role: "admin" }).where(role);
    try {
      as("user_b");
      const admin = await override(group.id, "user_b", Date.now() - 60_000, Date.now() + HOUR);
      expect(admin.status).toBe(201);
      expect(((await admin.json()) as { group: OncallGroupDto }).group.current).toMatchObject({
        person: { userId: "user_b" },
        override: true,
      });
    } finally {
      await db.update(schema.teamMember).set({ role: "member" }).where(role);
    }
  });

  it("lets a member hand off part of their own shift, and the recipient hand it on", async () => {
    const group = await createGroup("Handoff");
    const [benStart, benEnd] = benShift(group);
    as("user_b");
    const from = benStart + HOUR;
    const handoff = await override(group.id, "user_c", from, from + 2 * HOUR);
    expect(handoff.status).toBe(201);
    const after = ((await handoff.json()) as { group: OncallGroupDto }).group;
    expect(people(after).slice(1, 4)).toEqual([
      ["user_b", false],
      ["user_c", true],
      ["user_b", false],
    ]);
    expect(after.upcoming[3]?.endsAt).toBe(new Date(benEnd).toISOString());

    // That time is Cal's now: Ben cannot give it away twice, but Cal can pass it on.
    expect((await override(group.id, "user_a", from, from + HOUR)).status).toBe(403);
    as("user_c");
    expect((await override(group.id, "user_a", from + HOUR, from + 2 * HOUR)).status).toBe(201);
  });

  it("refuses a member taking over someone else's shift", async () => {
    const group = await createGroup("Takeover");
    const [benStart, benEnd] = benShift(group);
    as("user_c");
    const takeover = await override(group.id, "user_c", benStart, benEnd);
    expect(takeover.status).toBe(403);
    expect(await takeover.json()).toEqual({ error: HANDOFF_ONLY });
    // Nor give someone else's shift to a third person.
    expect((await override(group.id, "user_a", benStart, benStart + HOUR)).status).toBe(403);
    // Nor take over Ana's current shift.
    expect(
      (await override(group.id, "user_c", Date.now() - 60_000, Date.now() + HOUR)).status,
    ).toBe(403);
    as("user_a");
    const unchanged = (await (await call("GET", `/api/oncall/${group.id}`)).json()) as {
      group: OncallGroupDto;
    };
    expect(unchanged.group.overrides).toEqual([]);
  });

  it("refuses a member override that reaches past their shift", async () => {
    const group = await createGroup("Overreach");
    const [benStart, benEnd] = benShift(group);
    as("user_b");
    const longer = await override(group.id, "user_c", benStart, benEnd + HOUR);
    expect(longer.status).toBe(403);
    expect(await longer.json()).toEqual({ error: HANDOFF_ONLY });
    expect((await override(group.id, "user_b", benStart - HOUR, benEnd)).status).toBe(403);
    expect((await override(group.id, "user_b", benStart, benEnd + HOUR)).status).toBe(403);
    expect((await override(group.id, "user_c", benStart, benEnd)).status).toBe(201);
  });

  it("gives away the same time once under concurrent handoffs", async () => {
    const group = await createGroup("Double handoff");
    const [benStart, benEnd] = benShift(group);
    as("user_b");
    const responses = await Promise.all(
      ["user_a", "user_c", "user_a", "user_c", "user_a"].map((userId) =>
        override(group.id, userId, benStart, benEnd),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([201, 403, 403, 403, 403]);
  });

  it("resolves overlapping overrides by the later start and resumes the longer one", async () => {
    const group = await createGroup("Layered");
    const [benStart] = benShift(group);
    as("user_a");
    const longEnd = benStart + 5 * HOUR;
    expect((await override(group.id, "user_c", benStart + HOUR, longEnd)).status).toBe(201);
    const nested = await override(group.id, "user_a", benStart + 2 * HOUR, benStart + 3 * HOUR);
    expect(nested.status).toBe(201);
    const layered = ((await nested.json()) as { group: OncallGroupDto }).group;
    expect(people(layered)).toEqual([
      ["user_a", false],
      ["user_b", false],
      ["user_c", true],
      ["user_a", true],
      ["user_c", true],
    ]);
    expect(layered.upcoming[4]?.endsAt).toBe(new Date(longEnd).toISOString());
  });

  it("refuses a handoff that a later-starting override would partly shadow", async () => {
    const SHADOWED =
      "That window is partly covered by a later-starting override; split the override around it";
    const group = await createGroup("Shadowed");
    const [benStart, benEnd] = benShift(group);
    as("user_a");
    expect(
      (await override(group.id, "user_b", benStart + 2 * HOUR, benEnd + 2 * HOUR)).status,
    ).toBe(201);
    as("user_b");
    const handoff = await override(group.id, "user_c", benStart + HOUR, benStart + 3 * HOUR);
    expect(handoff.status).toBe(409);
    expect(await handoff.json()).toEqual({ error: SHADOWED });
    as("user_a");
    const admin = await override(group.id, "user_c", benStart + HOUR, benStart + 3 * HOUR);
    expect(admin.status).toBe(409);
    const stored = (await (await call("GET", `/api/oncall/${group.id}`)).json()) as {
      group: OncallGroupDto;
    };
    expect(stored.group.overrides?.map((row) => row.person.userId)).toEqual(["user_b"]);

    as("user_b");
    const split = await override(group.id, "user_c", benStart + HOUR, benStart + 2 * HOUR);
    expect(split.status).toBe(201);
    expect(people(((await split.json()) as { group: OncallGroupDto }).group).slice(1, 4)).toEqual([
      ["user_b", false],
      ["user_c", true],
      ["user_b", true],
    ]);
  });

  it("starts a member's handoff now when it asks for time already past", async () => {
    const { eq } = await import("drizzle-orm");
    const group = await createGroup("Backdated");
    as("user_a");
    expect(
      (await override(group.id, "user_b", Date.now() - HOUR, Date.now() + 2 * HOUR)).status,
    ).toBe(201);
    as("user_b");
    const before = Date.now();
    // The first two hours were Ana's, but they are over; only Ben's future time moves.
    const handoff = await override(group.id, "user_c", before - 3 * HOUR, before + HOUR);
    expect(handoff.status).toBe(201);
    const after = ((await handoff.json()) as { group: OncallGroupDto }).group;
    expect(after.current).toMatchObject({ person: { userId: "user_c" }, override: true });
    const rows = await db
      .select()
      .from(schema.oncallOverride)
      .where(eq(schema.oncallOverride.groupId, group.id));
    const stored = rows.find((entry) => entry.userId === "user_c");
    expect(stored?.startsAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("lets a holder hand off the first hour of their override in the same millisecond", async () => {
    const group = await createGroup("Same instant");
    const [benStart] = benShift(group);
    const frozen = vi.spyOn(Date, "now").mockReturnValue(Date.now());
    try {
      for (let index = 0; index < 10; index += 1) {
        const start = benStart + 2 * index * HOUR;
        as("user_a");
        expect((await override(group.id, "user_b", start, start + 2 * HOUR)).status).toBe(201);
        as("user_b");
        expect((await override(group.id, "user_c", start, start + HOUR)).status).toBe(201);
      }
    } finally {
      frozen.mockRestore();
    }
  });

  it("lets the recipient drop a handoff and the original holder hand it on again", async () => {
    const group = await createGroup("Redelegate");
    const [benStart] = benShift(group);
    as("user_b");
    const handoff = await override(group.id, "user_c", benStart + HOUR, benStart + 2 * HOUR);
    expect(handoff.status).toBe(201);
    const overrideId = ((await handoff.json()) as { group: OncallGroupDto }).group.overrides?.[0]
      ?.id;
    // The time is Cal's now, so Ben cannot remove her override or give it away.
    expect((await call("DELETE", `/api/oncall/${group.id}/overrides/${overrideId}`)).status).toBe(
      403,
    );
    expect((await override(group.id, "user_a", benStart + HOUR, benStart + 2 * HOUR)).status).toBe(
      403,
    );
    as("user_c");
    expect((await call("DELETE", `/api/oncall/${group.id}/overrides/${overrideId}`)).status).toBe(
      200,
    );
    as("user_b");
    expect((await override(group.id, "user_a", benStart + HOUR, benStart + 2 * HOUR)).status).toBe(
      201,
    );
  });
});

describe("per-minute windows under concurrent requests", () => {
  const BURST = 12;
  const LIMIT = 3;
  let serial = 0;

  /** A fresh service and agent token, so each test starts with empty windows. */
  async function freshCredentials(userId = "user_a") {
    const { hashApiToken, hashWebhookToken } = await import("../lib/token");
    serial += 1;
    const now = new Date();
    const webhook = `whk_burst_${serial}_${"0".repeat(28)}`;
    const token = `hark_${String(serial).padStart(43, "b")}`;
    await db.insert(schema.service).values({
      id: `svc_burst_${serial}`,
      userId,
      title: `Burst ${serial}`,
      tokenHash: hashWebhookToken(webhook),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.apiToken).values({
      id: `tok_burst_${serial}`,
      userId,
      name: `Burst bot ${serial}`,
      tokenHash: hashApiToken(token),
      prefix: token.slice(0, 12),
      scopes: ["notifications:send", "interactions:create", "oncall:write"],
      createdAt: now,
    });
    return { webhook, token, serviceId: `svc_burst_${serial}`, tokenId: `tok_burst_${serial}` };
  }

  /** A fresh account with one device, for tests that read its whole account window. */
  async function freshUser(id: string) {
    const now = new Date();
    await db.insert(schema.user).values({
      id,
      name: id,
      email: `${id}@example.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.device).values({
      id: `dev_${id}`,
      userId: id,
      expoPushToken: `ExponentPushToken[${id}]`,
      createdAt: now,
      lastSeenAt: now,
    });
  }

  function askRow(id: string, userId = "user_a") {
    return {
      id,
      revision: 1,
      userId,
      title: `Ask ${id}`,
      agentLabel: "Board bot",
      agentDisplay: null,
    } as typeof schema.boardAsk.$inferSelect;
  }

  /**
   * Temporarily lowers the per-minute limits. `selfHostedBilling` reads the
   * shared `env` object on every call, so this mutates process-wide state:
   * keep the run inside the callback and do not run these tests concurrently.
   */
  async function withLimits<T>(
    limits: { service?: number; account?: number },
    run: () => Promise<T>,
  ): Promise<T> {
    const { env } = await import("../env");
    const previous = [env.SERVICE_RATE_LIMIT_PER_MINUTE, env.ACCOUNT_RATE_LIMIT_PER_MINUTE];
    if (limits.service !== undefined) env.SERVICE_RATE_LIMIT_PER_MINUTE = limits.service;
    if (limits.account !== undefined) env.ACCOUNT_RATE_LIMIT_PER_MINUTE = limits.account;
    try {
      return await run();
    } finally {
      [env.SERVICE_RATE_LIMIT_PER_MINUTE, env.ACCOUNT_RATE_LIMIT_PER_MINUTE] = previous as [
        number,
        number,
      ];
    }
  }

  async function burst(request: (index: number) => Promise<Response>) {
    const responses = await Promise.all(
      Array.from({ length: BURST }, (_, index) => request(index)),
    );
    const limited = responses.filter((response) => response.status === 429);
    for (const response of limited) expect(response.headers.get("retry-after")).toBe("60");
    return {
      passed: responses.filter((response) => response.status < 300).length,
      limited: limited.length,
      bodies: await Promise.all(limited.map((response) => response.json())),
    };
  }

  it("holds a webhook's service window for notifications", async () => {
    const { webhook, serviceId } = await freshCredentials();
    const result = await withLimits({ service: LIMIT }, () =>
      burst((index) => call("POST", `/hooks/${webhook}`, { body: `Burst ${index}` })),
    );
    expect(result).toMatchObject({ passed: LIMIT, limited: BURST - LIMIT });
    expect(result.bodies[0]).toMatchObject({ error: "Service rate limit exceeded" });
    expect(
      (await db.select().from(schema.event)).filter((row) => row.serviceId === serviceId),
    ).toHaveLength(LIMIT);
  });

  it("holds the account window for webhook notifications", async () => {
    await freshUser("user_burst");
    const first = await freshCredentials("user_burst");
    const second = await freshCredentials("user_burst");
    const result = await withLimits({ account: LIMIT }, () =>
      burst((index) =>
        call("POST", `/hooks/${index % 2 ? first.webhook : second.webhook}`, { body: "x" }),
      ),
    );
    expect(result).toMatchObject({ passed: LIMIT, limited: BURST - LIMIT });
    expect(result.bodies[0]).toMatchObject({ error: "Account rate limit exceeded" });
    const stored = (await db.select().from(schema.event)).filter(
      (row) => row.serviceId === first.serviceId || row.serviceId === second.serviceId,
    );
    expect(stored).toHaveLength(LIMIT);
  });

  it("creates no project for a refused webhook notification", async () => {
    const { webhook, serviceId } = await freshCredentials();
    const prefix = `hook-project-${serial}-`;
    const result = await withLimits({ service: LIMIT }, () =>
      burst((index) =>
        call("POST", `/hooks/${webhook}`, { body: "x", project: `${prefix}${index}` }),
      ),
    );
    expect(result).toMatchObject({ passed: LIMIT, limited: BURST - LIMIT });
    const projects = (await db.select().from(schema.project)).filter((row) =>
      row.normalizedName.startsWith(prefix),
    );
    expect(projects).toHaveLength(LIMIT);
    const events = (await db.select().from(schema.event)).filter(
      (row) => row.serviceId === serviceId,
    );
    expect(new Set(events.map((row) => row.projectId))).toEqual(
      new Set(projects.map((row) => row.id)),
    );
  });

  it("creates no project for a refused agent notification", async () => {
    const { token, tokenId } = await freshCredentials();
    const prefix = `agent-project-${serial}-`;
    const result = await withLimits({ service: LIMIT }, () =>
      burst((index) =>
        call(
          "POST",
          "/api/agent/notifications",
          { title: "Bot", body: "x", project: `${prefix}${index}` },
          token,
        ),
      ),
    );
    expect(result).toMatchObject({ passed: LIMIT, limited: BURST - LIMIT });
    const projects = (await db.select().from(schema.project)).filter((row) =>
      row.normalizedName.startsWith(prefix),
    );
    expect(projects).toHaveLength(LIMIT);
    const notifications = (await db.select().from(schema.agentNotification)).filter(
      (row) => row.requesterTokenId === tokenId,
    );
    expect(new Set(notifications.map((row) => row.projectId))).toEqual(
      new Set(projects.map((row) => row.id)),
    );
  });

  it("shares one account window between agent notifications and webhooks", async () => {
    await freshUser("user_mixed");
    const { webhook, token } = await freshCredentials("user_mixed");
    await withLimits({ service: 100, account: LIMIT }, async () => {
      for (let index = 0; index < LIMIT; index += 1) {
        expect(
          (await call("POST", "/api/agent/notifications", { title: "Bot", body: "x" }, token))
            .status,
        ).toBe(201);
      }
      const hook = await call("POST", `/hooks/${webhook}`, { body: "x" });
      expect(hook.status).toBe(429);
      expect(await hook.json()).toMatchObject({ error: "Account rate limit exceeded" });
      const agent = await call(
        "POST",
        "/api/agent/notifications",
        { title: "Bot", body: "x" },
        token,
      );
      expect(agent.status).toBe(429);
      expect(await agent.json()).toMatchObject({ error: "Account rate limit exceeded" });
    });
  });

  it("holds a webhook's service window for pages", async () => {
    const group = await createGroup("Burst hook");
    const { webhook, serviceId } = await freshCredentials();
    const result = await withLimits({ service: LIMIT }, () =>
      burst((index) =>
        call("POST", `/hooks/${webhook}`, { body: `Page ${index}`, oncall: group.id }),
      ),
    );
    expect(result).toMatchObject({ passed: LIMIT, limited: BURST - LIMIT });
    expect(result.bodies[0]).toMatchObject({ error: "Service rate limit exceeded" });
    expect(
      (await db.select().from(schema.oncallPage)).filter(
        (row) => row.requesterServiceId === serviceId,
      ),
    ).toHaveLength(LIMIT);
  });

  it("holds a token's requester window for agent notifications", async () => {
    const { token, tokenId } = await freshCredentials();
    const result = await withLimits({ service: LIMIT }, () =>
      burst((index) =>
        call("POST", "/api/agent/notifications", { title: "Bot", body: `n${index}` }, token),
      ),
    );
    expect(result).toMatchObject({ passed: LIMIT, limited: BURST - LIMIT });
    expect(result.bodies[0]).toEqual({
      error: "Requester rate limit exceeded",
      retryAfterSeconds: 60,
    });
    expect(
      (await db.select().from(schema.agentNotification)).filter(
        (row) => row.requesterTokenId === tokenId,
      ),
    ).toHaveLength(LIMIT);
  });

  it("holds a token's requester window for interactions", async () => {
    const { token, tokenId } = await freshCredentials();
    const result = await withLimits({ service: LIMIT }, () =>
      burst((index) =>
        call(
          "POST",
          "/api/agent/interactions",
          { title: "Deploy", prompt: `Ship ${index}?`, kind: "approval" },
          token,
        ),
      ),
    );
    expect(result).toMatchObject({ passed: LIMIT, limited: BURST - LIMIT });
    expect(result.bodies[0]).toMatchObject({ error: "Requester rate limit exceeded" });
    expect(
      (await db.select().from(schema.interaction)).filter(
        (row) => row.requesterTokenId === tokenId,
      ),
    ).toHaveLength(LIMIT);
  });

  it("holds a token's requester window for board pushes", async () => {
    const { eq } = await import("drizzle-orm");
    const { BoardPushLimited, sendBoardAskPush } = await import("../lib/board-push");
    const { tokenId } = await freshCredentials();
    const [token] = await db.select().from(schema.apiToken).where(eq(schema.apiToken.id, tokenId));
    if (!token) throw new Error("Missing token");
    const outcomes = await withLimits({ service: LIMIT }, () =>
      Promise.allSettled(
        Array.from({ length: BURST }, (_, index) =>
          sendBoardAskPush(
            {
              id: `ask_${tokenId}_${index}`,
              revision: 1,
              userId: "user_a",
              title: `Ask ${index}`,
              agentLabel: "Board bot",
              agentDisplay: null,
            } as typeof schema.boardAsk.$inferSelect,
            token,
          ),
        ),
      ),
    );
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(LIMIT);
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(rejected).toHaveLength(BURST - LIMIT);
    for (const outcome of rejected) {
      expect(outcome.reason).toBeInstanceOf(BoardPushLimited);
      expect(outcome.reason.message).toBe("Requester rate limit exceeded");
    }
    expect(
      (await db.select().from(schema.agentNotification)).filter(
        (row) => row.requesterTokenId === tokenId,
      ),
    ).toHaveLength(LIMIT);
  });

  it("admits board push retries of aged failures against the current window", async () => {
    const { eq } = await import("drizzle-orm");
    const { BoardPushLimited, sendBoardAskPush } = await import("../lib/board-push");
    const { tokenId } = await freshCredentials();
    const [token] = await db.select().from(schema.apiToken).where(eq(schema.apiToken.id, tokenId));
    if (!token) throw new Error("Missing token");
    const aged = new Date(Date.now() - 10 * 60_000);
    await db.insert(schema.agentNotification).values(
      Array.from({ length: BURST }, (_, index) => ({
        id: `anot_aged_${tokenId}_${index}`,
        userId: "user_a",
        requesterTokenId: tokenId,
        title: "Board bot",
        body: `Ask ${index}`,
        status: "failed",
        error: "Synthetic failure",
        idempotencyKey: `bask:ask_aged_${tokenId}_${index}:r1`,
        createdAt: aged,
      })),
    );
    const outcomes = await withLimits({ service: LIMIT }, () =>
      Promise.allSettled(
        Array.from({ length: BURST }, (_, index) =>
          sendBoardAskPush(askRow(`ask_aged_${tokenId}_${index}`), token),
        ),
      ),
    );
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(LIMIT);
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        expect(outcome.reason).toBeInstanceOf(BoardPushLimited);
        expect(outcome.reason.message).toBe("Requester rate limit exceeded");
      }
    }
    expect(sent).toHaveLength(LIMIT);
    const rows = (await db.select().from(schema.agentNotification)).filter(
      (row) => row.requesterTokenId === tokenId,
    );
    expect(rows.filter((row) => row.createdAt > aged)).toHaveLength(0);
    expect(rows.filter((row) => row.status === "failed")).toHaveLength(BURST - LIMIT);
    const retries = (await db.select().from(schema.agentNotificationRetry)).filter(
      (row) => row.requesterTokenId === tokenId,
    );
    expect(retries).toHaveLength(LIMIT);
  });

  it("counts every board push retry of a recent failure in the window", async () => {
    const { eq } = await import("drizzle-orm");
    const { BoardPushLimited, sendBoardAskPush } = await import("../lib/board-push");
    const { tokenId } = await freshCredentials();
    const [token] = await db.select().from(schema.apiToken).where(eq(schema.apiToken.id, tokenId));
    if (!token) throw new Error("Missing token");
    pushControl.fail = true;
    const outcomes: PromiseSettledResult<unknown>[] = [];
    await withLimits({ service: LIMIT }, async () => {
      for (let attempt = 0; attempt < BURST; attempt += 1) {
        outcomes.push(
          ...(await Promise.allSettled([sendBoardAskPush(askRow(`ask_loop_${tokenId}`), token)])),
        );
      }
    });
    expect(sent).toHaveLength(LIMIT);
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(rejected).toHaveLength(BURST - LIMIT);
    for (const outcome of rejected) expect(outcome.reason).toBeInstanceOf(BoardPushLimited);
    const { requesterWindowUsage } = await import("../lib/rate-windows");
    expect(requesterWindowUsage(db, tokenId, new Date(Date.now() - 60_000))).toBe(LIMIT);
  });

  it("does not start a second attempt while one is still sending in this process", async () => {
    const { eq } = await import("drizzle-orm");
    const { sendBoardAskPush } = await import("../lib/board-push");
    const { tokenId } = await freshCredentials();
    const [token] = await db.select().from(schema.apiToken).where(eq(schema.apiToken.id, tokenId));
    if (!token) throw new Error("Missing token");
    const askId = `ask_overlap_${tokenId}`;
    let release: (outcome: "ok" | "fail") => void = () => {};
    pushControl.gates.push(new Promise((resolve) => (release = resolve)));
    const first = sendBoardAskPush(askRow(askId), token);
    await settle();
    expect(sent).toHaveLength(1);
    // Even once its claim looks abandoned, the running attempt is not reclaimed.
    await db
      .update(schema.agentNotification)
      .set({ claimedAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(schema.agentNotification.requesterTokenId, tokenId));
    const second = await sendBoardAskPush(askRow(askId), token);
    expect(second).toMatchObject({ accepted: 0, inFlight: true });
    expect(sent).toHaveLength(1);
    release("ok");
    expect(await first).toMatchObject({ accepted: 1 });
    expect(await sendBoardAskPush(askRow(askId), token)).toMatchObject({ accepted: 1 });
    expect(sent).toHaveLength(1);
    const [row] = await db
      .select()
      .from(schema.agentNotification)
      .where(eq(schema.agentNotification.requesterTokenId, tokenId));
    expect(row).toMatchObject({ status: "accepted", acceptedCount: 1 });
  });

  it("keeps a superseded board push attempt from recording its outcome", async () => {
    const { eq } = await import("drizzle-orm");
    const { sendBoardAskPush } = await import("../lib/board-push");
    const { tokenId } = await freshCredentials();
    const [token] = await db.select().from(schema.apiToken).where(eq(schema.apiToken.id, tokenId));
    if (!token) throw new Error("Missing token");
    let release: (outcome: "ok" | "fail") => void = () => {};
    pushControl.gates.push(new Promise((resolve) => (release = resolve)));
    const stale = sendBoardAskPush(askRow(`ask_fence_${tokenId}`), token);
    await settle();
    // Another worker (say, after a restart) took the attempt over and is sending.
    await db
      .update(schema.agentNotification)
      .set({ claimId: "bpc_takeover", claimedAt: new Date() })
      .where(eq(schema.agentNotification.requesterTokenId, tokenId));
    release("fail");
    expect(await stale).toMatchObject({ accepted: 0 });
    const [row] = await db
      .select()
      .from(schema.agentNotification)
      .where(eq(schema.agentNotification.requesterTokenId, tokenId));
    expect(row).toMatchObject({ status: "processing", claimId: "bpc_takeover", error: null });
  });

  it("retries an abandoned board push after its reclaim failed to commit", async () => {
    const { eq } = await import("drizzle-orm");
    const { sendBoardAskPush } = await import("../lib/board-push");
    const { tokenId } = await freshCredentials();
    const [token] = await db.select().from(schema.apiToken).where(eq(schema.apiToken.id, tokenId));
    if (!token) throw new Error("Missing token");
    const askId = `ask_commitfail_${tokenId}`;
    await db.insert(schema.agentNotification).values({
      id: `anot_commitfail_${tokenId}`,
      userId: "user_a",
      requesterTokenId: tokenId,
      title: "Board bot",
      body: "Ask",
      status: "processing",
      idempotencyKey: `bask:${askId}:r1`,
      claimId: "bpc_restarted",
      claimedAt: new Date(Date.now() - 10 * 60_000),
      createdAt: new Date(Date.now() - 10 * 60_000),
    });
    const transaction = db.transaction.bind(db);
    const fault = vi.spyOn(db, "transaction").mockImplementationOnce(((
      callback: Parameters<typeof db.transaction>[0],
    ) =>
      transaction((tx) => {
        callback(tx);
        throw new Error("Synthetic commit failure");
      })) as typeof db.transaction);
    await expect(sendBoardAskPush(askRow(askId), token)).rejects.toThrow(
      "Synthetic commit failure",
    );
    fault.mockRestore();
    expect(sent).toHaveLength(0);
    const retried = await sendBoardAskPush(askRow(askId), token);
    expect(retried).toMatchObject({ accepted: 1 });
    expect(retried.inFlight).toBeUndefined();
    expect(sent).toHaveLength(1);
  });

  it("sweeps board push retry rows past retention", async () => {
    const { sweepBoardPushRetries, RETRY_RETENTION_MS } = await import("../lib/board-push");
    const { tokenId } = await freshCredentials();
    const now = new Date();
    await db.insert(schema.agentNotification).values({
      id: `anot_sweep_${tokenId}`,
      userId: "user_a",
      requesterTokenId: tokenId,
      title: "Board bot",
      body: "Ask",
      status: "failed",
      createdAt: now,
    });
    await db.insert(schema.agentNotificationRetry).values(
      [now.getTime() - 60_000, now.getTime() - RETRY_RETENTION_MS - 1].map((at, index) => ({
        id: `bpc_sweep_${tokenId}_${index}`,
        notificationId: `anot_sweep_${tokenId}`,
        userId: "user_a",
        requesterTokenId: tokenId,
        createdAt: new Date(at),
      })),
    );
    expect(sweepBoardPushRetries(now)).toBeGreaterThanOrEqual(1);
    const left = (await db.select().from(schema.agentNotificationRetry)).filter(
      (row) => row.requesterTokenId === tokenId,
    );
    expect(left.map((row) => row.id)).toEqual([`bpc_sweep_${tokenId}_0`]);
  });

  it("replays a raced idempotent twin instead of refusing it at the limit", async () => {
    const { token } = await freshCredentials();
    const { token: interactionToken } = await freshCredentials();
    const { webhook } = await freshCredentials();
    const twins = (request: () => Response | Promise<Response>) =>
      withLimits({ service: 1 }, () => Promise.all([request(), request()]));
    const statuses = async (responses: Response[]) =>
      responses.map((response) => response.status).sort();
    const notifications = await twins(() =>
      app.request("/api/agent/notifications", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          "idempotency-key": "twin-notification",
        },
        body: JSON.stringify({ title: "Bot", body: "twin" }),
      }),
    );
    expect(await statuses(notifications)).toEqual([200, 201]);
    const interactions = await twins(() =>
      app.request("/api/agent/interactions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${interactionToken}`,
          "idempotency-key": "twin-interaction",
        },
        body: JSON.stringify({ title: "Deploy", prompt: "Ship?", kind: "approval" }),
      }),
    );
    expect(await statuses(interactions)).toEqual([200, 201]);
    const hooks = await twins(() =>
      app.request(`/hooks/${webhook}`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "twin-hook" },
        body: JSON.stringify({ body: "twin" }),
      }),
    );
    expect((await statuses(hooks)).every((status) => status < 300)).toBe(true);
  });

  it("sends one push when the same failed board push is retried concurrently", async () => {
    const { eq } = await import("drizzle-orm");
    const { sendBoardAskPush } = await import("../lib/board-push");
    const { tokenId } = await freshCredentials();
    const [token] = await db.select().from(schema.apiToken).where(eq(schema.apiToken.id, tokenId));
    if (!token) throw new Error("Missing token");
    const askId = `ask_retry_${tokenId}`;
    await db.insert(schema.agentNotification).values({
      id: `anot_retry_${tokenId}`,
      userId: "user_a",
      requesterTokenId: tokenId,
      title: "Board bot",
      body: "Ask",
      status: "failed",
      error: "Synthetic failure",
      idempotencyKey: `bask:${askId}:r1`,
      createdAt: new Date(Date.now() - 10 * 60_000),
    });
    const outcomes = await Promise.allSettled(
      Array.from({ length: 5 }, () => sendBoardAskPush(askRow(askId), token)),
    );
    expect(sent).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled").length,
    ).toBeGreaterThanOrEqual(1);
    const [row] = await db
      .select()
      .from(schema.agentNotification)
      .where(eq(schema.agentNotification.id, `anot_retry_${tokenId}`));
    expect(row).toMatchObject({ status: "accepted", acceptedCount: 1 });
  });

  it("holds a token's requester window for agent pages on both routes", async () => {
    const group = await createGroup("Burst agent");
    const { token, tokenId } = await freshCredentials();
    const result = await withLimits({ service: LIMIT }, () =>
      burst((index) =>
        index % 2
          ? call("POST", `/api/agent/oncall/${group.id}/pages`, { title: `p${index}` }, token)
          : call(
              "POST",
              "/api/agent/notifications",
              { title: `p${index}`, body: "x", oncall: group.id },
              token,
            ),
      ),
    );
    expect(result).toMatchObject({ passed: LIMIT, limited: BURST - LIMIT });
    for (const body of result.bodies) {
      expect(body).toEqual({ error: "Requester rate limit exceeded", retryAfterSeconds: 60 });
    }
    expect(
      (await db.select().from(schema.oncallPage)).filter((row) => row.requesterTokenId === tokenId),
    ).toHaveLength(LIMIT);
  });
});

describe("rate window definitions", () => {
  it("counts each surface's rows in the service, requester, and account windows", async () => {
    const windows = await import("../lib/rate-windows");
    const { hashApiToken, hashWebhookToken } = await import("../lib/token");
    const userId = "user_windows";
    const now = new Date();
    const old = new Date(now.getTime() - 10 * 60_000);
    await db.insert(schema.user).values({
      id: userId,
      name: "Windows",
      email: `${userId}@example.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.service).values({
      id: "svc_windows",
      userId,
      title: "Windows",
      tokenHash: hashWebhookToken("whk_windows_webhook_token_000000000000"),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.apiToken).values({
      id: "tok_windows",
      userId,
      name: "Windows bot",
      tokenHash: hashApiToken(`hark_${"q".repeat(43)}`),
      prefix: "hark_qqqqqqq",
      scopes: ["notifications:send"],
      createdAt: now,
    });
    const group = await createGroup("Windows");
    await db.insert(schema.event).values(
      [now, old].map((createdAt, index) => ({
        id: `evt_windows_${index}`,
        serviceId: "svc_windows",
        title: "Event",
        body: "x",
        status: "accepted",
        createdAt,
      })),
    );
    await db.insert(schema.interaction).values({
      id: "int_windows",
      userId,
      requesterTokenId: "tok_windows",
      title: "Ask",
      prompt: "x",
      kind: "approval",
      choices: ["approve", "deny"],
      actionDigest: "synthetic",
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
    });
    await db.insert(schema.agentNotification).values({
      id: "anot_windows",
      userId,
      requesterTokenId: "tok_windows",
      title: "Bot",
      body: "x",
      status: "accepted",
      createdAt: now,
    });
    await db.insert(schema.agentNotificationRetry).values(
      [now, old].map((createdAt, index) => ({
        id: `bpc_windows_${index}`,
        notificationId: "anot_windows",
        userId,
        requesterTokenId: "tok_windows",
        createdAt,
      })),
    );
    const activity = (id: string, extra: object) => ({
      id,
      userId,
      schemaVersion: 1,
      props: {},
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
      ...extra,
    });
    await db.insert(schema.liveActivity).values([
      activity("la_windows_service", { requesterServiceId: "svc_windows" }),
      activity("la_windows_token", { requesterTokenId: "tok_windows" }),
      activity("la_windows_prompt", {
        requesterTokenId: "tok_windows",
        interactionId: "int_windows",
      }),
    ]);
    await db.insert(schema.liveActivityOperation).values([
      {
        id: "lao_windows_service",
        activityId: "la_windows_service",
        requesterServiceId: "svc_windows",
        event: "start",
        sequence: 1,
        createdAt: now,
      },
      {
        id: "lao_windows_token",
        activityId: "la_windows_token",
        requesterTokenId: "tok_windows",
        event: "start",
        sequence: 1,
        createdAt: now,
      },
      // Tied to an interaction, which already counts.
      {
        id: "lao_windows_prompt",
        activityId: "la_windows_prompt",
        requesterTokenId: "tok_windows",
        event: "start",
        sequence: 1,
        createdAt: now,
      },
    ]);
    await db.insert(schema.oncallPage).values(
      [{ requesterServiceId: "svc_windows" }, { requesterTokenId: "tok_windows" }].map(
        (origin, index) => ({
          id: `page_windows_${index}`,
          groupId: group.id,
          teamId: TEAM_ID,
          title: "Page",
          status: "resolved",
          sourceName: "Windows",
          createdByUserId: userId,
          createdAt: now,
          updatedAt: now,
          ...origin,
        }),
      ),
    );

    const since = new Date(now.getTime() - 60_000);
    // Event, service Live Activity operation, service page.
    expect(windows.serviceWindowUsage(db, "svc_windows", since)).toBe(3);
    // Token Live Activity operation, interaction, notification, its recent retry, token page.
    expect(windows.requesterWindowUsage(db, "tok_windows", since)).toBe(5);
    // Event, interaction, notification, its recent retry, two Live Activity operations, two pages.
    expect(windows.accountWindowUsage(db, userId, since)).toBe(8);

    const svc = { id: "svc_windows", userId };
    const token = { id: "tok_windows", userId };
    const limits = (servicePerMinute: number, accountPerMinute: number) => ({
      servicePerMinute,
      accountPerMinute,
    });
    expect(windows.webhookWindowLimit(db, svc, limits(3, 100))).toBe("service");
    expect(windows.webhookWindowLimit(db, svc, limits(4, 8))).toBe("account");
    expect(windows.webhookWindowLimit(db, svc, limits(4, 9))).toBeNull();
    expect(windows.agentWindowLimit(db, token, limits(5, 100))).toBe("requester");
    expect(windows.agentWindowLimit(db, token, limits(6, 8))).toBe("account");
    expect(windows.agentWindowLimit(db, token, limits(6, 9))).toBeNull();
  });
});

describe("pages", () => {
  it("pages the on-call person, merges duplicates, escalates, and lets the first acknowledgement win", async () => {
    const group = await createGroup("Escalating");
    const created = await page(group.id, {
      title: "API down",
      body: "5xx above 20%",
      dedupKey: "api-5xx",
    });
    expect(created.status).toBe(201);
    const first = (await created.json()) as OncallPageCreateResponse;
    expect(first).toMatchObject({ deduplicated: false, accepted: 1 });
    expect(first.page).toMatchObject({ status: "triggered", source: "Ana", escalationStep: 0 });
    expect(first.page.notified.map((person) => person.userId)).toEqual(["user_a"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "ExponentPushToken[user_a]",
      title: "API down",
      categoryId: "HARK_PAGE_V1",
      interruptionLevel: "time-sensitive",
      data: { pageId: first.page.id, teamId: TEAM_ID, groupName: "Escalating" },
    });

    const duplicate = await page(group.id, { title: "API down", dedupKey: "api-5xx" });
    expect(duplicate.status).toBe(200);
    const merged = (await duplicate.json()) as OncallPageCreateResponse;
    expect(merged).toMatchObject({ deduplicated: true, accepted: 0 });
    expect(merged.page).toMatchObject({ id: first.page.id, repeatCount: 1 });
    expect(sent).toHaveLength(1);

    sent.length = 0;
    await runDueEscalation(first.page.id);
    expect(pushesTo("user_b")).toHaveLength(1);
    expect(sent).toHaveLength(1);
    await runDueEscalation(first.page.id);
    expect(pushesTo("user_c")).toHaveLength(1);

    const bToken = responseTokenFor("user_b");
    sent.length = 0;
    const acked = await call("POST", `/api/page-responses/${first.page.id}/acknowledge`, {
      responseToken: bToken,
    });
    expect(await acked.json()).toEqual({ ok: true, status: "acknowledged" });
    await settle();
    // The credential is single-use: replaying it answers 409 and acts on nothing.
    const replay = await call("POST", `/api/page-responses/${first.page.id}/escalate`, {
      responseToken: bToken,
    });
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({
      error: "Page is already acknowledged",
      status: "acknowledged",
    });
    const reack = await call("POST", `/api/page-responses/${first.page.id}/acknowledge`, {
      responseToken: bToken,
    });
    expect(reack.status).toBe(409);
    // Everyone else who was paged gets a silent page.claimed.
    expect(sent.map((message) => message.to).sort()).toEqual([
      "ExponentPushToken[user_a]",
      "ExponentPushToken[user_c]",
    ]);
    expect(sent[0]).toMatchObject({
      _contentAvailable: true,
      data: { command: "page.claimed", pageId: first.page.id, claimedBy: "Ben" },
    });

    as("user_c");
    const late = await call("POST", `/api/pages/${first.page.id}/acknowledge`);
    expect(late.status).toBe(409);
    const detail = (await (await call("GET", `/api/pages/${first.page.id}`)).json()) as {
      page: OncallPageDto;
    };
    expect(detail.page).toMatchObject({
      status: "acknowledged",
      acknowledgedBy: { userId: "user_b" },
      nextEscalationAt: null,
      escalationStep: 2,
    });

    // Resolving closes the dedup window, so the same key pages again.
    const resolved = await call(
      "POST",
      `/api/agent/pages/${first.page.id}/resolve`,
      { note: "Rolled back" },
      WRITER,
    );
    expect(((await resolved.json()) as { page: OncallPageDto }).page.status).toBe("resolved");
    as("user_a");
    expect((await page(group.id, { title: "API down", dedupKey: "api-5xx" })).status).toBe(201);
  });

  it("escalates on request and rejects reused or foreign credentials", async () => {
    const group = await createGroup("Manual", [{ afterMinutes: 30, target: "group" }]);
    const created = (await (
      await page(group.id, { title: "Disk full" })
    ).json()) as OncallPageCreateResponse;
    const aToken = responseTokenFor("user_a");

    as("user_b");
    const escalated = await call("POST", `/api/pages/${created.page.id}/escalate`);
    const escalatedPage = ((await escalated.json()) as { page: OncallPageDto }).page;
    expect(escalatedPage.notified.map((person) => person.userId).sort()).toEqual([
      "user_a",
      "user_b",
      "user_c",
    ]);
    expect(escalatedPage.nextEscalationAt).toBeNull();
    expect((await call("POST", `/api/pages/${created.page.id}/escalate`)).status).toBe(409);

    expect(
      (
        await call("POST", `/api/page-responses/${created.page.id}/acknowledge`, {
          responseToken: "x".repeat(43),
        })
      ).status,
    ).toBe(404);
    const resolved = await call("POST", `/api/pages/${created.page.id}/resolve`, {});
    expect(resolved.status).toBe(200);
    // A credential cannot acknowledge a page that is already closed.
    expect(
      (
        await call("POST", `/api/page-responses/${created.page.id}/acknowledge`, {
          responseToken: aToken,
        })
      ).status,
    ).toBe(409);
  });

  it("falls back to the whole group when nobody is on call", async () => {
    const group = await createGroup("Future");
    const { eq } = await import("drizzle-orm");
    await db
      .update(schema.oncallGroup)
      .set({ startsAt: new Date(Date.now() + 7 * 86_400_000) })
      .where(eq(schema.oncallGroup.id, group.id));
    const created = (await (
      await page(group.id, { title: "Nobody home" })
    ).json()) as OncallPageCreateResponse;
    expect(created.page.notified.map((person) => person.userId).sort()).toEqual([
      "user_a",
      "user_b",
      "user_c",
    ]);
  });

  it("accepts pages from agents and webhooks but keeps acknowledgement human-only", async () => {
    const group = await createGroup("Automated");
    const agentPage = await call(
      "POST",
      `/api/agent/oncall/${group.id}/pages`,
      { title: "Queue backlog" },
      WRITER,
    );
    expect(agentPage.status).toBe(201);
    const { page: raised } = (await agentPage.json()) as OncallPageCreateResponse;
    expect(raised.source).toBe("Monitor bot");
    expect(
      (await call("POST", `/api/agent/oncall/${group.id}/pages`, { title: "x" }, READER)).status,
    ).toBe(403);
    expect(
      (await call("POST", `/api/agent/pages/${raised.id}/acknowledge`, {}, WRITER)).status,
    ).toBe(404);
    expect((await call("POST", `/api/agent/pages/${raised.id}/escalate`, {}, WRITER)).status).toBe(
      404,
    );

    const viaNotify = await call(
      "POST",
      "/api/agent/notifications",
      { title: "Cron failed", body: "Nightly export failed", oncall: group.id },
      WRITER,
    );
    expect(viaNotify.status).toBe(201);
    const unscoped = await call(
      "POST",
      "/api/agent/notifications",
      { body: "x", oncall: group.id },
      NOTIFIER,
    );
    expect(unscoped.status).toBe(403);
    expect(await unscoped.json()).toMatchObject({ required: ["oncall:write"] });
    expect(((await viaNotify.json()) as OncallPageCreateResponse).page.title).toBe("Cron failed");

    const hook = await call("POST", `/hooks/${WEBHOOK}`, {
      body: "Site unreachable",
      oncall: group.id,
    });
    expect(hook.status).toBe(201);
    const hookBody = (await hook.json()) as { ok: boolean; pageId: string; delivered: number };
    expect(hookBody).toMatchObject({ ok: true, delivered: 1 });
    const hookPage = (await (await call("GET", `/api/pages/${hookBody.pageId}`)).json()) as {
      page: OncallPageDto;
    };
    expect(hookPage.page).toMatchObject({
      title: "Uptime",
      body: "Site unreachable",
      source: "Uptime",
    });

    expect(
      (
        await call("POST", `/hooks/${WEBHOOK}`, {
          body: "x",
          oncall: group.id,
          deviceIds: ["dev_user_a"],
        })
      ).status,
    ).toBe(400);
    expect(
      (await call("POST", `/hooks/${OUTSIDER_WEBHOOK}`, { body: "x", oncall: group.id })).status,
    ).toBe(404);

    const listed = await call(
      "GET",
      `/api/agent/teams/${TEAM_ID}/pages?limit=2&status=all`,
      undefined,
      READER,
    );
    const pageList = (await listed.json()) as { pages: OncallPageDto[]; nextCursor: string | null };
    expect(pageList.pages).toHaveLength(2);
    expect(pageList.nextCursor).not.toBeNull();
    const next = await call(
      "GET",
      `/api/teams/${TEAM_ID}/pages?limit=2&status=all&cursor=${pageList.nextCursor}`,
    );
    const nextList = (await next.json()) as { pages: OncallPageDto[] };
    expect(nextList.pages.map((entry) => entry.id)).not.toContain(pageList.pages[0]?.id);
    expect(nextList.pages).toHaveLength(2);
  });

  it("caps new pages per group per minute but still merges duplicates", async () => {
    const group = await createGroup("Flood");
    for (let index = 0; index < oncall.PAGES_PER_GROUP_PER_MINUTE; index += 1) {
      expect(
        (await page(group.id, { title: `Alert ${index}`, dedupKey: `k${index}` })).status,
      ).toBe(201);
    }
    sent.length = 0;
    const limited = await page(group.id, { title: "One too many" });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "On-call page rate limit exceeded" });
    const viaHook = await call("POST", `/hooks/${WEBHOOK}`, { body: "x", oncall: group.id });
    expect(viaHook.status).toBe(429);
    expect(viaHook.headers.get("retry-after")).toBe("60");
    expect(sent).toHaveLength(0);
    const merged = await page(group.id, { title: "Alert 0", dedupKey: "k0" });
    expect(merged.status).toBe(200);
  });

  it("holds the group cap under concurrent pages and merges concurrent duplicates", async () => {
    const { eq } = await import("drizzle-orm");
    const group = await createGroup("Stampede");
    const attempts = oncall.PAGES_PER_GROUP_PER_MINUTE * 2;
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_, index) =>
        page(group.id, { title: `Burst ${index}`, dedupKey: `burst-${index}` }),
      ),
    );
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(
      oncall.PAGES_PER_GROUP_PER_MINUTE,
    );
    expect(statuses.filter((status) => status === 429)).toHaveLength(
      attempts - oncall.PAGES_PER_GROUP_PER_MINUTE,
    );
    const stored = await db
      .select()
      .from(schema.oncallPage)
      .where(eq(schema.oncallPage.groupId, group.id));
    expect(stored).toHaveLength(oncall.PAGES_PER_GROUP_PER_MINUTE);

    const echo = await createGroup("Echo");
    const duplicates = await Promise.all(
      Array.from({ length: 5 }, () => page(echo.id, { title: "Disk full", dedupKey: "disk" })),
    );
    expect(duplicates.map((response) => response.status).sort()).toEqual([200, 200, 200, 200, 201]);
    const [open] = await db
      .select()
      .from(schema.oncallPage)
      .where(eq(schema.oncallPage.groupId, echo.id));
    expect(open?.repeatCount).toBe(4);
  });

  it("counts pages against the webhook's service window and the token's requester window", async () => {
    const { eq } = await import("drizzle-orm");
    const { env } = await import("../env");
    const { hashApiToken, hashWebhookToken } = await import("../lib/token");
    const pagerWebhook = "whk_pager_webhook_token_00000000000000";
    const pagerToken = `hark_${"p".repeat(43)}`;
    const now = new Date();
    await db.insert(schema.service).values({
      id: "svc_pager",
      userId: "user_a",
      title: "Pager",
      tokenHash: hashWebhookToken(pagerWebhook),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.apiToken).values({
      id: "tok_pager",
      userId: "user_a",
      name: "Pager bot",
      tokenHash: hashApiToken(pagerToken),
      prefix: "hark_ppppppp",
      scopes: ["oncall:write", "notifications:send"],
      createdAt: now,
    });
    const group = await createGroup("Windowed");
    const previous = env.SERVICE_RATE_LIMIT_PER_MINUTE;
    env.SERVICE_RATE_LIMIT_PER_MINUTE = 1;
    try {
      const first = await call("POST", `/hooks/${pagerWebhook}`, { body: "a", oncall: group.id });
      expect(first.status).toBe(201);
      const { pageId } = (await first.json()) as { pageId: string };
      const [row] = await db
        .select()
        .from(schema.oncallPage)
        .where(eq(schema.oncallPage.id, pageId));
      expect(row).toMatchObject({ requesterServiceId: "svc_pager", requesterTokenId: null });
      const second = await call("POST", `/hooks/${pagerWebhook}`, { body: "b", oncall: group.id });
      expect(second.status).toBe(429);
      expect(await second.json()).toMatchObject({ error: "Service rate limit exceeded" });

      const agent = await call(
        "POST",
        `/api/agent/oncall/${group.id}/pages`,
        { title: "c" },
        pagerToken,
      );
      expect(agent.status).toBe(201);
      const { page: raised } = (await agent.json()) as OncallPageCreateResponse;
      const [agentRow] = await db
        .select()
        .from(schema.oncallPage)
        .where(eq(schema.oncallPage.id, raised.id));
      expect(agentRow).toMatchObject({ requesterTokenId: "tok_pager", requesterServiceId: null });
      sent.length = 0;
      const again = await call(
        "POST",
        `/api/agent/oncall/${group.id}/pages`,
        { title: "d" },
        pagerToken,
      );
      expect(again.status).toBe(429);
      expect(await again.json()).toMatchObject({ error: "Requester rate limit exceeded" });
      expect(sent).toHaveLength(0);

      env.SERVICE_RATE_LIMIT_PER_MINUTE = 2;
      const notify = await call(
        "POST",
        "/api/agent/notifications",
        { title: "e", body: "e", oncall: group.id },
        pagerToken,
      );
      expect(notify.status).toBe(201);
      const { page: notified } = (await notify.json()) as OncallPageCreateResponse;
      const [notifyRow] = await db
        .select()
        .from(schema.oncallPage)
        .where(eq(schema.oncallPage.id, notified.id));
      expect(notifyRow?.requesterTokenId).toBe("tok_pager");
      const blocked = await call(
        "POST",
        "/api/agent/notifications",
        { title: "f", body: "f", oncall: group.id },
        pagerToken,
      );
      expect(blocked.status).toBe(429);
      expect(await blocked.json()).toMatchObject({ error: "Requester rate limit exceeded" });
    } finally {
      env.SERVICE_RATE_LIMIT_PER_MINUTE = previous;
    }
  });

  it("applies the account rate limit to webhook and agent pages", async () => {
    const { env } = await import("../env");
    const group = await createGroup("Throttled");
    expect((await page(group.id, { title: "Counted" })).status).toBe(201);
    const previous = env.ACCOUNT_RATE_LIMIT_PER_MINUTE;
    env.ACCOUNT_RATE_LIMIT_PER_MINUTE = 1;
    sent.length = 0;
    try {
      const hook = await call("POST", `/hooks/${WEBHOOK}`, { body: "x", oncall: group.id });
      expect(hook.status).toBe(429);
      expect(await hook.json()).toMatchObject({ error: "Account rate limit exceeded" });
      const notify = await call(
        "POST",
        "/api/agent/notifications",
        { title: "x", body: "x", oncall: group.id },
        WRITER,
      );
      expect(notify.status).toBe(429);
      const agent = await call(
        "POST",
        `/api/agent/oncall/${group.id}/pages`,
        { title: "x" },
        WRITER,
      );
      expect(agent.status).toBe(429);
      expect(agent.headers.get("retry-after")).toBe("60");
      expect(sent).toHaveLength(0);
    } finally {
      env.ACCOUNT_RATE_LIMIT_PER_MINUTE = previous;
    }
  });

  it("refuses page credentials and skips paging for members removed from the allowlist", async () => {
    const { env } = await import("../env");
    const { eq } = await import("drizzle-orm");
    const group = await createGroup("Allowlist", [{ afterMinutes: 30, target: "group" }]);
    const created = (await (
      await page(group.id, { title: "Before removal" })
    ).json()) as OncallPageCreateResponse;
    expect((await call("POST", `/api/pages/${created.page.id}/escalate`)).status).toBe(200);
    const bToken = responseTokenFor("user_b");

    const previous = [...env.ALLOWED_EMAILS];
    env.ALLOWED_EMAILS.splice(
      0,
      env.ALLOWED_EMAILS.length,
      "user_a@example.com",
      "user_c@example.com",
    );
    try {
      const refused = await call("POST", `/api/page-responses/${created.page.id}/acknowledge`, {
        responseToken: bToken,
      });
      expect(refused.status).toBe(404);
      expect(
        (
          await call("POST", `/api/page-responses/${created.page.id}/escalate`, {
            responseToken: bToken,
          })
        ).status,
      ).toBe(404);

      await db
        .update(schema.oncallGroup)
        .set({ startsAt: new Date(Date.now() + 7 * 86_400_000) })
        .where(eq(schema.oncallGroup.id, group.id));
      sent.length = 0;
      const fallback = (await (
        await page(group.id, { title: "After removal" })
      ).json()) as OncallPageCreateResponse;
      expect(fallback.page.notified.map((person) => person.userId).sort()).toEqual([
        "user_a",
        "user_c",
      ]);
      expect(pushesTo("user_b")).toHaveLength(0);
    } finally {
      env.ALLOWED_EMAILS.splice(0, env.ALLOWED_EMAILS.length, ...previous);
    }
  });

  it("drops removed members from rotations", async () => {
    const group = await createGroup("Shrinking");
    expect((await call("DELETE", `/api/teams/${TEAM_ID}/members/user_c`)).status).toBe(200);
    const after = (
      (await (await call("GET", `/api/oncall/${group.id}`)).json()) as {
        group: OncallGroupDto;
      }
    ).group;
    expect(after.rotation.members.map((member) => member.userId)).toEqual(["user_a", "user_b"]);
    as("user_c");
    expect((await call("GET", `/api/oncall/${group.id}`)).status).toBe(404);
  });
});
