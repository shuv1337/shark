import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { outbound, type RequestFn } from "../lib/outbound";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";
process.env.APP_URL = "https://shark.example";

const authState = vi.hoisted(() => ({ userId: "cap" as string | null, sessionId: "sess_1" }));
const sent = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const pushState = vi.hoisted(() => ({ fail: false }));
const callbacks = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; authorization: string | null; body: Record<string, unknown> }>,
  status: 200,
}));

vi.mock("../lib/billing", () => ({
  getBilling: async () => ({
    configured: true,
    plan: "pro",
    priceMonthly: 8,
    features: { deviceRouting: true },
    limits: {
      devices: null,
      notificationsPerMonth: 100_000,
      servicePerMinute: 10_000,
      accountPerMinute: 10_000,
    },
    usage: { notificationsRemaining: 100 },
  }),
  checkNotificationAllowance: async () => true,
  trackNotification: async () => undefined,
  hasAutumn: () => false,
  clearBillingCache: () => undefined,
  createCheckout: async () => "https://example.com/checkout",
  createBillingPortal: async () => "https://example.com/portal",
}));

vi.mock("../auth", () => ({
  auth: {
    handler: () => new Response("not used"),
    api: {
      getSession: async () =>
        authState.userId
          ? {
              session: { id: authState.sessionId },
              user: {
                id: authState.userId,
                name: "Cap",
                email: authState.userId === "cap" ? "cap@example.com" : "other@example.com",
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
      if (pushState.fail) throw new Error("push provider unavailable");
      sent.push(...messages);
      return messages.map(() => ({ status: "ok", id: "ticket" }));
    }
  }
  return { Expo, default: Expo };
});

let app: typeof import("../app")["app"];
let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");
let board: typeof import("../lib/board");
let boardCallbacks: typeof import("../lib/board-callbacks");
let boardStream: typeof import("../lib/board-stream");

const FM = `hark_${"f".repeat(43)}`;
const BRO = `hark_${"b".repeat(43)}`;
const READ_ONLY = `hark_${"r".repeat(43)}`;
const OTHER_USER = `hark_${"o".repeat(43)}`;
const ORIGIN = { origin: "https://shark.example" };

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  board = await import("../lib/board");
  boardCallbacks = await import("../lib/board-callbacks");
  boardStream = await import("../lib/board-stream");
  const { hashApiToken } = await import("../lib/token");
  const { runMigrations } = await import("../db/migrate");
  runMigrations();

  const now = new Date();
  await db.insert(schema.user).values([
    {
      id: "cap",
      name: "Cap",
      email: "cap@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "other",
      name: "Other",
      email: "other@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.device).values({
    id: "dev_1",
    userId: "cap",
    expoPushToken: "ExponentPushToken[cap]",
    platform: "ios",
    active: true,
    createdAt: now,
    lastSeenAt: now,
  });
  await db.insert(schema.apiToken).values([
    {
      id: "tok_fm",
      userId: "cap",
      name: "Firstmate (box)",
      tokenHash: hashApiToken(FM),
      prefix: FM.slice(0, 13),
      scopes: ["board:read", "board:write"],
      createdAt: now,
    },
    {
      id: "tok_bro",
      userId: "cap",
      name: "Bro (shuvdev)",
      tokenHash: hashApiToken(BRO),
      prefix: BRO.slice(0, 13),
      scopes: ["board:read", "board:write"],
      createdAt: now,
    },
    {
      id: "tok_read",
      userId: "cap",
      name: "Reader",
      tokenHash: hashApiToken(READ_ONLY),
      prefix: READ_ONLY.slice(0, 13),
      scopes: ["board:read"],
      createdAt: now,
    },
    {
      id: "tok_other",
      userId: "other",
      name: "Stranger",
      tokenHash: hashApiToken(OTHER_USER),
      prefix: OTHER_USER.slice(0, 13),
      scopes: ["board:read", "board:write"],
      createdAt: now,
    },
  ]);
  await db.insert(schema.app).values({
    id: "app_boardboard",
    userId: "cap",
    name: "Sharkboard",
    url: "https://shark.example/board",
    origin: "https://shark.example",
    createdAt: now,
    updatedAt: now,
  });
});

afterEach(async () => {
  authState.userId = "cap";
  sent.length = 0;
  pushState.fail = false;
  callbacks.calls.length = 0;
  callbacks.status = 200;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  boardStream.resetBoardStream();
  await db.delete(schema.boardAskEvent);
  await db.delete(schema.boardWorkItem);
  await db.delete(schema.boardNote);
  await db.delete(schema.boardAsk);
  await db.delete(schema.agentNotification);
});

function agent(path: string, token = FM, init?: RequestInit) {
  return app.request(`/api/agent/board${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });
}

function session(path: string, init?: RequestInit, headers: Record<string, string> = ORIGIN) {
  return app.request(`/api/board${path === "/" ? "" : path}`, {
    ...init,
    headers: { "content-type": "application/json", ...headers, ...init?.headers },
  });
}

const baseAsk = {
  key: "fm:FM-CAP-BOARD-2:pick",
  title: "Ship the board now?",
  body: "Web first, native later.",
  options: [
    { id: "ship", label: "Ship", style: "primary" },
    { id: "wait", label: "Wait" },
  ],
  allowText: true,
  priority: "p1",
  taskId: "FM-CAP-BOARD-2",
  links: [{ kind: "pr", url: "https://github.com/shuv1337/shark/pull/82" }],
};

/** Synthetic DNS and socket: names resolve to a public IP and requests are captured. */
function stubCallbackTransport(address = "93.184.216.34") {
  vi.spyOn(outbound, "resolve").mockImplementation(async () => [{ address, family: 4 }]);
  return vi.spyOn(outbound, "request").mockImplementation(((
    options: RequestOptions,
    onResponse: (response: IncomingMessage) => void,
  ) => {
    const req = new EventEmitter() as EventEmitter & {
      end: (body: Buffer) => void;
      destroy: () => void;
    };
    req.destroy = () => undefined;
    req.end = (body) => {
      const headers = options.headers as Record<string, string>;
      callbacks.calls.push({
        url: `https://${headers.host}${options.path}`,
        authorization: headers.authorization ?? null,
        body: JSON.parse(body.toString()) as Record<string, unknown>,
      });
      const response = Object.assign(new EventEmitter(), { statusCode: callbacks.status });
      queueMicrotask(() => onResponse(response as unknown as IncomingMessage));
    };
    return req as unknown as ClientRequest;
  }) as RequestFn);
}

async function createAsk(overrides: Record<string, unknown> = {}, token = FM) {
  const response = await agent("/asks", token, {
    method: "PUT",
    body: JSON.stringify({ ...baseAsk, ...overrides }),
  });
  const body = (await response.json()) as {
    ask: { id: string; digest: string; revision: number; status: string };
    created: boolean;
    changed: boolean;
    pushed: boolean;
    error?: string;
  };
  return { response, body };
}

describe("agent asks", () => {
  it("creates once, re-asserts silently, and revises with a new digest and push", async () => {
    const first = await createAsk();
    expect(first.response.status).toBe(201);
    expect(first.body.created).toBe(true);
    expect(first.body.pushed).toBe(true);
    expect(sent).toHaveLength(1);
    // The push carries agent and title only, deep-links into the board, and opens the board app.
    expect(sent[0]).toMatchObject({ title: "Firstmate (box)", body: "Ship the board now?" });
    expect(sent[0]?.data).toMatchObject({
      appId: "app_boardboard",
      url: `https://shark.example/board/ask/${first.body.ask.id}`,
    });
    expect(JSON.stringify(sent[0])).not.toContain("Web first, native later.");

    const again = await createAsk();
    expect(again.response.status).toBe(200);
    expect(again.body.created).toBe(false);
    expect(again.body.changed).toBe(false);
    expect(again.body.ask.revision).toBe(1);
    expect(sent).toHaveLength(1);

    const revised = await createAsk({ title: "Ship the board today?" });
    expect(revised.body.changed).toBe(true);
    expect(revised.body.ask.revision).toBe(2);
    expect(revised.body.ask.digest).not.toBe(first.body.ask.digest);
    expect(sent).toHaveLength(2);

    const events = await db
      .select()
      .from(schema.boardAskEvent)
      .where(eq(schema.boardAskEvent.askId, first.body.ask.id));
    expect(events.map((event) => event.kind).sort()).toEqual([
      "opened",
      "pushed",
      "pushed",
      "revised",
    ]);
  });

  it("keeps p2 asks and push:none off the phone", async () => {
    const quiet = await createAsk({ priority: "p2" });
    expect(quiet.body.pushed).toBe(false);
    const silent = await createAsk({ key: "fm:other", push: "none" });
    expect(silent.body.pushed).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("refuses secrets, invalid shapes, foreign keys, and more than the cap", async () => {
    const secret = await createAsk({ body: `Use token hark_${"x".repeat(43)} please` });
    expect(secret.response.status).toBe(422);
    const noAnswer = await createAsk({ options: [], allowText: false });
    expect(noAnswer.response.status).toBe(400);
    const badLink = await createAsk({ links: [{ kind: "pr", url: "http://insecure.example/" }] });
    expect(badLink.response.status).toBe(400);

    await createAsk();
    const stolen = await createAsk({}, BRO);
    expect(stolen.response.status).toBe(409);

    const readOnly = await agent("/asks", READ_ONLY, {
      method: "PUT",
      body: JSON.stringify(baseAsk),
    });
    expect(readOnly.status).toBe(403);

    for (let index = 1; index < 50; index += 1) {
      const { response } = await createAsk({ key: `fm:bulk:${index}`, priority: "p2" });
      expect(response.status).toBe(201);
    }
    const overflow = await createAsk({ key: "fm:bulk:overflow", priority: "p2" });
    expect(overflow.response.status).toBe(409);
  });

  it("screens keys, reasons, and callbacks, and refuses private callback hosts", async () => {
    const secretKey = await createAsk({ key: `fm:hark_${"a".repeat(43)}` });
    expect(secretKey.response.status).toBe(422);
    const hidden = await createAsk({ title: `Use hark_\u200b${"a".repeat(43)}` });
    expect(hidden.response.status).toBe(400);
    for (const url of ["https://127.0.0.1/hook", "https://10.1.2.3/hook", "https://box.local/h"]) {
      const { response } = await createAsk({ callback: { url, token: "k".repeat(32) } });
      expect(response.status).toBe(400);
    }
    await createAsk();
    const cancelled = await agent(`/asks/${encodeURIComponent(baseAsk.key)}/cancel`, FM, {
      method: "POST",
      body: JSON.stringify({ reason: `moved to hark_${"b".repeat(43)}` }),
    });
    expect(cancelled.status).toBe(422);
  });

  it("retries a failed push on re-assert under the same notification", async () => {
    pushState.fail = true;
    const first = await createAsk();
    expect(first.response.status).toBe(201);
    expect(first.body.pushed).toBe(false);
    let rows = await db.select().from(schema.agentNotification);
    expect(rows.map((row) => row.status)).toEqual(["failed"]);

    pushState.fail = false;
    const again = await createAsk();
    expect(again.response.status).toBe(200);
    expect(again.body.changed).toBe(false);
    expect(again.body.pushed).toBe(true);
    rows = await db.select().from(schema.agentNotification);
    expect(rows.map((row) => row.status)).toEqual(["accepted"]);
    expect(sent).toHaveLength(1);

    const third = await createAsk();
    expect(third.body.pushed).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("opens the board app only for an exact board URL", async () => {
    const { isBoardAppUrl } = await import("../lib/board-push");
    expect(isBoardAppUrl("https://shark.example/board")).toBe(true);
    expect(isBoardAppUrl("https://shark.example/board/ask/bask_1")).toBe(true);
    expect(isBoardAppUrl("https://shark.example/board-evil")).toBe(false);
    expect(isBoardAppUrl("https://shark.example/boarder")).toBe(false);
    expect(isBoardAppUrl("https://evil.example/board")).toBe(false);

    const now = new Date();
    await db.insert(schema.app).values({
      id: "app_decoy",
      userId: "cap",
      name: "Boarder",
      url: "https://shark.example/boarder",
      origin: "https://shark.example",
      lastOpenedAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    });
    try {
      await createAsk();
      expect((sent[0]?.data as { appId?: string } | undefined)?.appId).toBe("app_boardboard");
    } finally {
      await db.delete(schema.app).where(eq(schema.app.id, "app_decoy"));
    }
  });

  it("lets only the owning agent read, cancel, and ack its ask", async () => {
    const { body } = await createAsk();
    expect((await agent("/asks/fm:FM-CAP-BOARD-2:pick", BRO)).status).toBe(404);
    expect((await agent("/asks/fm:FM-CAP-BOARD-2:pick", OTHER_USER)).status).toBe(404);
    const mine = await agent("/asks/fm:FM-CAP-BOARD-2:pick");
    expect(mine.status).toBe(200);
    expect(((await mine.json()) as { ask: { id: string } }).ask.id).toBe(body.ask.id);

    const cancelled = await agent("/asks/fm:FM-CAP-BOARD-2:pick/cancel", FM, {
      method: "POST",
      body: JSON.stringify({ reason: "Decided in chat" }),
    });
    expect(cancelled.status).toBe(200);
    expect(((await cancelled.json()) as { ask: { status: string } }).ask.status).toBe("cancelled");

    const answers = await agent("/answers");
    const page = (await answers.json()) as {
      events: Array<{ status: string; cancelReason: string; eventId: string }>;
      cursor: string;
    };
    expect(page.events).toHaveLength(1);
    expect(page.events[0]).toMatchObject({ status: "cancelled", cancelReason: "Decided in chat" });
    const after = await agent(`/answers?since=${encodeURIComponent(page.cursor)}`);
    expect(((await after.json()) as { events: unknown[] }).events).toEqual([]);

    const acked = await agent("/asks/fm:FM-CAP-BOARD-2:pick/ack", FM, { method: "POST" });
    expect(acked.status).toBe(200);
    expect((await agent("/asks/fm:FM-CAP-BOARD-2:pick/ack", FM, { method: "POST" })).status).toBe(
      404,
    );
  });

  it("long-polls until the captain answers", async () => {
    const { body } = await createAsk();
    const waiting = agent("/asks/fm:FM-CAP-BOARD-2:pick/wait?timeout=5");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const answered = await session(`/asks/${body.ask.id}/answer`, {
      method: "POST",
      body: JSON.stringify({ digest: body.ask.digest, optionId: "ship" }),
    });
    expect(answered.status).toBe(200);
    const result = (await (await waiting).json()) as { ask: { status: string }; timedOut: boolean };
    expect(result.timedOut).toBe(false);
    expect(result.ask.status).toBe("answered");

    const timed = await agent("/asks/fm:FM-CAP-BOARD-2:pick/wait?timeout=0");
    expect(((await timed.json()) as { timedOut: boolean }).timedOut).toBe(false);
  });
});

describe("captain actions", () => {
  it("builds the page with lanes and crew, and answers only with a current digest", async () => {
    const { body } = await createAsk();
    await createAsk(
      {
        key: "bro:sb-1",
        title: "Merge sb-1?",
        options: [{ id: "yes", label: "Yes" }],
        priority: "p0",
      },
      BRO,
    );
    await agent("/work", BRO, {
      method: "PUT",
      body: JSON.stringify({
        key: "bro:sb-2",
        title: "CI speedup",
        state: "in_flight",
        statusLabel: "Testing",
        progress: 0.5,
        host: "shuvdev",
      }),
    });
    await agent("/work", FM, {
      method: "PUT",
      body: JSON.stringify({ key: "fm:q1", title: "Queued thing", state: "queued" }),
    });
    await agent("/notes", FM, {
      method: "PUT",
      body: JSON.stringify({ key: "fm:heads", text: "Disk is at 80%" }),
    });

    const page = (await (await session("/")).json()) as {
      waiting: Array<{ id: string; priority: string; agent: string }>;
      withAgent: unknown[];
      inFlight: Array<{ title: string }>;
      queued: Array<{ title: string }>;
      notes: Array<{ text: string }>;
      crew: Array<{ agent: string; openAsks: number; inFlight: number }>;
      cursor: string;
    };
    expect(page.waiting.map((ask) => ask.priority)).toEqual(["p0", "p1"]);
    expect(page.inFlight.map((item) => item.title)).toEqual(["CI speedup"]);
    expect(page.queued.map((item) => item.title)).toEqual(["Queued thing"]);
    expect(page.notes.map((note) => note.text)).toEqual(["Disk is at 80%"]);
    expect(page.crew.map((entry) => [entry.agent, entry.openAsks, entry.inFlight]).sort()).toEqual([
      ["Bro (shuvdev)", 1, 1],
      ["Firstmate (box)", 1, 0],
    ]);

    const stale = await session(`/asks/${body.ask.id}/answer`, {
      method: "POST",
      body: JSON.stringify({ digest: "0".repeat(64), optionId: "ship" }),
    });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { ask: { id: string } }).ask.id).toBe(body.ask.id);

    const crossSite = await session(
      `/asks/${body.ask.id}/answer`,
      { method: "POST", body: JSON.stringify({ digest: body.ask.digest, optionId: "ship" }) },
      { origin: "https://evil.example" },
    );
    expect(crossSite.status).toBe(403);

    const unknownOption = await session(`/asks/${body.ask.id}/answer`, {
      method: "POST",
      body: JSON.stringify({ digest: body.ask.digest, optionId: "nope" }),
    });
    expect(unknownOption.status).toBe(422);

    const answered = await session(`/asks/${body.ask.id}/answer`, {
      method: "POST",
      body: JSON.stringify({ digest: body.ask.digest, text: "Ship it, but tag the release." }),
    });
    expect(answered.status).toBe(200);
    const answeredBody = (await answered.json()) as {
      ask: { status: string; answer: { text: string; via: string } };
    };
    expect(answeredBody.ask.answer).toMatchObject({
      text: "Ship it, but tag the release.",
      via: "web",
    });

    const twice = await session(`/asks/${body.ask.id}/answer`, {
      method: "POST",
      body: JSON.stringify({ digest: body.ask.digest, optionId: "ship" }),
    });
    expect(twice.status).toBe(409);

    const detail = (await (await session(`/asks/${body.ask.id}`)).json()) as {
      events: Array<{ kind: string; actorType: string }>;
    };
    expect(detail.events.find((event) => event.kind === "answered")?.actorType).toBe("session");

    const after = (await (await session("/")).json()) as {
      waiting: unknown[];
      withAgent: Array<{ id: string }>;
    };
    expect(after.waiting).toHaveLength(1);
    expect(after.withAgent.map((ask) => ask.id)).toEqual([body.ask.id]);

    // Another account sees nothing.
    authState.userId = "other";
    const theirs = (await (await session("/")).json()) as { waiting: unknown[]; crew: unknown[] };
    expect(theirs.waiting).toEqual([]);
    expect(theirs.crew).toEqual([]);
    expect((await session(`/asks/${body.ask.id}`)).status).toBe(404);
  });

  it("snoozes and dismisses, and dismissal reaches the agent as cancelled", async () => {
    const { body } = await createAsk();
    const snoozed = await session(`/asks/${body.ask.id}/snooze`, {
      method: "POST",
      body: JSON.stringify({ digest: body.ask.digest, until: "2099-01-01" }),
    });
    expect(snoozed.status).toBe(200);
    const page = (await (await session("/")).json()) as { waiting: unknown[] };
    expect(page.waiting).toEqual([]);
    const still = (await (await agent("/asks/fm:FM-CAP-BOARD-2:pick")).json()) as {
      ask: { status: string };
    };
    expect(still.ask.status).toBe("open");

    const past = await session(`/asks/${body.ask.id}/snooze`, {
      method: "POST",
      body: JSON.stringify({ digest: body.ask.digest, until: "2000-01-01" }),
    });
    expect(past.status).toBe(422);

    const dismissed = await session(`/asks/${body.ask.id}/dismiss`, {
      method: "POST",
      body: JSON.stringify({ digest: body.ask.digest, reason: "Not needed" }),
    });
    expect(dismissed.status).toBe(200);
    const answers = (await (await agent("/answers")).json()) as {
      events: Array<{ status: string; cancelReason: string }>;
    };
    expect(answers.events[0]).toMatchObject({ status: "cancelled", cancelReason: "Not needed" });
  });

  it("requires a session for every captain route", async () => {
    authState.userId = null;
    expect((await session("/")).status).toBe(401);
    expect((await session("/stream")).status).toBe(401);
  });
});

describe("work, notes, done", () => {
  it("heartbeats work items, completes them, and keeps notes per key", async () => {
    const created = await agent("/work", BRO, {
      method: "PUT",
      body: JSON.stringify({ key: "bro:sb-3", title: "Mate", state: "queued" }),
    });
    expect(created.status).toBe(201);
    const running = await agent("/work", BRO, {
      method: "PUT",
      body: JSON.stringify({
        key: "bro:sb-3",
        title: "Mate",
        state: "in_flight",
        heartbeatTtlSeconds: 60,
      }),
    });
    const runningBody = (await running.json()) as {
      work: { startedAt: string | null; stale: boolean };
    };
    expect(runningBody.work.startedAt).not.toBeNull();
    expect(runningBody.work.stale).toBe(false);

    const [row] = await db
      .select()
      .from(schema.boardWorkItem)
      .where(eq(schema.boardWorkItem.workKey, "bro:sb-3"));
    expect(board.toWorkDto(row as never, new Date(Date.now() + 120_000)).stale).toBe(true);

    const other = await agent("/work", FM, {
      method: "PUT",
      body: JSON.stringify({ key: "bro:sb-3", title: "Mate", state: "queued" }),
    });
    expect(other.status).toBe(409);

    const done = await agent("/work/bro:sb-3/done", BRO, {
      method: "POST",
      body: JSON.stringify({
        verb: "merged",
        links: [{ kind: "pr", url: "https://github.com/x/y/pull/1" }],
      }),
    });
    expect(done.status).toBe(200);
    const doneBody = (await done.json()) as {
      work: { state: string; completionVerb: string; completedAt: string };
    };
    expect(doneBody.work).toMatchObject({ state: "done", completionVerb: "merged" });

    const fresh = await agent("/work/fm:new/done", FM, {
      method: "POST",
      body: JSON.stringify({ title: "One-off", verb: "shipped" }),
    });
    expect(fresh.status).toBe(200);
    const untitled = await agent("/work/fm:untitled/done", FM, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(untitled.status).toBe(422);

    const page = (await (await session("/")).json()) as {
      done: Array<{ kind: string; item: { title: string } }>;
    };
    expect(page.done.map((entry) => entry.item.title)).toEqual(["One-off", "Mate"]);

    const note = await agent("/notes", FM, {
      method: "PUT",
      body: JSON.stringify({ key: "fm:n", text: "Heads up" }),
    });
    expect(note.status).toBe(201);
    const again = await agent("/notes", FM, {
      method: "PUT",
      body: JSON.stringify({ key: "fm:n", text: "Heads up, updated" }),
    });
    expect(again.status).toBe(200);
    expect((await agent("/notes/fm:n", BRO, { method: "DELETE" })).status).toBe(404);
    expect((await agent("/notes/fm:n", FM, { method: "DELETE" })).status).toBe(200);
  });
});

describe("work re-posts", () => {
  type Work = {
    statusLabel: string | null;
    detail: string | null;
    progress: number | null;
    links: Array<{ url: string }>;
    host: string | null;
    waitingAskId: string | null;
    heartbeatTtlSeconds: number;
    agentDisplay: string | null;
  };
  const put = async (body: Record<string, unknown>) => {
    const response = await agent("/work", FM, { method: "PUT", body: JSON.stringify(body) });
    expect(response.status).toBeLessThan(300);
    return ((await response.json()) as { work: Work }).work;
  };

  it("keeps omitted fields on a heartbeat and clears only what is sent as null or []", async () => {
    const { body: asked } = await createAsk({ key: "fm:keep:ask" });
    const base = { key: "fm:keep", title: "Keep fields" };
    const first = await put({
      ...base,
      state: "in_flight",
      statusLabel: "Building",
      detail: "Step 2 of 3",
      progress: 0.6,
      links: [{ kind: "pr", url: "https://github.com/x/y/pull/9" }],
      host: "synthetic-host",
      waitingAskKey: "fm:keep:ask",
      heartbeatTtlSeconds: 600,
    });
    expect(first.waitingAskId).toBe(asked.ask.id);

    const blocked = await put({ ...base, state: "blocked" });
    expect(blocked).toMatchObject({
      statusLabel: "Building",
      detail: "Step 2 of 3",
      progress: 0.6,
      links: [{ url: "https://github.com/x/y/pull/9" }],
      host: "synthetic-host",
      waitingAskId: asked.ask.id,
      heartbeatTtlSeconds: 600,
    });

    const cleared = await put({
      ...base,
      state: "in_flight",
      statusLabel: null,
      detail: null,
      progress: null,
      links: [],
      host: null,
      waitingAskKey: null,
    });
    expect(cleared).toMatchObject({
      statusLabel: null,
      detail: null,
      progress: null,
      links: [],
      host: null,
      waitingAskId: null,
      heartbeatTtlSeconds: 600,
    });

    const created = await put({ key: "fm:fresh", title: "Fresh", state: "queued" });
    expect(created).toMatchObject({ links: [], progress: null, heartbeatTtlSeconds: 21_600 });
  });

  it("keeps both of two concurrent partial heartbeats", async () => {
    const base = { key: "fm:concurrent-keep", title: "Concurrent", state: "in_flight" };
    await put({ ...base, detail: "old", progress: 0.1 });
    await Promise.all([put({ ...base, detail: "new" }), put({ ...base, progress: 0.9 })]);
    expect(await put(base)).toMatchObject({ detail: "new", progress: 0.9 });
  });

  it("serializes a done with a heartbeat that races it", async () => {
    const [token] = await db.select().from(schema.apiToken).where(eq(schema.apiToken.id, "tok_fm"));
    if (!token) throw new Error("missing synthetic token");
    const pr = { kind: "pr", url: "https://github.com/x/y/pull/7" } as const;
    const ci = { kind: "other", url: "https://ci.example.com/run/7" } as const;
    const release = { kind: "doc", url: "https://releases.example.com/7" } as const;
    // Land the heartbeat at several points while the done is in progress.
    for (let ticks = 0; ticks < 8; ticks++) {
      const key = `fm:done-race:${ticks}`;
      await board.upsertWork(token, { key, title: "Race", state: "in_flight", links: [pr] });
      const done = board.markDone(token, {
        key,
        verb: "merged",
        outcome: "done",
        links: [release],
      });
      for (let i = 0; i < ticks; i++) await Promise.resolve();
      const beat = await board.upsertWork(token, {
        key,
        title: "Race",
        state: "review",
        links: [pr, ci],
      });
      expect((await done).ok && beat.ok).toBe(true);
      const [row] = await db
        .select()
        .from(schema.boardWorkItem)
        .where(eq(schema.boardWorkItem.workKey, key));
      // Either serial order is fine; a done built from the pre-heartbeat snapshot is not.
      if (row?.completedAt) {
        expect(
          row.links.map((link) => link.url),
          `ticks=${ticks}`,
        ).toEqual([pr.url, ci.url, release.url]);
      } else {
        expect(row, `ticks=${ticks}`).toMatchObject({ state: "review", links: [pr, ci] });
      }
    }
  });

  it("clears agentDisplay with null and restores the default TTL with null", async () => {
    const base = { key: "fm:nullable", title: "Nullable", state: "queued" };
    await put({ ...base, agentDisplay: "Synthetic Harness", heartbeatTtlSeconds: 600 });
    expect(await put(base)).toMatchObject({
      agentDisplay: "Synthetic Harness",
      heartbeatTtlSeconds: 600,
    });
    expect(await put({ ...base, agentDisplay: null, heartbeatTtlSeconds: null })).toMatchObject({
      agentDisplay: null,
      heartbeatTtlSeconds: 21_600,
    });
  });

  it("refuses an unknown waiting ask and drops the link once the work leaves blocked", async () => {
    const base = { key: "fm:waiting", title: "Waiting" };
    const unknown = await agent("/work", FM, {
      method: "PUT",
      body: JSON.stringify({ ...base, state: "blocked", waitingAskKey: "fm:waiting:none" }),
    });
    expect(unknown.status).toBe(400);

    const { body: asked } = await createAsk({ key: "fm:waiting:ask" });
    const blocked = await put({ ...base, state: "blocked", waitingAskKey: "fm:waiting:ask" });
    expect(blocked.waitingAskId).toBe(asked.ask.id);
    expect((await put({ ...base, state: "blocked" })).waitingAskId).toBe(asked.ask.id);
    expect((await put({ ...base, state: "in_flight" })).waitingAskId).toBeNull();

    const cancelled = await agent("/asks/fm:waiting:ask/cancel", FM, {
      method: "POST",
      body: JSON.stringify({ reason: "Decided in chat" }),
    });
    expect(cancelled.status).toBe(200);
    const late = await put({ ...base, state: "blocked", waitingAskKey: "fm:waiting:ask" });
    expect(late.waitingAskId).toBeNull();
  });

  it("shows the harness name a note was posted with", async () => {
    const note = await agent("/notes", FM, {
      method: "PUT",
      body: JSON.stringify({ key: "fm:who", text: "Heads up", agentDisplay: "Synthetic Harness" }),
    });
    expect(note.status).toBe(201);
    expect(((await note.json()) as { note: { agentDisplay: string } }).note.agentDisplay).toBe(
      "Synthetic Harness",
    );
  });
});

describe("expiry and callbacks", () => {
  it("expires due asks and delivers every terminal status to the callback with retries", async () => {
    stubCallbackTransport();
    const callback = { url: "https://grok.example/routine", token: "k".repeat(32) };
    const { body } = await createAsk({ expiresInSeconds: 60, callback });
    expect(await board.sweepExpiredAsks(new Date(Date.now() + 120_000))).toBe(1);
    // The sweep kicks delivery; joining it observes the delivered state.
    await boardCallbacks.deliverBoardCallbacks();
    const [expired] = await db
      .select()
      .from(schema.boardAsk)
      .where(eq(schema.boardAsk.id, body.ask.id));
    expect(expired?.status).toBe("expired");
    expect(expired?.callbackStatus).toBe("delivered");
    expect(callbacks.calls).toHaveLength(1);
    expect(callbacks.calls[0]).toMatchObject({
      url: "https://grok.example/routine",
      authorization: `Bearer ${"k".repeat(32)}`,
    });
    expect(callbacks.calls[0]?.body).toMatchObject({
      type: "board.ask.resolved",
      askId: body.ask.id,
      askKey: "fm:FM-CAP-BOARD-2:pick",
      status: "expired",
      eventId: `${body.ask.id}:r1:expired`,
      agent: "Firstmate (box)",
    });

    // A failing receiver is retried on the interaction schedule.
    callbacks.status = 503;
    const second = await createAsk({ key: "fm:second", callback });
    const dismissed = await session(`/asks/${second.body.ask.id}/dismiss`, {
      method: "POST",
      body: JSON.stringify({ digest: second.body.ask.digest }),
    });
    expect(dismissed.status).toBe(200);
    await boardCallbacks.deliverBoardCallbacks();
    const [retrying] = await db
      .select()
      .from(schema.boardAsk)
      .where(eq(schema.boardAsk.id, second.body.ask.id));
    expect(retrying?.callbackStatus).toBe("retrying");
    expect(retrying?.callbackAttempts).toBe(1);
    expect(retrying?.callbackNextAttemptAt?.getTime()).toBeGreaterThan(Date.now());

    callbacks.status = 200;
    await db
      .update(schema.boardAsk)
      .set({ callbackNextAttemptAt: new Date(0) })
      .where(eq(schema.boardAsk.id, second.body.ask.id));
    await boardCallbacks.deliverBoardCallbacks();
    const [delivered] = await db
      .select()
      .from(schema.boardAsk)
      .where(eq(schema.boardAsk.id, second.body.ask.id));
    expect(delivered?.callbackStatus).toBe("delivered");
    expect(callbacks.calls.at(-1)?.body).toMatchObject({
      status: "cancelled",
      cancelReason: "Dismissed by the captain",
    });

    // The answers feed carries the same events for polling agents.
    const answers = (await (await agent("/answers")).json()) as {
      events: Array<{ eventId: string }>;
    };
    expect(answers.events.map((event) => event.eventId)).toEqual([
      `${body.ask.id}:r1:expired`,
      `${second.body.ask.id}:r1:cancelled`,
    ]);
  });

  it("blocks a cancelled ask's callback when its name resolves to a private address", async () => {
    // No human answer is needed: an agent can create a silent ask and cancel it.
    const request = stubCallbackTransport("169.254.169.254");
    const callback = { url: "https://metadata.example/latest", token: "k".repeat(32) };
    const { body } = await createAsk({ key: "fm:probe", push: "none", callback });
    expect(body.pushed).toBe(false);
    const cancelled = await agent("/asks/fm:probe/cancel", FM, {
      method: "POST",
      body: JSON.stringify({ reason: "probe" }),
    });
    expect(cancelled.status).toBe(200);
    await boardCallbacks.deliverBoardCallbacks();
    expect(request).not.toHaveBeenCalled();
    const [row] = await db
      .select()
      .from(schema.boardAsk)
      .where(eq(schema.boardAsk.id, body.ask.id));
    expect(row).toMatchObject({
      callbackStatus: "failed",
      callbackAttempts: 1,
      callbackLastError: "blocked_destination",
      callbackNextAttemptAt: null,
    });
    const read = (await (await agent("/asks/fm:probe")).json()) as {
      ask: { callback: { status: string; lastError: string } };
    };
    expect(read.ask.callback).toMatchObject({ status: "failed", lastError: "blocked_destination" });
  });

  it("records a row that can't be prepared and still delivers the rows after it", async () => {
    stubCallbackTransport();
    callbacks.status = 204;
    const callback = { url: "https://grok.example/routine", token: "k".repeat(32) };
    const bad = await createAsk({ key: "fm:bad-row", push: "none", callback });
    const good = await createAsk({ key: "fm:good-row", push: "none", callback });
    await db
      .update(schema.boardAsk)
      .set({ callbackTokenCiphertext: "synthetic-corrupt-ciphertext" })
      .where(eq(schema.boardAsk.id, bad.body.ask.id));
    await agent("/asks/fm:bad-row/cancel", FM, { method: "POST", body: JSON.stringify({}) });
    await agent("/asks/fm:good-row/cancel", FM, { method: "POST", body: JSON.stringify({}) });

    await expect(boardCallbacks.deliverBoardCallbacks()).resolves.toBeUndefined();
    const [badRow] = await db
      .select()
      .from(schema.boardAsk)
      .where(eq(schema.boardAsk.id, bad.body.ask.id));
    expect(badRow).toMatchObject({
      callbackStatus: "retrying",
      callbackAttempts: 1,
      callbackLastError: "internal_error",
    });
    const [goodRow] = await db
      .select()
      .from(schema.boardAsk)
      .where(eq(schema.boardAsk.id, good.body.ask.id));
    expect(goodRow).toMatchObject({ callbackStatus: "delivered", callbackAttempts: 1 });
    expect(callbacks.calls.map((call) => call.body.askId)).toEqual([good.body.ask.id]);
  });

  it("re-resolves on each retry and stops once the name rebinds to a private address", async () => {
    const request = stubCallbackTransport();
    callbacks.status = 503;
    const callback = { url: "https://rebind.example/hook", token: "k".repeat(32) };
    const { body } = await createAsk({ key: "fm:rebind", push: "none", callback });
    await agent("/asks/fm:rebind/cancel", FM, { method: "POST", body: JSON.stringify({}) });
    await boardCallbacks.deliverBoardCallbacks();
    const [first] = await db
      .select()
      .from(schema.boardAsk)
      .where(eq(schema.boardAsk.id, body.ask.id));
    expect(first).toMatchObject({ callbackStatus: "retrying", callbackLastError: "HTTP 503" });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      host: "93.184.216.34",
      servername: "rebind.example",
    });

    vi.spyOn(outbound, "resolve").mockImplementation(async () => [
      { address: "10.0.0.5", family: 4 },
    ]);
    await db
      .update(schema.boardAsk)
      .set({ callbackNextAttemptAt: new Date(0) })
      .where(eq(schema.boardAsk.id, body.ask.id));
    await boardCallbacks.deliverBoardCallbacks();
    const [second] = await db
      .select()
      .from(schema.boardAsk)
      .where(eq(schema.boardAsk.id, body.ask.id));
    expect(second).toMatchObject({
      callbackStatus: "failed",
      callbackAttempts: 2,
      callbackLastError: "blocked_destination",
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it("announces changes on the stream", async () => {
    const versions: number[] = [];
    const stop = boardStream.subscribeBoard("cap", (version) => versions.push(version));
    await createAsk();
    stop();
    expect(versions).toEqual([1]);
    const stream = await session("/stream");
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const reader = stream.body?.getReader();
    const first = await reader?.read();
    expect(new TextDecoder().decode(first?.value)).toContain("event: changed");
    await reader?.cancel();
  });
});
