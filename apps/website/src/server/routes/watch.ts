import { type WatchSnapshotDto, watchInteractionResponseSchema } from "@hark/contracts";
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { interaction, liveActivity } from "../db/schema";
import { track } from "../lib/analytics";
import { deliverInteractionCallbacks } from "../lib/interaction-callbacks";
import { type AgentEnv, requireApiToken, requireScopes } from "../middleware";
import { resolveInteractionLiveActivity } from "./activities";

const LIVE_STATUSES = ["starting", "active", "partial"] as const;

function snapshotFor(userId: string): WatchSnapshotDto {
  const now = new Date();
  const work = db
    .select()
    .from(liveActivity)
    .where(
      and(
        eq(liveActivity.userId, userId),
        inArray(liveActivity.status, LIVE_STATUSES),
        isNull(liveActivity.interactionId),
        gt(liveActivity.expiresAt, now),
      ),
    )
    .orderBy(desc(liveActivity.updatedAt))
    .limit(1)
    .get();
  const pending = db
    .select()
    .from(interaction)
    .where(
      and(
        eq(interaction.userId, userId),
        eq(interaction.status, "pending"),
        inArray(interaction.kind, ["approval", "yes_no"]),
        gt(interaction.expiresAt, now),
      ),
    )
    .orderBy(desc(interaction.createdAt))
    .limit(1)
    .get();

  let activeWork: WatchSnapshotDto["activeWork"] = null;
  if (work) {
    const props = work.props as {
      title?: string;
      status?: string;
      detail?: string;
      progress?: number;
      privacyMode?: string;
    };
    const isPrivate = props.privacyMode === "private";
    activeWork = {
      id: work.id,
      title: isPrivate ? "Agent task" : (props.title ?? "Active work"),
      status: isPrivate ? "In progress" : (props.status ?? "In progress"),
      detail: isPrivate ? null : (props.detail ?? null),
      progress: typeof props.progress === "number" ? props.progress : null,
      updatedAt: work.updatedAt.toISOString(),
      private: isPrivate,
    };
  }

  return {
    generatedAt: now.toISOString(),
    activeWork,
    pendingInteraction: pending
      ? {
          id: pending.id,
          title: pending.title,
          prompt: pending.prompt,
          kind: pending.kind as "approval" | "yes_no",
          actionDigest: pending.actionDigest,
          expiresAt: pending.expiresAt.toISOString(),
          primaryLabel: pending.primaryLabel,
          secondaryLabel: pending.secondaryLabel,
        }
      : null,
  };
}

/**
 * A watch token is restricted to this snapshot and to resolving its own
 * yes/no or approval actions. The server remains authoritative for races.
 */
export const watchRoute = new Hono<AgentEnv>()
  .use("*", requireApiToken)
  .get("/snapshot", requireScopes("watch:read"), (c) =>
    c.json(snapshotFor(c.get("apiToken").userId)),
  )
  .post("/interactions/:id/respond", requireScopes("watch:respond"), async (c) => {
    const parsed = watchInteractionResponseSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid interaction response" }, 400);
    const token = c.get("apiToken");
    const current = db
      .select()
      .from(interaction)
      .where(and(eq(interaction.id, c.req.param("id")), eq(interaction.userId, token.userId)))
      .get();
    if (!current) return c.json({ error: "Interaction not found" }, 404);
    if (current.actionDigest !== parsed.data.actionDigest) {
      return c.json({ error: "Interaction action digest mismatch" }, 409);
    }
    if (
      (current.kind === "approval" && !["approve", "deny"].includes(parsed.data.action)) ||
      (current.kind === "yes_no" && !["yes", "no"].includes(parsed.data.action)) ||
      current.kind === "reply"
    ) {
      return c.json({ error: "This interaction cannot be answered on Apple Watch" }, 400);
    }
    const now = new Date();
    const status =
      parsed.data.action === "approve"
        ? "approved"
        : parsed.data.action === "deny"
          ? "denied"
          : parsed.data.action;
    const [resolved] = await db
      .update(interaction)
      .set({ status, response: parsed.data.action, respondedAt: now })
      .where(
        and(
          eq(interaction.id, current.id),
          eq(interaction.userId, token.userId),
          eq(interaction.status, "pending"),
          gt(interaction.expiresAt, now),
        ),
      )
      .returning();
    if (!resolved) {
      return c.json(
        { error: "Interaction is already terminal", snapshot: snapshotFor(token.userId) },
        409,
      );
    }
    track({
      name: "interaction_responded",
      userId: token.userId,
      outcome: parsed.data.action,
      metadata: { kind: current.kind, surface: "watch" },
    });
    void deliverInteractionCallbacks();
    void resolveInteractionLiveActivity(resolved);
    return c.json({ ok: true, status: resolved.status, snapshot: snapshotFor(token.userId) });
  });
