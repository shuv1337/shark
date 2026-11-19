import { Hono } from "hono";
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";
process.env.ALLOWED_EMAILS = "";
vi.mock("../auth", () => ({ auth: { api: {} } }));

const agent = `hark_${"a".repeat(43)}`;
const sameUserAgent = `hark_${"b".repeat(43)}`;
const watch = `hark_${"c".repeat(43)}`;
const foreignWatch = `hark_${"d".repeat(43)}`;
const readOnlyWatch = `hark_${"e".repeat(43)}`;
const recipient = {
  id: "synthetic-verified-id",
  label: "Example Recipient",
  address: "example@example.invalid",
  verificationSource: "synthetic-directory",
};

const root = new Hono();
const agentPath = "/api/agent/message-drafts";
const watchPath = "/api/watch/message-drafts";
const sendRequest = (path: string, token: string | undefined, body?: unknown) =>
  root.request(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
type Draft = {
  id: string;
  recipient: typeof recipient;
  text: string;
  revision: number;
  actionDigest: string;
  status: string;
  operationId: string;
};
async function parseDraft(response: Response): Promise<Draft> {
  return ((await response.json()) as { draft: Draft }).draft;
}
const rev = (draft: Draft) => ({
  expectedRevision: draft.revision,
  actionDigest: draft.actionDigest,
});
let key = 0;
const createInput = () => ({
  recipient,
  text: "Exact draft  \nsecond line",
  idempotencyKey: `test-${++key}`,
});
async function create() {
  const response = await sendRequest(agentPath, agent, createInput());
  expect(response.status).toBe(201);
  return parseDraft(response);
}

beforeAll(async () => {
  const { runMigrations } = await import("../db/migrate");
  const { db } = await import("../db");
  const { apiToken, user } = await import("../db/schema");
  const { hashApiToken } = await import("../lib/token");
  const { agentMessageDraftRoute, watchMessageDraftRoute } = await import("./message-drafts");
  runMigrations();
  root.route(agentPath, agentMessageDraftRoute);
  root.route(watchPath, watchMessageDraftRoute);
  const now = new Date();
  for (const id of ["owner", "foreign"]) {
    db.insert(user)
      .values({ id, email: `${id}@example.invalid`, name: id, createdAt: now, updatedAt: now })
      .run();
  }
  for (const [token, userId, scopes] of [
    [agent, "owner", ["interactions:create", "interactions:read"]],
    [sameUserAgent, "owner", ["interactions:create", "interactions:read"]],
    [watch, "owner", ["watch:read", "watch:respond"]],
    [foreignWatch, "foreign", ["watch:read", "watch:respond"]],
    [readOnlyWatch, "owner", ["watch:read"]],
  ] as const) {
    const hash = hashApiToken(token);
    db.insert(apiToken)
      .values({
        id: hash,
        tokenHash: hash,
        userId,
        scopes: [...scopes],
        createdAt: now,
        prefix: token.slice(0, 12),
        name: "Synthetic",
      })
      .run();
  }
});

describe("private exact-revision message drafts", () => {
  it("keeps old revisions and non-owner credentials from authorizing delivery", async () => {
    const pending = await create();
    const next = await sendRequest(`${watchPath}/next`, watch);
    expect(next.headers.get("cache-control")).toBe("no-store");
    expect(await parseDraft(next)).toMatchObject(pending);
    expect((await sendRequest(`${watchPath}/next`, undefined)).status).toBe(401);
    expect(await parseDraft(await sendRequest(`${watchPath}/next`, foreignWatch))).toBeNull();
    expect((await sendRequest(`${watchPath}/${pending.id}`, foreignWatch)).status).toBe(404);
    expect((await sendRequest(`${agentPath}/${pending.id}`, sameUserAgent)).status).toBe(404);
    expect(
      (
        await sendRequest(`${watchPath}/${pending.id}/respond`, foreignWatch, {
          ...rev(pending),
          action: "send",
        })
      ).status,
    ).toBe(409);
    for (const deniedToken of [agent, readOnlyWatch]) {
      expect(
        (
          await sendRequest(`${watchPath}/${pending.id}/respond`, deniedToken, {
            ...rev(pending),
            action: "send",
          })
        ).status,
      ).toBe(403);
    }
    const exact = "  revised 👋\nsecond line ";
    const edit = await sendRequest(`${watchPath}/${pending.id}/edit`, watch, {
      ...rev(pending),
      text: exact,
    });
    expect(edit.status).toBe(200);
    const updated = await parseDraft(edit);
    expect(updated).toMatchObject({
      id: pending.id,
      recipient,
      text: exact,
      revision: 2,
      status: "pending",
    });
    expect(updated.actionDigest).not.toBe(pending.actionDigest);
    expect(
      (await sendRequest(`${agentPath}/${updated.id}/claim`, agent, rev(updated))).status,
    ).toBe(409);
    expect(
      (
        await sendRequest(`${watchPath}/${pending.id}/respond`, watch, {
          ...rev(pending),
          action: "send",
        })
      ).status,
    ).toBe(409);
    const approvalRequests = await Promise.all(
      Array.from({ length: 4 }, () =>
        sendRequest(`${watchPath}/${updated.id}/respond`, watch, {
          ...rev(updated),
          action: "send",
        }),
      ),
    );
    expect(approvalRequests.map((response) => response.status).sort()).toEqual([
      200, 409, 409, 409,
    ]);
    const claims = await Promise.all(
      Array.from({ length: 4 }, () =>
        sendRequest(`${agentPath}/${updated.id}/claim`, agent, rev(updated)),
      ),
    );
    expect(claims.map((response) => response.status).sort()).toEqual([200, 409, 409, 409]);
    const success = claims.find((response) => response.ok);
    if (!success) throw new Error("Expected one successful claim");
    const claimed = await parseDraft(success);
    expect(claimed).toMatchObject({ recipient, text: exact, revision: 2, status: "claimed" });
    const deliver = {
      operationId: claimed.operationId,
      status: "delivered",
      providerMessageId: "synthetic-provider-id",
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(
        await parseDraft(await sendRequest(`${agentPath}/${updated.id}/receipt`, agent, deliver)),
      ).toMatchObject({ status: "delivered" });
    }
    expect(
      (
        await sendRequest(`${agentPath}/${updated.id}/receipt`, agent, {
          operationId: claimed.operationId,
          status: "unknown",
        })
      ).status,
    ).toBe(409);
  });

  it("deduplicates an exact ingress retry but rejects changed content", async () => {
    const input = createInput();
    expect(
      (await sendRequest(agentPath, agent, { ...input, text: "Bidi \u202eoverride" })).status,
    ).toBe(400);
    const original = await parseDraft(await sendRequest(agentPath, agent, input));
    const replay = await sendRequest(agentPath, agent, input);
    expect(replay.status).toBe(200);
    expect((await parseDraft(replay)).id).toBe(original.id);
    expect(
      (await sendRequest(agentPath, agent, { ...input, text: "different content" })).status,
    ).toBe(409);
  });

  it("fails closed for denial and expiration", async () => {
    const denied = await create();
    expect(
      (
        await sendRequest(`${watchPath}/${denied.id}/respond`, watch, {
          ...rev(denied),
          action: "deny",
        })
      ).status,
    ).toBe(200);
    expect((await sendRequest(`${agentPath}/${denied.id}/claim`, agent, rev(denied))).status).toBe(
      409,
    );
    const expired = await create();
    const approved = await create();
    expect(
      (
        await sendRequest(`${watchPath}/${approved.id}/respond`, watch, {
          ...rev(approved),
          action: "send",
        })
      ).status,
    ).toBe(200);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(Date.now() + 901_000));
      expect(
        (
          await sendRequest(`${watchPath}/${expired.id}/respond`, watch, {
            ...rev(expired),
            action: "send",
          })
        ).status,
      ).toBe(409);
      expect(
        (await sendRequest(`${agentPath}/${approved.id}/claim`, agent, rev(approved))).status,
      ).toBe(409);
      expect(await parseDraft(await sendRequest(`${watchPath}/next`, watch))).toBeNull();
      expect(
        (await parseDraft(await sendRequest(`${agentPath}/${expired.id}`, agent))).status,
      ).toBe("expired");
    } finally {
      vi.useRealTimers();
    }
  });
});
