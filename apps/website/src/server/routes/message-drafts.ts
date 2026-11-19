import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import { messageDraft } from "../db/schema";
import { env } from "../env";
import { type AgentEnv, requireApiToken, requireScopes } from "../middleware";

const descriptor = z
  .string()
  .min(1)
  .max(250)
  .refine((value) => value === value.trim() && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value));
const recipientSchema = z.strictObject({
  id: descriptor,
  label: descriptor,
  address: descriptor,
  verificationSource: descriptor,
});
const messageText = z
  .string()
  .max(4000)
  .refine(
    (value) =>
      value.trim().length > 0 &&
      !/[\p{Cc}\p{Cs}\u202a-\u202e\u2066-\u2069]/u.test(value.replace(/[\n\t]/g, "")),
  );
export const messageDraftCreateSchema = z.strictObject({
  recipient: recipientSchema,
  text: messageText,
  idempotencyKey: descriptor,
  expiresInSeconds: z.number().int().min(30).max(3600).default(900),
});
const match = {
  expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  actionDigest: z.string().regex(/^[a-f0-9]{64}$/),
};
export const messageDraftRevisionSchema = z.strictObject(match);
const editSchema = z.strictObject({ ...match, text: messageText });
const respondSchema = z.strictObject({ ...match, action: z.enum(["send", "deny"]) });
export const messageDraftReceiptSchema = z
  .strictObject({
    operationId: z.string().uuid(),
    status: z.enum(["delivered", "failed", "unknown"]),
    providerMessageId: descriptor.optional(),
  })
  .refine((receipt) =>
    receipt.status === "delivered" ? !!receipt.providerMessageId : !receipt.providerMessageId,
  );

type Draft = typeof messageDraft.$inferSelect;
function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function revisionDigest(
  id: string,
  revision: number,
  recipient: Draft["recipient"],
  text: string,
  expiresAt: Date,
) {
  return digest(["shark-message-draft:v1", id, revision, recipient, text, expiresAt.toISOString()]);
}

function dto(row: Draft, now = new Date()) {
  const { id, recipient, text, revision, actionDigest, expiresAt, operationId, providerMessageId } =
    row;
  const status =
    (row.status === "pending" || row.status === "approved") && expiresAt <= now
      ? "expired"
      : row.status;
  return {
    id,
    recipient,
    text,
    revision,
    actionDigest,
    expiresAt: expiresAt.toISOString(),
    status,
    operationId,
    providerMessageId,
  };
}

function owner(id: string, userId: string, creatorTokenId?: string) {
  return and(
    eq(messageDraft.id, id),
    eq(messageDraft.userId, userId),
    creatorTokenId === undefined ? undefined : eq(messageDraft.creatorTokenId, creatorTokenId),
  );
}

function currentRevision(input: z.infer<typeof messageDraftRevisionSchema>) {
  return and(
    eq(messageDraft.revision, input.expectedRevision),
    eq(messageDraft.actionDigest, input.actionDigest),
  );
}

function privateResponses() {
  return new Hono<AgentEnv>().use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (!env.SHARK_MESSAGE_DRAFTS_ENABLED) return c.json({ error: "Not found" }, 404);
    await next();
  });
}

// This API trusts the authenticated producer to resolve and verify the exact
// recipient. Neither the Watch nor the transport may re-resolve it by label.
export const agentMessageDraftRoute = privateResponses()
  .use("*", requireApiToken)
  .post("/", requireScopes("interactions:create"), async (c) => {
    const parsed = messageDraftCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid message draft" }, 400);
    const { idempotencyKey, recipient, text, expiresInSeconds } = parsed.data;
    const token = c.get("apiToken");
    const creationDigest = digest([recipient, text, expiresInSeconds]);
    const result = db.transaction((tx) => {
      const existing = tx
        .select()
        .from(messageDraft)
        .where(
          and(
            eq(messageDraft.userId, token.userId),
            eq(messageDraft.creatorTokenId, token.id),
            eq(messageDraft.idempotencyKey, idempotencyKey),
          ),
        )
        .get();
      if (existing)
        return existing.creationDigest === creationDigest
          ? { row: existing, created: false }
          : null;
      const id = randomUUID();
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + expiresInSeconds * 1000);
      const row = tx
        .insert(messageDraft)
        .values({
          id,
          userId: token.userId,
          creatorTokenId: token.id,
          idempotencyKey,
          creationDigest,
          recipient,
          text,
          revision: 1,
          actionDigest: revisionDigest(id, 1, recipient, text, expiresAt),
          status: "pending",
          createdAt,
          expiresAt,
        })
        .returning()
        .get();
      return { row, created: true };
    });
    if (!result)
      return c.json({ error: "Idempotency key already used for different content" }, 409);
    return c.json({ draft: dto(result.row) }, result.created ? 201 : 200);
  })
  .get("/:id", requireScopes("interactions:read"), (c) => {
    const token = c.get("apiToken");
    const row = db
      .select()
      .from(messageDraft)
      .where(owner(c.req.param("id"), token.userId, token.id))
      .get();
    return row ? c.json({ draft: dto(row) }) : c.json({ error: "Draft not found" }, 404);
  })
  .post("/:id/claim", requireScopes("interactions:create", "interactions:read"), async (c) => {
    const parsed = messageDraftRevisionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid draft claim" }, 400);
    const token = c.get("apiToken");
    const row = db.transaction((tx) =>
      tx
        .update(messageDraft)
        .set({
          status: "claimed",
          operationId: randomUUID(),
        })
        .where(
          and(
            owner(c.req.param("id"), token.userId, token.id),
            currentRevision(parsed.data),
            eq(messageDraft.status, "approved"),
            gt(messageDraft.expiresAt, new Date()),
          ),
        )
        .returning()
        .get(),
    );
    // Never return a previous claim as success: a lost response deliberately fails closed.
    return row ? c.json({ draft: dto(row) }) : c.json({ error: "Draft not claimable" }, 409);
  })
  .post("/:id/receipt", requireScopes("interactions:create", "interactions:read"), async (c) => {
    const parsed = messageDraftReceiptSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid delivery receipt" }, 400);
    const token = c.get("apiToken");
    const { operationId, status, providerMessageId = null } = parsed.data;
    const row = db.transaction((tx) => {
      const predicate = and(
        owner(c.req.param("id"), token.userId, token.id),
        eq(messageDraft.operationId, operationId),
      );
      const updated = tx
        .update(messageDraft)
        .set({ status, providerMessageId })
        .where(and(predicate, eq(messageDraft.status, "claimed")))
        .returning()
        .get();
      if (updated) return updated;
      const existing = tx.select().from(messageDraft).where(predicate).get();
      return existing?.status === status && existing.providerMessageId === providerMessageId
        ? existing
        : undefined;
    });
    return row ? c.json({ draft: dto(row) }) : c.json({ error: "No matching delivery claim" }, 409);
  });

export const watchMessageDraftRoute = privateResponses()
  .use("*", requireApiToken)
  .get("/next", requireScopes("watch:read"), (c) => {
    const token = c.get("apiToken");
    const row = db
      .select()
      .from(messageDraft)
      .where(
        and(
          eq(messageDraft.userId, token.userId),
          eq(messageDraft.status, "pending"),
          gt(messageDraft.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(messageDraft.createdAt), desc(messageDraft.id))
      .get();
    return c.json({ draft: row ? dto(row) : null });
  })
  .get("/:id", requireScopes("watch:read"), (c) => {
    const row = db
      .select()
      .from(messageDraft)
      .where(owner(c.req.param("id"), c.get("apiToken").userId))
      .get();
    return row ? c.json({ draft: dto(row) }) : c.json({ error: "Draft not found" }, 404);
  })
  .post("/:id/edit", requireScopes("watch:respond"), async (c) => {
    const parsed = editSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid draft edit" }, 400);
    const input = parsed.data;
    const userId = c.get("apiToken").userId;
    const id = c.req.param("id");
    const row = db.transaction((tx) => {
      const predicate = and(
        owner(id, userId),
        currentRevision(input),
        eq(messageDraft.status, "pending"),
        gt(messageDraft.expiresAt, new Date()),
      );
      const existing = tx.select().from(messageDraft).where(predicate).get();
      if (!existing) return undefined;
      const revision = existing.revision + 1;
      return tx
        .update(messageDraft)
        .set({
          revision,
          text: input.text,
          actionDigest: revisionDigest(
            id,
            revision,
            existing.recipient,
            input.text,
            existing.expiresAt,
          ),
        })
        .where(predicate)
        .returning()
        .get();
    });
    return row
      ? c.json({ draft: dto(row) })
      : c.json({ error: "Draft changed, expired, or closed" }, 409);
  })
  .post("/:id/respond", requireScopes("watch:respond"), async (c) => {
    const parsed = respondSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid draft response" }, 400);
    const input = parsed.data;
    const userId = c.get("apiToken").userId;
    const row = db.transaction((tx) =>
      tx
        .update(messageDraft)
        .set({
          status: input.action === "send" ? "approved" : "denied",
        })
        .where(
          and(
            owner(c.req.param("id"), userId),
            currentRevision(input),
            eq(messageDraft.status, "pending"),
            gt(messageDraft.expiresAt, new Date()),
          ),
        )
        .returning()
        .get(),
    );
    return row
      ? c.json({ draft: dto(row) })
      : c.json({ error: "Draft changed, expired, or closed" }, 409);
  });
